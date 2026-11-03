import { CONFIG } from './config.mjs';
import { screenContent } from './screen.mjs';
import { VectorIndex } from './vector.mjs';
import { normalizedTokens, stem, inTextDate } from './nlp.mjs';
import { metaSearch } from './search.mjs';
import { fetchPageText, BUDGET } from './fetch.mjs';
import { sourceTier, reciprocalRankFusion, dedupeNearDuplicates, capPoolByDomain } from './rank.mjs';
import { FETCH_FAILURE_PING } from './failures.mjs';
import { semanticVectors, semanticCosine } from './embed.mjs';
import { rerankScores } from './rerank.mjs';
import { screenTextsWithGuard } from './guard.mjs';
import { mapWithConcurrency } from './limit.mjs';
export { sourceTier };

// Evidence extraction and retrieval: fetched passages only, screened and ranked.
export function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const STOP_TOKENS = new Set(['only', 'use', 'used', 'their', 'there', 'here', 'that', 'this', 'with', 'from', 'about', 'would', 'could']);
// Stemmed token sets for claim/passage overlap (lib/nlp.mjs): Porter
// stemming replaces the old strip-the-final-s rule, which unified
// almost nothing (brains/brain stayed apart; studies/study mangled).
const normTok = (tok) => stem(String(tok).replace(/%$/, ''));
// Stopwords are filtered before stemming as well as after: stemming
// alone would let "only" escape the list as "onli".
const claimTokensOf = (claim) => new Set(normalizedTokens(claim).filter((t) => !STOP_TOKENS.has(t)).map(normTok).filter((x) => (x.length >= 3 || /^\d+$/.test(x)) && !STOP_TOKENS.has(x)));
const passageTokensOf = (text) => new Set(normalizedTokens(text).map(normTok));

// Passage utility (after Perez-Beltrachini & Lapata, arXiv:2502.18108):
// a cheap prediction of whether a passage will help the judge, from claim
// overlap and source tier. Used to give the judge the most useful passages
// first instead of the whole pool.
export function utilityScore(item, claim) {
  const overlap = [...claimTokensOf(claim)].filter((t) => passageTokensOf(item.passage).has(t)).length;
  return overlap * CONFIG.UTILITY_OVERLAP_WEIGHT + sourceTier(item.source) * CONFIG.SOURCE_TIER_WEIGHT + Math.min(String(item.passage || '').length, 400) / 400 * CONFIG.UTILITY_LENGTH_WEIGHT;
}

// Utility orders the judge's context; it never cuts it. The pool is
// already budgeted (BUDGET.maxEvidence), and a cut here could silently
// drop the one contradicting passage before judging — the earlier
// top-3 selection did exactly that on unmeasured weights. Keeping every
// budgeted passage also keeps every domain, so corroboration survives
// by construction instead of by a special case.
export function rankJudgeEvidence(evidence, claim) {
  return [...(evidence || [])]
    .map((item) => ({ item, utility: utilityScore(item, claim) }))
    .sort((a, b) => b.utility - a.utility)
    .map((x) => x.item);
}

export function claimOverlapCount(passage, claim) {
  const passageTokens = passageTokensOf(passage);
  return [...claimTokensOf(claim)].filter((x) => passageTokens.has(x)).length;
}

export function passageTouchesClaim(passage, claim) {
  return claimOverlapCount(passage, claim) >= CONFIG.KEYWORD_OVERLAP_MIN;
}

// Page windows in document order (boilerplate windows dropped).
export function pageWindows(htmlOrText, isHtml = true) {
  const text = isHtml ? htmlToText(htmlOrText) : String(htmlOrText || '');
  if (!text) return [];
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
  return windows;
}

