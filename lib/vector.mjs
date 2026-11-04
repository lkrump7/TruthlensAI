import { termsOf } from './nlp.mjs';

// TF-IDF cosine search over stemmed terms (lib/nlp.mjs).
// Same contract as a FAISS IndexFlatIP index: add(id, text),
// search(text, k), embed(text) -> dense L2-normalised vector.
// Replaces the earlier hashed bag-of-words: stemming unifies word
// variants, IDF downweights terms every passage shares, sublinear
// term frequency (1 + ln tf) stops repetition from dominating, and
// bigrams keep short phrases intact. Fit before transform: embed and
// search use the vocabulary and document frequencies built by add(),
// so fit the index on the corpus first (callers do).

export { tokenize } from './nlp.mjs';

export function cosine(a, b) {
  // Vectors are L2-normalised at build time; missing trailing
  // coordinates are zeros (vocabulary grew between builds).
  let d = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) d += a[i] * b[i];
  return d;
}

export class VectorIndex {
  #items = new Map(); // id -> { id, text, counts: Map<term, number> }
  #df = new Map(); // term -> documents containing it
  #vocab = new Map(); // term -> column index

  #register(terms) {
    for (const t of terms) if (!this.#vocab.has(t)) this.#vocab.set(t, this.#vocab.size);
  }

  #idf(term) {
    const n = this.#items.size;
    const df = this.#df.get(term) || 0;
    return Math.log((n + 1) / (df + 1)) + 1;
  }

  #vectorFromCounts(counts, idfOf) {
    const v = new Array(this.#vocab.size).fill(0);
    const idf = idfOf || ((term) => this.#idf(term));
    for (const [term, count] of counts) {
      const col = this.#vocab.get(term);
      if (col === undefined) continue;
      v[col] = (1 + Math.log(count)) * idf(term);
    }
    let sum = 0;
    for (const x of v) sum += x * x;
    const norm = Math.sqrt(sum) || 1;
    return v.map((x) => x / norm);
  }

  static #countsOf(text) {
    const counts = new Map();
    for (const t of termsOf(text)) counts.set(t, (counts.get(t) || 0) + 1);
    return counts;
  }

  add(id, text) {
    const old = this.#items.get(id);
    if (old) for (const term of old.counts.keys()) this.#df.set(term, (this.#df.get(term) || 1) - 1);
    const counts = VectorIndex.#countsOf(text);
    this.#register(counts.keys());
    for (const term of counts.keys()) this.#df.set(term, (this.#df.get(term) || 0) + 1);
    this.#items.set(id, { id, text, counts });
  }

  embed(text) {
    return this.#vectorFromCounts(VectorIndex.#countsOf(text));
  }

  search(text, k = 5) {
    // Same scores and order as the brute-force version, faster: IDF is
    // fixed for the whole search so it is computed once per term, and
    // documents sharing no stemmed term with the query score exactly 0
    // (all TF-IDF entries are non-negative, so an empty intersection
    // means a zero dot product) and skip the dense build entirely. The
    // output array stays in insertion order before the stable sort, so
    // ties (including zeros filling k) come out identically.
    const qCounts = VectorIndex.#countsOf(text);
    const qTerms = [...qCounts.keys()];
    const idfCache = new Map();
    const idfOf = (term) => {
      let v = idfCache.get(term);
      if (v === undefined) { v = this.#idf(term); idfCache.set(term, v); }
      return v;
    };
    const q = this.#vectorFromCounts(qCounts, idfOf);
    const out = [];
    for (const it of this.#items.values()) {
      let shares = false;
      for (const t of qTerms) {
        if (it.counts.has(t)) { shares = true; break; }
      }
      const score = shares ? cosine(q, this.#vectorFromCounts(it.counts, idfOf)) : 0;
      out.push({ id: it.id, text: it.text, score });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, k);
  }

  // Okapi BM25 (k1 = 1.2, b = 0.75): term frequency saturates instead of
  // growing linearly, and long documents pay for their length. Scores
  // are unbounded and ranking-only; anywhere a threshold is calibrated
  // (dedupe, excerpt passages) cosine stays in charge.
  searchBM25(text, k = 5) {
    const queryTerms = [...new Set(termsOf(text))];
    const docs = [...this.#items.values()];
    if (!docs.length) return [];
    const lengths = docs.map((d) => [...d.counts.values()].reduce((a, b) => a + b, 0));
    const avgLen = lengths.reduce((a, b) => a + b, 0) / docs.length || 1;
    const K1 = 1.2, B = 0.75, N = docs.length;
    return docs.map((doc, di) => {
      let score = 0;
      for (const term of queryTerms) {
        const tf = doc.counts.get(term) || 0;
        if (!tf) continue;
        const df = this.#df.get(term) || 0;
        const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
        score += idf * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * (lengths[di] / avgLen)));
      }
      return { id: doc.id, text: doc.text, score };
    }).sort((a, b) => b.score - a.score).slice(0, k);
  }

  get size() { return this.#items.size; }
}
