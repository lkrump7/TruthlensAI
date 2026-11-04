import { CONFIG } from './config.mjs';
import { numbersIn, normalizedTokens } from './nlp.mjs';
import { screenContent } from './screen.mjs';
import { screenTextsWithGuard } from './guard.mjs';
import { VectorIndex } from './vector.mjs';
import { CLAIM_FILTER_SYSTEM, claimFilterUser } from './prompts.mjs';
import { getModels, liveStatus, defaultMetaClient } from './meta.mjs';

const OPINION = /\b(i think|i believe|in my opinion|best ever|worst ever|should be illegal|ought to)\b/i;
const DOT = '\u0001';

export function splitSentences(text) {
  let t = String(text || '');
  t = t.replace(/(\d)\.(\d)/g, `$1${DOT}$2`);
  t = t.replace(/\b(Dr|Prof|Mr|Mrs|Ms|St|vs|etc|approx|dept|fig|vol|jr|sr)\./gi, `$1${DOT}`);
  t = t.replace(/\b(e\.g|i\.e|U\.S|U\.K|a\.m|p\.m)\./gi, (m) => m.replace(/\./g, DOT));
  t = t.replace(/\b([A-Z])\./g, `$1${DOT}`);
  return t
    .split(/(?<=[.!?])\s+|\n+|;\s+/)
    .map((s) => s.split(DOT).join('.').trim())
    .filter(Boolean);
}

const ACTION_VERBS = 'fell|rose|increased|decreased|reduced|improved|caused|showed|found|grew|dropped|declined|doubled|prevented|lowered|raised';

// Split a statement into independently testable propositions. Splits on
// sentence boundaries first so any multi-sentence input gets one atomic
// per sentence, then on "and" before a fresh subject doing something,
// on "and that" in reported findings, and on whereas/while contrasts.
// Noun lists ("salt and pepper exports") have no action verb after the
// second noun and stay whole.
export function splitAtomicClaims(text) {
  const clean = String(text || '').trim();
  if (!clean) return [];
  const sentences = splitSentences(clean);
  const base = sentences.length ? sentences : [clean];
  const parts = base.flatMap((s) => String(s || '')
    .split(new RegExp(`\\s+and\\s+(?=(?:was|were|is|are|it|they|he|she)\\b)|;\\s*|\\s+and\\s+(?=(?:the\\s+|a\\s+|an\\s+)?[a-z]+\\s+(?:${ACTION_VERBS})\\b)|\\s+and that\\s+|\\s+(?:whereas|while)\\s+(?=the\\b)`, 'i'))
    .map((p) => p.trim())
    .filter(Boolean));
  return parts.length ? parts : [clean];
}

// Normalized key for atomic deduplication: case/whitespace/punctuation
// insensitive, numbers significant so "40 million" never collapses into
// "90 million".
export function atomicKeyFor(text) {
  return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.!?;:,]+$/g, '');
}

