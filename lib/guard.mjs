import { faissSidecarUrl } from './faiss.mjs';
import { screenContent } from './screen.mjs';

// Second screening layer: Llama Prompt Guard 2 in the Python sidecar,
// behind the regex screen in lib/screen.mjs. Regex hits quarantine at
// once and never reach the model. Regex-clean text the guard calls
// MALICIOUS quarantines as 'prompt-guard'. Optional by design, like
// embeddings, rerank, and NLI: no sidecar, a gated-model failure, or a
// malformed reply all leave the regex verdict standing unchanged.

const LABELS = ['BENIGN', 'MALICIOUS'];
// The guard runs on the research path, so a hung sidecar must not stall
// a verdict. Ten seconds is ample for the local 86M classifier and
// matches the page-fetch budget in lib/fetch.mjs.
const GUARD_TIMEOUT_MS = 10000;

/** @param {string[]} texts @param {{ sidecarUrl?: string, fetchImpl?: Function }} [opts] @returns {Promise<{ label: string, score: number }[] | null>} */
export async function guardVerdicts(texts, { sidecarUrl = faissSidecarUrl(), fetchImpl = fetch } = {}) {
  if (!sidecarUrl || !Array.isArray(texts) || !texts.length) return null;
  try {
    const res = await fetchImpl(`${sidecarUrl.replace(/\/$/, '')}/guard`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ texts }),
      signal: AbortSignal.timeout(GUARD_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const results = data?.results;
    if (!Array.isArray(results) || results.length !== texts.length) return null;
    if (!results.every((r) => LABELS.includes(r?.label) && Number.isFinite(r?.score))) return null;
    return results;
  } catch {
    return null;
  }
}

/**
 * Screen a batch: regex first, Prompt Guard 2 only on what the regex
 * allowed, one sidecar call for the whole batch. Result order matches
 * input order, in the same {action, category, matched} shape as
 * screenContent.
 * @param {string[]} texts @param {{ sidecarUrl?: string, fetchImpl?: Function, guardTexts?: Function }} [opts]
 * @returns {Promise<{ action: string, category: string | null, matched: string | null }[]>}
 */
export async function screenTextsWithGuard(texts, { guardTexts, ...opts } = {}) {
  const list = Array.isArray(texts) ? texts : [];
  const results = list.map((t) => screenContent(t));
  const pending = [];
  results.forEach((r, i) => { if (r.action === 'allow') pending.push(i); });
  if (!pending.length) return results;
  let verdicts;
  try {
    verdicts = await (guardTexts || guardVerdicts)(pending.map((i) => list[i]), opts);
  } catch {
    return results;
  }
  if (!Array.isArray(verdicts) || verdicts.length !== pending.length) return results;
  pending.forEach((idx, j) => {
    if (verdicts[j]?.label === 'MALICIOUS') {
      results[idx] = { action: 'quarantine', category: 'prompt-guard', matched: 'MALICIOUS' };
    }
  });
  return results;
}