export function extractPassages(htmlOrText, claim, count = 2, isHtml = true, { minOverlap = CONFIG.KEYWORD_OVERLAP_MIN } = {}) {
  const text = isHtml ? htmlToText(htmlOrText) : String(htmlOrText || '');
  if (!text) return null;
  const windows = pageWindows(htmlOrText, isHtml);
  const idx = new VectorIndex();
  windows.forEach((w, i) => idx.add(String(i), w));
  const claimTokens = claimTokensOf(claim);
  // BM25 ranks the page windows: term frequency saturates and long
  // windows pay for their length. Ranking only here; the overlap count
  // below is the relevance gate, so BM25's unbounded score is safe.
  const scored = idx.searchBM25(claim, windows.length).map((h) => {
    const w = windows[Number(h.id)];
    const overlap = [...claimTokens].filter((t) => passageTokensOf(w).has(t)).length;
    return { w, overlap, score: h.score + overlap * 0.05 };
  }).sort((a, b) => b.score - a.score);
  return scored.filter((s) => s.overlap >= minOverlap).slice(0, count).map((s) => s.w);
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

const collaboratorId = (fn) => {
  if (typeof fn !== 'function') return 'none';
  if (!collaboratorIds.has(fn)) collaboratorIds.set(fn, Math.random().toString(36).slice(2));
  return collaboratorIds.get(fn);
};

// The research cache must never hand out its stored reference: any
// caller may mutate the returned evidence, which would otherwise
// poison later claims sharing the cache key. Store a deep clone and
// clone again on every hit, so each caller gets an independent copy.
const cloneResult = (result) => structuredClone(result);

/**
 * @param {string} claim
 * @param {{ search?: Function, fetchText?: Function, maxSources?: number, maxEvidence?: number, cache?: boolean, ttlMs?: number, cacheKey?: string, embedTexts?: Function, rerankTexts?: Function, screenTexts?: Function }} [opts]
 */
export async function researchClaim(claim, { search = metaSearch, fetchText = fetchPageText, maxSources = BUDGET.maxSources, maxEvidence = BUDGET.maxEvidence, cache = true, ttlMs = CONFIG.RESEARCH_CACHE_TTL_MS, cacheKey: sharedKey, embedTexts = semanticVectors, rerankTexts = rerankScores, screenTexts = screenTextsWithGuard } = {}) {
  const cacheKey = `${sharedKey || String(claim).trim().toLowerCase()}|${collaboratorId(search)}|s${maxSources}e${maxEvidence}|${collaboratorId(embedTexts)}|${collaboratorId(rerankTexts)}|${collaboratorId(screenTexts)}`;
  const hit = cache && researchCache.get(cacheKey);
  if (hit && Date.now() - hit.at < ttlMs) return cloneResult(hit.result);
  const result = await researchClaimUncached(claim, { search, fetchText, maxSources, maxEvidence, embedTexts, rerankTexts, screenTexts });
  if (cache) {
    if (researchCache.size > 50) researchCache.clear();
    researchCache.set(cacheKey, { at: Date.now(), result: cloneResult(result) });
  }
  return result;
}

async function researchClaimUncached(claim, { search, fetchText, maxSources, maxEvidence, embedTexts, rerankTexts, screenTexts }) {
  // Batch-screen a set of passage texts once (regex + Prompt Guard 2,
  // lib/guard.mjs) and answer by text. A misaligned screener result
  // falls back to the regex screen for that text, never to allow-all.
  const screenBatch = async (texts) => {
    const unique = [...new Set(texts)];
    let screened = null;
    if (unique.length) {
      try {
        screened = await screenTexts(unique);
      } catch {
        screened = null;
      }
    }
    const byText = new Map(unique.map((t, i) => [t, screened?.[i] ?? screenContent(t)]));
    return (t) => (byText.get(t) ?? screenContent(t)).action === 'allow';
  };
  const found = await search(claim);
  const evidence = [];
  // Every budgeted source is fetched, in parallel. Marginal-gain early
  // stopping was measured and removed: one duplicate batch could hide a
  // late novel or contradicting source, and with maxSources already
  // budgeted at 8 the fetch savings were never worth a verdict. The
  // stoppedEarly stat stays in the result shape, honestly always false.
  const queue = found.sources.slice(0, maxSources);
  const stoppedEarly = false;
  const fetched = await mapWithConcurrency(queue, CONFIG.FETCH_CONCURRENCY, async (src) => {
    try {
      const raw = await fetchText(src.url);
      const passages = extractPassages(raw, claim, 2) || [];
      return { src, raw, passages, error: null };
    } catch (e) { return { src, raw: '', passages: [], error: e }; }
  });
  const failures = fetched.filter((f) => f.error).map((f) => ({ url: f.src.url, reason: String(f.error.message || f.error).slice(0, 200), ping: FETCH_FAILURE_PING }));
  const passageAllowed = await screenBatch(fetched.flatMap((f) => f.passages));
  for (const { src, raw, passages } of fetched) {
    const windows = pageWindows(raw);
    // Neighbouring windows ride along as judge context: a window cut
    // mid-argument reads differently alone. The cited passage itself
    // never changes; context is reading aid, not citation text.
    const contextFor = (passage) => {
      const i = windows.indexOf(passage);
      if (i < 0) return undefined;
      const near = [windows[i - 1], windows[i + 1]].filter(Boolean).join(' … ');
      return near ? near.slice(0, 320) : undefined;
    };
    for (const passage of passages) {
      if (evidence.some((e) => e.passage === passage)) continue;
      if (!passageAllowed(passage)) continue;
      const neighbour = contextFor(passage);
      const item = {
        id: `ev-web-${evidence.length + 1}`,
        title: src.title, source: (() => { try { return new URL(src.url).hostname; } catch { return src.url; } })(),
        url: src.url, date: extractPublishedDate(raw) || inTextDate(passage), passage, stance: 'unknown', fetchedAt: new Date().toISOString(),
        // Neighbouring windows are judge context, so they are screened
        // like passages: an injection next to a clean passage must not
        // ride into the prompt unscreened.
        ...(neighbour && screenContent(neighbour).action === 'allow' ? { context: neighbour } : {}),
      };
      evidence.push(item);
    }
  }
  // Semantic pass, when the sidecar answers: passages the lexical gates
  // dropped (synonyms share no stemmed tokens) get a second chance on
  // embedding cosine, every item is scored against the claim, and the
  // ranking below uses semantic vectors. Any failure falls back to
  // TF-IDF whole, exactly as before. A skipped pass is recorded in
  // degraded so the verdict can say so. Silence here once let a
  // keyword-only fallback pose as a full check.
  const degraded = [];
  if (embedTexts) {
    const extraCandidates = [];
    for (const f of fetched) {
      if (f.error) continue;
      for (const w of extractPassages(f.raw, claim, 4, true, { minOverlap: 0 }) || []) {
        if (!evidence.some((e) => e.passage === w) && !extraCandidates.some((x) => x.text === w)) {
          extraCandidates.push({ text: w, src: f.src, raw: f.raw });
        }
      }
    }
    // Optional enhancement: a throwing embedder degrades like a null
    // one, it never fails the whole claim.
    let sem = null;
    try {
      sem = evidence.length || extraCandidates.length
        ? await embedTexts([claim, ...evidence.map((e) => e.passage), ...extraCandidates.map((x) => x.text)])
        : null;
    } catch { sem = null; }
    if (!sem && (evidence.length || extraCandidates.length)) degraded.push('semantic');
    if (sem) {
      const claimVector = sem[0];
      const baseCount = evidence.length;
      const extraAllowed = await screenBatch(extraCandidates.map((x) => x.text));
      evidence.forEach((e, i) => { e.semanticScore = semanticCosine(claimVector, sem[i + 1]); });
      extraCandidates.forEach((x, j) => {
        const v = sem[baseCount + 1 + j];
        const score = semanticCosine(claimVector, v);
        if (score < CONFIG.SEMANTIC_RELEVANCE_THRESHOLD) return;
        if (!extraAllowed(x.text)) return;
        evidence.push({
          id: `ev-web-${evidence.length + 1}`,
          title: x.src.title, source: (() => { try { return new URL(x.src.url).hostname; } catch { return x.src.url; } })(),
          url: x.src.url, date: extractPublishedDate(x.raw) || inTextDate(x.text), passage: x.text, stance: 'unknown', fetchedAt: new Date().toISOString(),
          semanticScore: score,
        });
      });
    }
  }
  // Fuse the rankings (reciprocal rank fusion over TF-IDF cosine,
  // BM25, and semantic cosine when present) after removing near-
  // duplicate passages, then let the cross-encoder (when the sidecar
  // answers) make the final cut to maxEvidence. Source tier survives
  // as a small tie-break on the fused score.
  const deduped = dedupeNearDuplicates(evidence);
  const fitIdx = new VectorIndex();
  for (const e of deduped) fitIdx.add(e.id, e.passage);
  const rankings = [
    fitIdx.search(claim, deduped.length).map((h) => h.id),
    fitIdx.searchBM25(claim, deduped.length).map((h) => h.id),
  ];
  if (deduped.some((e) => e.semanticScore !== undefined)) {
    rankings.push([...deduped].sort((a, b) => (b.semanticScore ?? -1) - (a.semanticScore ?? -1)).map((e) => e.id));
  }
  const fused = reciprocalRankFusion(rankings);
  const pooled = capPoolByDomain(deduped
    .map((e) => ({ ...e, fusionScore: (fused.get(e.id) || 0) + sourceTier(e.source) * 0.0002 }))
    .sort((a, b) => b.fusionScore - a.fusionScore), CONFIG.MAX_POOL_PER_DOMAIN);
  let ranked = pooled.slice(0, maxEvidence);
  if (rerankTexts && pooled.length > maxEvidence) {
    // Optional enhancement too: a throwing reranker keeps the first
    // ranking and is reported, like a null score already was.
    let scores = null;
    try {
      scores = await rerankTexts(claim, pooled.map((e) => e.passage));
    } catch { scores = null; }
    if (scores) {
      ranked = pooled
        .map((e, i) => ({ ...e, rerankScore: scores[i] }))
        .sort((a, b) => b.rerankScore - a.rerankScore)
        .slice(0, maxEvidence);
    } else {
      degraded.push('rerank');
    }
  }
  return { queries: found.queries, sourcesFound: found.sources.length, evidence: ranked, citations: found.citations || [], failures, fetchedSources: fetched.length, stoppedEarly, degraded };
}

