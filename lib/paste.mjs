// Pasted text needs no page markers. Explicit breaks (form feed or a
// --- page --- line) are honoured when present; pasted-as-is text is
// paginated at paragraph boundaries so claims still get page numbers.
export const PASTE_PAGE_CHARS = 3000;

function splitLongChunk(text) {
  if (text.length <= PASTE_PAGE_CHARS) return [text];
  const out = [];
  let current = '';
  const paras = text.split(/\n{2,}|\n/);
  for (const para of paras) {
    const piece = para;
    if (current && current.length + piece.length + 2 > PASTE_PAGE_CHARS) { out.push(current); current = ''; }
    if (!current && piece.length > PASTE_PAGE_CHARS) {
      // One oversized paragraph: split at sentence boundaries.
      const sentences = piece.split(/(?<=[.!?])\s+/);
      for (const s of sentences) {
        if (current && current.length + s.length + 1 > PASTE_PAGE_CHARS) { out.push(current); current = ''; }
        current = current ? `${current} ${s}` : s;
      }
    } else {
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current) out.push(current);
  return out.length ? out : [text];
}

export function pagesFromPastedText(text) {
  const raw = String(text || '');
  // A separator is a line of its own: honoured at the start or end of
  // the paste and with LF or CRLF endings, never kept as page text.
  const chunks = [];
  for (const part of raw.split('\f')) {
    let lines = [];
    const flush = () => { if (lines.length) { chunks.push(lines.join('\n')); lines = []; } };
    for (const line of part.split(/\r\n|\r|\n/)) {
      if (/^--- page ---$/i.test(line.trim())) flush();
      else lines.push(line);
    }
    flush();
  }
  const pages = [];
  for (const chunk of chunks) {
    for (const part of splitLongChunk(chunk)) {
      if (!String(part || '').trim()) continue;
      pages.push({ page: pages.length + 1, text: part });
    }
  }
  return pages;
}
