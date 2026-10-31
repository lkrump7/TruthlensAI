import { CONFIG } from './config.mjs';

// Deterministic chunking: an id is document position, never global history.
export function chunkDocument(pages, size = CONFIG.CHUNK_SIZE) {
  const chunks = [];
  for (const p of pages || []) {
    const sentences = String(p.text || '').match(/[^.!?]+[.!?]+|\S+$/g) || [];
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
