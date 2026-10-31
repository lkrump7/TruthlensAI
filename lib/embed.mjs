import { faissSidecarUrl } from './faiss.mjs';

// Semantic embeddings from the Python sidecar (sentence-transformers,
// all-mpnet-base-v2). This is the synonymy layer TF-IDF cannot do:
// "heart attack" and "myocardial infarction" land near each other.
// Optional by design. No sidecar, a failed call, or a malformed reply
// all return null, and ranking falls back to TF-IDF unchanged.

/** Cosine between two embedding vectors, norms handled. @param {number[]} a @param {number[]} b */
export function semanticCosine(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/** @param {string[]} texts @param {{ sidecarUrl?: string, fetchImpl?: Function }} [opts] @returns {Promise<number[][] | null>} */
export async function semanticVectors(texts, { sidecarUrl = faissSidecarUrl(), fetchImpl = fetch } = {}) {
  if (!sidecarUrl || !Array.isArray(texts) || !texts.length) return null;
  try {
    const res = await fetchImpl(`${sidecarUrl.replace(/\/$/, '')}/embed`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ texts }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const vectors = data?.vectors;
    if (!Array.isArray(vectors) || vectors.length !== texts.length) return null;
    if (!vectors.every((v) => Array.isArray(v) && v.length && v.every((x) => Number.isFinite(x)))) return null;
    return vectors;
  } catch {
    return null;
  }
}
