import { CONFIG } from './config.mjs';
import { semanticCosine } from './embed.mjs';

// Deterministic chunking: an id is document position, never global history.
export function chunkDocument(pages, size = CONFIG.CHUNK_SIZE) {
  const chunks = [];
  for (const p of pages || []) {
    const sentences = String(p.text || '').match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
    let buf = '';
    let n = 0;
    const flush = () => {
      if (buf.trim()) chunks.push({ id: `chunk-p${p.page}-${++n}`, page: p.page, text: buf.trim() });
      buf = '';
    };
    for (const s of sentences) {
      if ((buf + s).length > size && buf) flush();
      buf += s;
    }
    flush();
  }
  return chunks;
}

// Semantic chunking: same chunk shape and size cap, but a new chunk
// also starts where adjacent-sentence embedding similarity falls off a
// cliff (a topic change), instead of wherever the character count
// happened to land. Per page, so page attribution is untouched. Any
// embedding failure falls back to the fixed chunker for that page.
/** @param {any[]} pages @param {{ embedTexts?: Function, size?: number, threshold?: number }} [opts] */
export async function chunkDocumentSemantic(pages, { embedTexts, size = CONFIG.CHUNK_SIZE, threshold = CONFIG.SEMANTIC_CHUNK_THRESHOLD } = {}) {
  if (!embedTexts) return chunkDocument(pages, size);
  const chunks = [];
  for (const p of pages || []) {
    const sentences = String(p.text || '').match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
    const vectors = sentences.length > 2 ? await embedTexts(sentences) : null;
    if (!vectors) {
      chunks.push(...chunkDocument([p], size));
      continue;
    }
    let buf = '';
    let n = 0;
    const flush = () => {
      if (buf.trim()) chunks.push({ id: `chunk-p${p.page}-${++n}`, page: p.page, text: buf.trim() });
      buf = '';
    };
    for (let i = 0; i < sentences.length; i++) {
      const topicBreak = i > 0 && buf && semanticCosine(vectors[i - 1], vectors[i]) < threshold;
      if (buf && ((buf + sentences[i]).length > size || topicBreak)) flush();
      buf += sentences[i];
    }
    flush();
  }
  // Fixed chunker numbers per page from 1; semantic does the same, but
  // the fallback pages above may restart numbering. Renumber cleanly.
  const perPage = new Map();
  for (const c of chunks) {
    const n = (perPage.get(c.page) || 0) + 1;
    perPage.set(c.page, n);
    c.id = `chunk-p${c.page}-${n}`;
  }
  return chunks;
}
