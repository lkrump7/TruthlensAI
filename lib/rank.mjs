import { CONFIG } from './config.mjs';
import { FaissClient } from './faiss.mjs';
import { VectorIndex, cosine } from './vector.mjs';

// Reciprocal rank fusion: an item's score is the sum over rankings of
// 1 / (k + rank). Rankings on different scales (cosine, BM25 logits,
// semantic cosine) combine without pretending the scales agree.
export function reciprocalRankFusion(rankings, k = 60) {
  const scores = new Map();
  for (const ranking of rankings || []) {
    (ranking || []).forEach((id, i) => scores.set(id, (scores.get(id) || 0) + 1 / (k + i + 1)));
  }
  return scores;
}

// Cap passages per domain in the ranked pool. One publisher repeated
// five times is not five sources; the cap leaves room in the judged
// pool for independent domains, which corroboration depends on.
export function capPoolByDomain(pooled, maxPerDomain = 3) {
  if (!maxPerDomain || maxPerDomain <= 0) return pooled || [];
  const counts = new Map();
  return (pooled || []).filter((e) => {
    const n = (counts.get(e.source) || 0) + 1;
    counts.set(e.source, n);
    return n <= maxPerDomain;
  });
}

// Drop passages that say the same thing as a kept passage (TF-IDF
// cosine at or above threshold). Two pages repeating one wire story
// are one piece of evidence; keeping both would fake corroboration.
// Measured scale: edited duplicates score 0.79-0.88, topically
// distinct passages at most 0.60, so 0.75 sits in the gap.
export function dedupeNearDuplicates(items, threshold = 0.75) {
  const idx = new VectorIndex();
  for (const e of items || []) idx.add(e.id, e.passage);
  const kept = [];
  const keptVectors = [];
  for (const e of items || []) {
    const v = idx.embed(e.passage);
    if (keptVectors.some((kv) => cosine(v, kv) >= threshold)) continue;
    kept.push(e);
    keptVectors.push(v);
  }
  return kept;
}

// One ranking contract for both search backends:
//   reset(items: [{id, vector}]) -> void
//   search(vector, k) -> [{id, score}]
// The pipeline picks a backend; ranking code never branches on which one.

const TIER_DOMAINS = ['nature.com', 'science.org', 'nih.gov', 'nasa.gov', 'who.int', 'britannica.com', 'scientificamerican.com', 'mit.edu', 'harvard.edu', 'stanford.edu', 'ox.ac.uk', 'cam.ac.uk', 'apa.org', 'royalsociety.org'];
export function sourceTier(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (/\.(gov|edu)(\.|$)/.test(h) || h.endsWith('.gov') || h.endsWith('.edu')) return 3;
  if (TIER_DOMAINS.some((d) => h === d || h.endsWith('.' + d))) return 2;
  if (h.endsWith('.org')) return 1;
  return 0;
}

function dot(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
}
const normOf = (v) => Math.sqrt(dot(v, v)) || 1;

export class LocalRankBackend {
  #items = new Map(); #dim = null;
  async reset(items) {
    const list = items || [];
    const dims = new Set(list.map((it) => it.vector.length));
    if (dims.size > 1) throw new Error(`vector dimension mismatch in reset items: ${[...dims].join(' vs ')}`);
    this.#items.clear();
    this.#dim = list.length ? list[0].vector.length : null;
    for (const it of list) this.#items.set(it.id, { vector: it.vector, norm: normOf(it.vector) });
  }
  async search(vector, k = 5) {
    if (this.#dim !== null && vector.length !== this.#dim) throw new Error(`vector dimension ${vector.length} does not match index dimension ${this.#dim}`);
    const qNorm = normOf(vector);
    return [...this.#items.entries()]
      .map(([id, it]) => ({ id, score: dot(vector, it.vector) / (qNorm * it.norm) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
}

export class FaissRankBackend {
  #client; #namespace;
  constructor(client, namespace) { this.#client = client; this.#namespace = namespace; }
  async reset(items) { await this.#client.add(this.#namespace, items || [], { reset: true }); }
  async search(vector, k = 5) { return this.#client.search(this.#namespace, vector, k); }
}

export function backendForClaim(claim, sidecarUrl) {
  if (sidecarUrl) {
    const ns = 'evidence-' + Buffer.from(String(claim).toLowerCase()).toString('hex').slice(0, 24);
    return new FaissRankBackend(new FaissClient(sidecarUrl), ns);
  }
  return new LocalRankBackend();
}

/**
 * Rank evidence for a claim through one backend, with a local fallback
 * when the sidecar fails. Source tier breaks near-ties toward primary sources.
 */
export async function rankEvidence({ claim, evidence, embed, maxEvidence = 5, sidecarUrl = '', backend = null }) {
  const items = (evidence || []).map((e) => ({ id: e.id, vector: embed(e.passage) }));
  const query = embed(claim);
  const run = async (b) => {
    await b.reset(items);
    const hits = await b.search(query, (evidence || []).length);
    const byId = new Map((evidence || []).map((e) => [e.id, e]));
    return hits
      .map((h) => ({ item: byId.get(h.id), score: h.score + sourceTier(byId.get(h.id)?.source) * CONFIG.SOURCE_TIER_WEIGHT }))
      .filter((r) => r.item)
      .sort((a, b) => b.score - a.score)
      .slice(0, maxEvidence)
      .map((r) => r.item);
  };
  const chosen = backend || backendForClaim(claim, sidecarUrl);
  try { return await run(chosen); }
  catch { return run(new LocalRankBackend()); }
}
