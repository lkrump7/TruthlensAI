import { CONFIG } from './config.mjs';

// Exact cosine search over hashed token embeddings.
// Same contract as a FAISS IndexFlatIP index: add(id, text), search(text, k).
export function tokenize(text) {
  return String(text || '').toLowerCase().match(/[a-z0-9%]+/g) || [];
}
function hashToken(tok) {
  let h = 2166136261;
  for (let i = 0; i < tok.length; i++) { h ^= tok.charCodeAt(i); h = Math.imul(h, 16777619); }
  return Math.abs(h) % CONFIG.VECTOR_DIM;
}
export function cosine(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d; // vectors are L2-normalised at embed time
}
export class VectorIndex {
  #items = new Map();
  embed(text) {
    const v = new Array(CONFIG.VECTOR_DIM).fill(0);
    for (const tok of tokenize(text)) v[hashToken(tok)] += 1;
    let sum = 0;
    for (const x of v) sum += x * x;
    const n = Math.sqrt(sum) || 1;
    return v.map((x) => x / n);
  }
  add(id, text) { this.#items.set(id, { id, text, vector: this.embed(text) }); }
  search(text, k = 5) {
    const q = this.embed(text);
    return [...this.#items.values()]
      .map((it) => ({ id: it.id, text: it.text, score: cosine(q, it.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }
  get size() { return this.#items.size; }
}
