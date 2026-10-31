import { liveStatus, getModels } from './meta.mjs';
import { termsOf } from './nlp.mjs';
import { withRetry } from './fetch.mjs';
import { MetaApiError, isRetryableHttpStatus } from './errors.mjs';
import { liveCallLimiter } from './limit.mjs';
import { createBreaker } from './breaker.mjs';
import { CONFIG } from './config.mjs';

const searchBreaker = createBreaker({ threshold: CONFIG.BREAKER_THRESHOLD, cooldownMs: CONFIG.BREAKER_COOLDOWN_MS });

// Meta search grounding via the Responses API. Search results are leads, never evidence.
export function responsesUrl(configured) {
  const u = String(configured || '');
  if (u.endsWith('/chat/completions')) return u.slice(0, -'/chat/completions'.length) + '/responses';
  if (u.endsWith('/responses')) return u;
  return u.replace(/\/$/, '') + '/responses';
}

export function parseSearchResponse(json) {
  const queries = [], sources = [], citations = [];
  const seen = new Set();
  for (const item of json?.output || []) {
    if (item.type === 'web_search_call') {
      if (item.action?.query) queries.push(item.action.query);
      for (const r of item.results || []) {
        if (!r.url || seen.has(r.url)) continue;
        seen.add(r.url);
        sources.push({ title: r.title || r.url, url: r.url });
      }
    }
    if (item.type === 'message') {
      for (const c of item.content || []) {
        for (const a of c.annotations || []) {
          if (a.type !== 'url_citation' || !a.url) continue;
          if (!seen.has(a.url)) { seen.add(a.url); sources.push({ title: a.title || a.url, url: a.url }); }
          citations.push({ url: a.url, title: a.title || a.url, text: (c.text || '').slice(a.start_index ?? 0, a.end_index ?? undefined) });
        }
      }
    }
  }
  const citedUrls = new Set(citations.map((c) => c.url));
  sources.sort((a, b) => (citedUrls.has(b.url) ? 1 : 0) - (citedUrls.has(a.url) ? 1 : 0));
  return { queries, sources, citations };
}

// Deterministic query expansion: the claim as written, its stemmed
// keyword core, a primary-evidence angle, and a criticism angle. All
// wording stays neutral; verdict words (myth, false, debunked) would
// bias what the search returns, so they are never generated here.
const VERDICT_STEMS = new Set(['myth', 'debunk', 'fals', 'proven', 'hoax']);
export function expandQueries(claim) {
  // The claim as written may carry verdict wording; generated variants
  // must not inherit it and bias what search returns.
  const keywords = [...new Set(termsOf(claim).filter((t) => !t.includes('~')))].filter((t) => !VERDICT_STEMS.has(t)).slice(0, 8);
  const core = keywords.slice(0, 5).join(' ');
  const queries = [String(claim)];
  if (keywords.length >= 2) queries.push(keywords.join(' '));
  if (core) {
    queries.push(`${core} study trial evidence`);
    queries.push(`${core} criticism limitations review`);
  }
  return [...new Set(queries)];
}

export async function metaSearch(claim) {
  const status = liveStatus();
  if (!status.configured) throw new MetaApiError(`Meta live mode not configured: missing ${status.missing.join(', ')}`);
  const res = await searchBreaker.exec(() => liveCallLimiter(() => withRetry(async () => {
    const r = await fetch(responsesUrl(process.env.META_MODEL_API_URL), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.META_MODEL_API_KEY}` },
      body: JSON.stringify({
        model: getModels().spark,
        input: `Research this factual claim. Use neutral search wording — do not put a verdict (myth, false, debunked, proven) in any query. Run separate searches for: evidence supporting the claim, evidence contradicting it, and primary or official sources. Open the strongest sources on each side and cite them.\nClaim: ${claim}\nSearch variants to run:\n${expandQueries(claim).map((q, i) => `${i + 1}. ${q}`).join('\n')}`,
        tools: [{ type: 'web_search' }],
        include: ['web_search_call.results'],
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!r.ok) throw new MetaApiError(`Meta search grounding returned ${r.status}`, { retryable: isRetryableHttpStatus(r.status) });
    return r;
  })));
  return parseSearchResponse(await res.json());
}
