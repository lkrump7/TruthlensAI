import { CONFIG } from './config.mjs';
import { screenContent } from './screen.mjs';
import { VectorIndex } from './vector.mjs';
import { metaSearch } from './search.mjs';
import { fetchPageText, BUDGET } from './fetch.mjs';
import { faissSidecarUrl } from './faiss.mjs';
import { rankEvidence, sourceTier } from './rank.mjs';
export { sourceTier };

// Evidence extraction and retrieval: fetched passages only, screened and ranked.
function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP_TOKENS = new Set(['only', 'use', 'used', 'their', 'there', 'here', 'that', 'this', 'with', 'from', 'about', 'would', 'could']);
const NUM_WORDS = { ten: '10', twenty: '20', fifty: '50', hundred: '100' };
const normTok = (tok) => (NUM_WORDS[String(tok).replace(/%$/, '')] || String(tok).replace(/%$/, '')).replace(/s$/, '');
const claimTokensOf = (claim) => new Set((String(claim).toLowerCase().match(/[a-z0-9%]+/g) || []).map(normTok).filter((x) => (x.length >= 3 || /^\d+$/.test(x)) && !STOP_TOKENS.has(x)));
const passageTokensOf = (text) => new Set((String(text || '').toLowerCase().match(/[a-z0-9%]+/g) || []).map(normTok));

export function passageTouchesClaim(passage, claim) {
  const passageTokens = passageTokensOf(passage);
  return [...claimTokensOf(claim)].filter((x) => passageTokens.has(x)).length >= CONFIG.KEYWORD_OVERLAP_MIN;
}

export function extractPassages(htmlOrText, claim, count = 2, isHtml = true) {
  const text = isHtml ? htmlToText(htmlOrText) : String(htmlOrText || '');
  if (!text) return null;
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  let windows = [];
  let buf = '';
  for (const s of sentences) {
    if ((buf + s).length > CONFIG.PASSAGE_WINDOW_CHARS && buf) { windows.push(buf.trim()); buf = ''; }
    buf += s;
  }
  if (buf.trim()) windows.push(buf.trim());
  const clean = windows.filter((w) => !/revision as of|talk \| contribs|talk page|relevant discussion may be found|accept (all )?cookies|subscribe to our newsletter|sign up for our newsletter/i.test(w));
  if (clean.length) windows = clean;
  const idx = new VectorIndex();
  windows.forEach((w, i) => idx.add(String(i), w));
  const claimTokens = claimTokensOf(claim);
  const scored = idx.search(claim, windows.length).map((h) => {
    const w = windows[Number(h.id)];
    const overlap = [...claimTokens].filter((t) => passageTokensOf(w).has(t)).length;
    return { w, overlap, score: h.score + overlap * 0.05 };
  }).sort((a, b) => b.score - a.score);
  return scored.filter((s) => s.overlap >= CONFIG.KEYWORD_OVERLAP_MIN).slice(0, count).map((s) => s.w);
}

export function extractPassage(htmlOrText, claim, isHtml = true) {
  return extractPassages(htmlOrText, claim, 1, isHtml)[0] || null;
}

export function extractPublishedDate(html) {
  const s = String(html || '');
  const m = s.match(/(?:article:published_time|datePublished|"datePublished")\D{0,40}?(\d{4}-\d{2}-\d{2})/i)
    || s.match(/<time[^>]+datetime=["'](\d{4}-\d{2}-\d{2})/i);
  return m ? m[1] : null;
}

const researchCache = new Map();
const collaboratorIds = new WeakMap();
export function clearResearchCache() { researchCache.clear(); }

/**
 * @param {string} claim
 * @param {{ search?: Function, fetchText?: Function, maxSources?: number, maxEvidence?: number, cache?: boolean, ttlMs?: number, cacheKey?: string }} [opts]
 */
export async function researchClaim(claim, { search = metaSearch, fetchText = fetchPageText, maxSources = BUDGET.maxSources, maxEvidence = BUDGET.maxEvidence, cache = true, ttlMs = CONFIG.RESEARCH_CACHE_TTL_MS, cacheKey: sharedKey } = {}) {
  if (!collaboratorIds.has(search)) collaboratorIds.set(search, Math.random().toString(36).slice(2));
  const cacheKey = (sharedKey || String(claim).trim().toLowerCase()) + '|' + collaboratorIds.get(search);
  const hit = cache && researchCache.get(cacheKey);
  if (hit && Date.now() - hit.at < ttlMs) return hit.result;
  const result = await researchClaimUncached(claim, { search, fetchText, maxSources, maxEvidence });
  if (cache) {
    if (researchCache.size > 50) researchCache.clear();
    researchCache.set(cacheKey, { at: Date.now(), result });
  }
  return result;
}

async function researchClaimUncached(claim, { search, fetchText, maxSources, maxEvidence }) {
  const found = await search(claim);
  const evidence = [];
  const idx = new VectorIndex();
  const fetched = await Promise.all(found.sources.slice(0, maxSources).map(async (src) => {
    try { const raw = await fetchText(src.url); return { src, raw, passages: extractPassages(raw, claim, 2), error: null }; }
    catch (e) { return { src, raw: '', passages: [], error: e }; }
  }));
  const failures = fetched.filter((f) => f.error).map((f) => ({ url: f.src.url, reason: String(f.error.message || f.error).slice(0, 200) }));
  for (const { src, raw, passages } of fetched) {
    for (const passage of passages) {
      if (evidence.some((e) => e.passage === passage)) continue;
      if (screenContent(passage).action !== 'allow') continue;
      const item = {
        id: `ev-web-${evidence.length + 1}`,
        title: src.title, source: (() => { try { return new URL(src.url).hostname; } catch { return src.url; } })(),
        url: src.url, date: extractPublishedDate(raw), passage, stance: 'unknown', fetchedAt: new Date().toISOString(),
      };
      evidence.push(item);
    }
  }
  const ranked = evidence.length
    ? await rankEvidence({ claim, evidence, embed: (t) => idx.embed(t), maxEvidence, sidecarUrl: faissSidecarUrl() })
    : [];
  return { queries: found.queries, sourcesFound: found.sources.length, evidence: ranked, citations: found.citations || [], failures };
}

