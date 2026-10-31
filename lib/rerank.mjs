import { faissSidecarUrl } from './faiss.mjs';

// Cross-encoder reranking from the sidecar (ms-marco MiniLM). A
// cross-encoder reads claim and passage together, which bi-encoder
// cosine cannot do, and is the stronger relevance judge for the pool
// cut. Optional: any failure returns null and the bi-encoder ranking
// stands unchanged.

/** @param {string} query @param {string[]} texts @param {{ sidecarUrl?: string, fetchImpl?: Function }} [opts] @returns {Promise<number[] | null>} */
export async function rerankScores(query, texts, { sidecarUrl = faissSidecarUrl(), fetchImpl = fetch } = {}) {
  if (!sidecarUrl || !Array.isArray(texts) || !texts.length) return null;
  try {
    const res = await fetchImpl(`${sidecarUrl.replace(/\/$/, '')}/rerank`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, passages: texts }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const scores = data?.scores;
    if (!Array.isArray(scores) || scores.length !== texts.length) return null;
    if (!scores.every((x) => Number.isFinite(x))) return null;
    return scores;
  } catch {
    return null;
  }
}
