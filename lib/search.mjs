import { liveStatus, getModels } from './meta.mjs';
import { withRetry } from './fetch.mjs';
import { MetaApiError, isRetryableHttpStatus } from './errors.mjs';

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

export async function metaSearch(claim) {
  const status = liveStatus();
  if (!status.configured) throw new MetaApiError(`Meta live mode not configured: missing ${status.missing.join(', ')}`);
  const res = await withRetry(async () => {
    const r = await fetch(responsesUrl(process.env.META_MODEL_API_URL), {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.META_MODEL_API_KEY}` },
      body: JSON.stringify({
        model: getModels().spark,
        input: `Research this factual claim. Use neutral search wording — do not put a verdict (myth, false, debunked, proven) in any query. Run separate searches for: evidence supporting the claim, evidence contradicting it, and primary or official sources. Open the strongest sources on each side and cite them.\nClaim: ${claim}`,
        tools: [{ type: 'web_search' }],
        include: ['web_search_call.results'],
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!r.ok) throw new MetaApiError(`Meta search grounding returned ${r.status}`, { retryable: isRetryableHttpStatus(r.status) });
    return r;
  });
  return parseSearchResponse(await res.json());
}
