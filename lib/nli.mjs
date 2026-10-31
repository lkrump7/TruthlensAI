import { faissSidecarUrl } from './faiss.mjs';

// Natural language inference from the sidecar (DeBERTa MNLI): does this
// passage entail, contradict, or say nothing about the claim? The judge
// labels stances; NLI is an independent second opinion on those labels,
// and the agreement rate is reported rather than hidden. Optional:
// any failure returns null and the verdict is exactly as before.

const LABELS = ['entailment', 'neutral', 'contradiction'];

/** @param {[string, string][]} pairs @param {{ sidecarUrl?: string, fetchImpl?: Function }} [opts] @returns {Promise<{ label: string, score: number }[] | null>} */
export async function classifyStances(pairs, { sidecarUrl = faissSidecarUrl(), fetchImpl = fetch } = {}) {
  if (!sidecarUrl || !Array.isArray(pairs) || !pairs.length) return null;
  try {
    const res = await fetchImpl(`${sidecarUrl.replace(/\/$/, '')}/nli`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pairs }),
      signal: AbortSignal.timeout(180000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const results = data?.results;
    if (!Array.isArray(results) || results.length !== pairs.length) return null;
    if (!results.every((r) => LABELS.includes(r?.label) && Number.isFinite(r?.score))) return null;
    return results;
  } catch {
    return null;
  }
}
