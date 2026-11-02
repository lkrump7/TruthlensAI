import { CONFIG } from './config.mjs';
import { numbersIn, normalizedTokens } from './nlp.mjs';
import { screenContent } from './screen.mjs';
import { screenTextsWithGuard } from './guard.mjs';
import { VectorIndex } from './vector.mjs';

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
// semicolons, on "and" before a fresh subject doing something, on
// "and that" in reported findings, and on whereas/while contrasts.
// Noun lists ("salt and pepper exports") have no action verb after the
// second noun and stay whole.
export function splitAtomicClaims(text) {
  const clean = String(text || '').trim();
  if (!clean) return [];
  const parts = clean
    .split(new RegExp(`\\s+and\\s+(?=(?:was|were|is|are|it|they|he|she)\\b)|;\\s*|\\s+and\\s+(?=(?:the\\s+|a\\s+|an\\s+)?[a-z]+\\s+(?:${ACTION_VERBS})\\b)|\\s+and that\\s+|\\s+(?:whereas|while)\\s+(?=the\\b)`, 'i'))
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.length ? parts : [clean];
}

const TOPIC_STOP = new Set(['the','and','was','were','with','from','that','this','among','during','about','increases','increase','reduces','reduce','decreases','improves','worsens','raises','lowers']);
export function topicKeyFor(text) {
  const toks = [...new Set(normalizedTokens(text).filter((w) => /^[a-z]{4,}$/.test(w)))].filter((w) => !TOPIC_STOP.has(w)).sort();
  const base = toks.slice(0, 6).join('-');
  // Numbers are often the whole claim ("by 80 percent" vs "by 20
  // percent"): a key without them judges one claim on another's
  // evidence. Word numerals fold to digits, so "eighty" and "80" share.
  // The hash covers every token, so claims differing only past the
  // sixth topic word cannot collide either.
  const nums = numbersIn(text);
  let h = 5381;
  // The hash covers the tokens in the order they were written: claims
  // that share a word set but reverse who does what ("Cats kill dogs"
  // vs "Dogs kill cats") must not share a research cache entry.
  for (const ch of `${normalizedTokens(text).join(' ')}|${nums.join(',')}`) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return `${base}|n:${nums.join(',')}|h:${h.toString(36)}`;
}

export function classifyClaim(text) {
  const t = String(text || '');
  if (/^if\b/i.test(t) || /\bwould\b[^.]*\bif\b/i.test(t)) return 'Not fact-checkable';
  if (OPINION.test(t)) return 'Not fact-checkable';
  if (/\b(brains?|memory|treatment|disease|vaccine|species|evolution|climate|boils|temperature)\b/i.test(t)) return 'Scientific';
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

async function collectClaims(units, { limit = CONFIG.MAX_CLAIMS_PER_DOCUMENT, screenTexts = screenTextsWithGuard } = {}) {
  // One batched screen for the whole book: regex first, Prompt Guard 2
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
      let atomic = rawAtomic;
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