// Deduplicate atomics preserving first-seen order.
export function dedupeAtomics(list) {
  const seen = new Set();
  const out = [];
  for (const item of list || []) {
    const key = atomicKeyFor(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

const TOPIC_STOP = new Set(['the','and','was','were','with','from','that','this','among','during','about','increases','increase','reduces','reduce','decreases','improves','worsens','raises','lowers']);
export function topicKeyFor(text) {
  // Single tokenization: normalizedTokens is pure, so one pass gives the
  // same tokens the three-pass version computed (topic words, numbers,
  // hash input). No result change, ~3x less work per cache key.
  const norm = normalizedTokens(text);
  const toks = [...new Set(norm.filter((w) => /^[a-z]{4,}$/.test(w)))].filter((w) => !TOPIC_STOP.has(w)).sort();
  const base = toks.slice(0, 6).join('-');
  // Numbers are often the whole claim ("by 80 percent" vs "by 20
  // percent"): a key without them judges one claim on another's
  // evidence. Word numerals fold to digits, so "eighty" and "80" share.
  // The hash covers every token, so claims differing only past the
  // sixth topic word cannot collide either.
  const nums = norm.map((t) => String(t).replace(/%$/, '')).filter((t) => /^\d+$/.test(t)).map(Number);
  let h = 5381;
  // The hash covers the tokens in the order they were written: claims
  // that share a word set but reverse who does what ("Cats kill dogs"
  // vs "Dogs kill cats") must not share a research cache entry.
  for (const ch of `${norm.join(' ')}|${nums.join(',')}`) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return `${base}|n:${nums.join(',')}|h:${h.toString(36)}`;
}

export function classifyClaim(text) {
  const t = String(text || '');
  if (/^if\b/i.test(t) || /\bwould\b[^.]*\bif\b/i.test(t)) return 'Not fact-checkable';
  if (OPINION.test(t)) return 'Not fact-checkable';
  if (isMediaDescription(t)) return 'Not fact-checkable';
  if (/\b(brains?|memory|treatment|disease|vaccine|species|evolution|climate|boils|temperature|photosynthesis|plant|cells?|chemical|energy|protein|genes?|atoms?|molecule|glucose)\b/i.test(t)) return 'Scientific';
  if (/\b(invented|born|died|founded|war|in \d{4})\b/i.test(t)) return 'Historical';
  if (/\b(\d+%|percent|average|median|statistics)\b/i.test(t)) return 'Statistical';
  if (/\b(unemployment|inflation|gdp|tax|economy)\b/i.test(t)) return 'Economic';
  return 'Unclassified';
}

const CITATION_LINE = /(Journal of|\(\d{4}\)|\b\d+\(\d+\)\s*,\s*\d+[-–]\d+|doi\.org|ISBN)/i;

function mainTextBeforeBibliography(text) {
  const parts = String(text || '').split(/\n\s*(references|bibliography|works cited)\s*\n/i);
  return parts[0];
}

// Numbers as digits or words (lib/nlp.mjs numbersIn): "eighty" counts.
const numbersOf = (text) => numbersIn(text);
const subjectOf = (text) => {
  const m = String(text).match(/^(?:The|A|An)\s+([a-z][a-z-]*)\b/i);
  return m ? m[1].toLowerCase() : null;
};

export function scoreClaimPriority(claim) {
  const text = claim.text || '';
  let score = 0;
  score += Math.min(numbersOf(text).length, 4) * 1.5;
  if (/\b(reduced|caused|increased|decreased|prevented|killed|improved|worsened|led to|resulted in)\b/i.test(text)) score += 3;
  if (/\b(19|20)\d{2}\b/.test(text)) score += 1;
  if (/%|percent/i.test(text)) score += 1;
  score += Math.max(0, (claim.pages?.length || 1) - 1) * 2;
  if (text.length >= 30 && text.length <= 220) score += 1;
  return score;
}

export function prioritizeClaims(claims, limit = CONFIG.MAX_CLAIMS_PER_DOCUMENT) {
  return (claims || [])
    .map((claim, index) => ({ claim, index, score: scoreClaimPriority(claim) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .sort((a, b) => a.index - b.index)
    .map((x) => x.claim);
}

// Media pages carry scaffolding a web search can never settle: the
// timestamp and Speech/Visual labels from lib/audio.mjs and
// lib/video.mjs, plus caption sentences that only describe the medium
// itself ("The frame shows...", "No people are visible."). Sent to
// research as written, every one of them comes back Unverifiable, so
// extraction strips the labels, drops the descriptions, and keeps the
// checkable content: speech, and text quoted as visible in an image.
const MEDIA_LABEL = /^\s*(?:\[\d{1,2}:\d{2}(?:\s*[-–]\s*\d{1,2}:\d{2})?\]\s*)?(?:speech|visual(?:\s*\(\d{1,2}:\d{2}\))?)\s*:\s*/i;
const MEDIUM_SUBJECT = '(?:image|frame|photo|photograph|picture|scene|video|clip|still|sound file|audio(?: file| recording)?|recording|transcript)';
const FINITE_VERBS = new Set(['is', 'are', 'was', 'were', 'has', 'have', 'had', 'does', 'did', 'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must', 'be', 'been', 'being', 'shows', 'show', 'says', 'say', 'reads', 'contains']);

export function isMediaDescription(text) {
  let t = String(text || '').trim();
  while (MEDIA_LABEL.test(t)) t = t.replace(MEDIA_LABEL, '').trim();
  if (new RegExp(`^(?:the|this|a|an)\\s+${MEDIUM_SUBJECT}\\b[^.!?]*\\b(?:shows?|depicts?|displays?|contains?|features?)\\b`, 'i').test(t)) return true;
  return /^(?:no|nothing|nobody|no one)\s+[^.!?]*\bvisible\b/i.test(t);
}

// Website chrome and vague one-liners are not propositions: navigation,
// calls to action, greetings, legal footers, and bare subjective takes
// ("Borders are nice") read as text but settle nothing. Sent to research
// as written they burn a search and come back Unverifiable, so extraction
// drops them and keeps the checkable content. Short objective facts
// ("Earth is round", "Water is wet") stay: copula plus a concrete,
// non-evaluative predicate is still a claim.
const BOILERPLATE_PHRASE = /copyright|all rights reserved|privacy policy|terms of (service|use)|subscribe to our newsletter|sign up for (our )?newsletter|accept (all )?cookies|cookie (policy|banner|consent|notice)/i;
const GREETING_LEAD = /^\s*(welcome|hello|hi|hey|greetings)\b/i;
const CTA_LEAD = /^\s*(click|tap|read more|learn more|show more|load more|view more|continue reading|discover|explore|shop|buy|download|watch|listen|follow|share|join|register|sign up|sign in|log in|subscribe|contact us)\b/i;
const SUBJECTIVE_PREDICATE = /\b(is|are|was|were|feel|feels|felt|look|looks|looked|seem|seems|seemed)\b[^.!?]{0,40}\b(nice|good|great|beautiful|amazing|wonderful|lovely|awesome|cool|fantastic|terrible|awful|horrible|best|worst)\b/i;
const IRREGULAR_VERB = new Set(['rose', 'fell', 'grew', 'grown', 'lies', 'lay', 'lain']);
const PRESENT_VERB = new Set(['improves', 'explains', 'states', 'confirms', 'boils', 'uses', 'use', 'protects', 'lowers', 'increases', 'decreases', 'causes', 'means', 'includes', 'involves', 'requires', 'affects', 'kills', 'prevents', 'raises', 'reduces', 'treats', 'tests', 'studies', 'reports', 'records', 'measures', 'finds', 'carries', 'walks', 'lands', 'sleeps', 'exercises']);

function hasPredicate(text) {
  const words = String(text || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
  return words.some((w) => FINITE_VERBS.has(w) || IRREGULAR_VERB.has(w) || PRESENT_VERB.has(w) || (w.length >= 4 && w.endsWith('ed')));
}

export function isCheckableClaimText(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  if (t.split(/\s+/).filter(Boolean).length < 3) return false;
  if (BOILERPLATE_PHRASE.test(t)) return false;
  if (GREETING_LEAD.test(t)) return false;
  if (CTA_LEAD.test(t) && t.split(/\s+/).length <= 8 && !/\b\d/.test(t)) return false;
  if (SUBJECTIVE_PREDICATE.test(t) && !/\b\d/.test(t) && !/%|percent/i.test(t)) return false;
  if (!hasPredicate(t)) return false;
  return true;
}

export function cleanMediaClaim(text) {
  let t = String(text || '').trim();
  while (MEDIA_LABEL.test(t)) t = t.replace(MEDIA_LABEL, '').trim();
  const quoted = t.match(/^(?:the\s+)?visible text (?:is|reads|says)\s*:?\s*["“](.+?)["”]\.?$/i);
  if (quoted) {
    const inner = quoted[1].trim();
    if (inner.length < 10) return null;
    return /[.!?]$/.test(inner) ? inner : `${inner}.`;
  }
  if (isMediaDescription(t)) return null;
  if (/\b(?:https?:\/\/|www\.|[a-z0-9-]+\.(?:org|com|net|edu|gov)\b)/i.test(t)) {
    const words = t.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
    if (!words.some((w) => FINITE_VERBS.has(w) || /(?:ed|ing)$/.test(w))) return null;
  }
  if (!/[.!?]["”']?$/.test(t) && /(?:\b(?:the|a|an|that|which|who|whom|whose|to|of|in|on|at|by|for|with|and|or|but|as|before|after|when|while|because)\b|\b(?:that|which|who)\s+(?:first|then|next|also|just|now))$/i.test(t)) return null;
  return t;
}

async function collectClaims(units, { limit = CONFIG.MAX_CLAIMS_PER_DOCUMENT, screenTexts = screenTextsWithGuard } = {}) {
  // One batched screen for the whole excerpt: regex first, Prompt Guard 2
  // behind it (lib/guard.mjs). A screener that returns a misaligned
  // result is ignored unit by unit rather than trusted blindly.
  const screened = await screenTexts((units || []).map((u) => String(u.text || '')));
  const seen = new VectorIndex();
  const byId = new Map();
  const byExact = new Map();
  const claims = [];
  let lastSubject = null;
  for (const [unitIndex, unit] of (units || []).entries()) {
    const clean = String(unit.text || '').trim();
    if (clean.length < 10) continue;
    if (CITATION_LINE.test(clean)) continue;
    if ((screened?.[unitIndex] ?? screenContent(clean)).action === 'quarantine') continue;
    if (/^[“"]/.test(clean) && /(wrote|sarcastically|in the novel)/i.test(clean)) continue;
    for (const rawAtomic of splitAtomicClaims(clean)) {
      let atomic = cleanMediaClaim(rawAtomic);
      if (!atomic) continue;
      if (!isCheckableClaimText(atomic)) continue;
      if (/^(It|This|They)\b/.test(atomic) && lastSubject) atomic = atomic.replace(/^(It|This|They)\b/, `The ${lastSubject}`);
      const exactKey = atomic.toLowerCase().replace(/\s+/g, ' ');
      const unitPages = unit.pages ?? (unit.page ? [unit.page] : []);
      if (byExact.has(exactKey)) {
        const existing = byExact.get(exactKey);
        if (existing.pages) for (const pg of unitPages) if (!existing.pages.includes(pg)) existing.pages.push(pg);
        continue;
      }
      const neighbours = seen.search(atomic, 1);
      const neighbour = neighbours.length && neighbours[0].score > CONFIG.DEDUPE_THRESHOLD ? byId.get(neighbours[0].id) : null;
      if (neighbour && numbersOf(neighbour.text).join(',') === numbersOf(atomic).join(',')) {
        if (subjectOf(neighbour.text) === subjectOf(atomic)) {
          if (neighbour.pages) for (const pg of unitPages) if (!neighbour.pages.includes(pg)) neighbour.pages.push(pg);
          continue;
        }
      }
      const claim = { text: atomic, type: classifyClaim(atomic), internalContradiction: false, ...(unitPages.length ? { page: unitPages[0], pages: [...unitPages] } : {}) };
      if (neighbour) { neighbour.internalContradiction = true; claim.internalContradiction = true; }
      const id = `c${claims.length}`;
      seen.add(id, atomic);
      byId.set(id, claim);
      byExact.set(exactKey, claim);
      claims.push(claim);
      if (claims.length >= limit) return claims;
    }
    lastSubject = subjectOf(clean) || lastSubject;
  }
  return claims;
}

export async function extractClaimsFromText(text, opts = {}) {
  const units = splitSentences(mainTextBeforeBibliography(text)).map((t) => ({ text: t }));
  return collectClaims(units, opts);
}

// Cheap second opinion on website candidates: one batched Muse Spark call
// per batch of candidates asks whether each one is a real checkable claim.
// The heuristic filter above runs first, so the model only sees survivors;
// anything it rejects never burns a search. Fails open: an unconfigured,
// failed, or malformed model answer keeps every candidate.
export const CLAIM_FILTER_BATCH = 50;

function keepSetOf(raw, size) {
  const keep = raw?.keep;
  if (!Array.isArray(keep)) return null;
  const set = new Set();
  for (const n of keep) {
    const i = typeof n === 'string' && /^\d+$/.test(n.trim()) ? Number(n.trim()) : n;
    if (Number.isInteger(i) && i >= 0 && i < size) set.add(i);
  }
  return set;
}

/** @param {{ text: string }[]} candidates @param {{ completeJson?: Function, model?: string, batchSize?: number }} [opts] */
export async function refineWebsiteClaims(candidates, { completeJson, model, batchSize = CLAIM_FILTER_BATCH } = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (!list.length) return Array.isArray(candidates) ? [] : list;
  let complete = completeJson;
  if (!complete) {
    if (!liveStatus().configured) return list;
    const client = defaultMetaClient();
    const spark = model || getModels().spark;
    complete = ({ system, user }) => client.completeJson({ model: spark, system, user });
  }
  const size = Math.max(1, batchSize || CLAIM_FILTER_BATCH);
  const keep = new Set();
  try {
    for (let start = 0; start < list.length; start += size) {
      const batch = list.slice(start, start + size);
      const raw = await complete({
        model: model || getModels().spark,
        system: CLAIM_FILTER_SYSTEM,
        user: claimFilterUser(batch.map((c) => c?.text ?? String(c))),
      });
      const set = keepSetOf(raw, batch.length);
      if (!set) return list;
      for (const i of set) keep.add(start + i);
    }
  } catch (err) {
    console.error('[truthlens] claim filter failed:', err?.message || err);
    return list;
  }
  return list.filter((_, i) => keep.has(i));
}

export async function extractClaimsFromPages(pages, opts = {}) {
  const units = [];
  let carry = null;
  for (const p of pages || []) {
    const combined = carry ? `${carry.text} ${p.text}` : String(p.text || '');
    const carryPages = carry ? (carry.pages ?? (carry.page ? [carry.page] : [])) : [];
    const startPage = carry ? carry.page : p.page;
    const sentences = splitSentences(mainTextBeforeBibliography(combined));
    sentences.forEach((s, i) => {
      const isLast = i === sentences.length - 1;
      if (isLast && !/[.!?]["”']?$/.test(s)) {
        const merged = [...carryPages];
        if (p.page && !merged.includes(p.page)) merged.push(p.page);
        carry = { text: s, page: startPage ?? p.page, pages: merged.length ? merged : undefined };
      } else if (i === 0 && carry) {
        const merged = [...carryPages];
        if (p.page && !merged.includes(p.page)) merged.push(p.page);
        units.push({ text: s, page: startPage ?? p.page, pages: merged.length ? merged : undefined });
      } else {
        units.push({ text: s, page: p.page, pages: p.page ? [p.page] : undefined });
      }
    });
    if (sentences.length && /[.!?]["”']?$/.test(sentences[sentences.length - 1])) carry = null;
  }
  if (carry) units.push(carry);
  return collectClaims(units, opts);
}
