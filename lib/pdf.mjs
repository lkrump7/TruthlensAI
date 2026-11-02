import { inflateSync } from 'node:zlib';

// Minimal text-layer PDF extraction: content streams (plain or FlateDecode),
// Tj/TJ text operators, parenthesised strings with basic escapes.
// Scanned/image PDFs have no text layer and yield no pages — by design.

function decodePdfString(raw) {
  return raw
    .replace(/\\([nrtbf()\\])/g, (_, c) => ({ n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[c] || c))
    .replace(/\\(\d{1,3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)));
}

function decodeHexString(hex) {
  const clean = String(hex).replace(/\s+/g, '');
  const bytes = Buffer.from(clean.length % 2 ? clean + '0' : clean, 'hex');
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return Buffer.from(bytes.subarray(2)).swap16().toString('utf16le');
  return bytes.toString('latin1');
}

function textFromContent(content) {
  const parts = [];
  const re = /\((?:\\.|[^\\()])*\)\s*(?:Tj|')|<([0-9a-fA-F\s]+)>\s*Tj|\[(?:[^\]])*\]\s*TJ/g;
  let m;
  while ((m = re.exec(content))) {
    const chunk = m[0];
    if (m[1]) { parts.push(decodeHexString(m[1])); continue; }
    const strings = chunk.match(/\((?:\\.|[^\\()])*\)|<([0-9a-fA-F\s]+)>/g) || [];
    for (const s of strings) {
      if (s.startsWith('<')) parts.push(decodeHexString(s.slice(1, -1)));
      else parts.push(decodePdfString(s.slice(1, -1)));
    }
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

export const MAX_PDF_STREAM_BYTES = 8 * 1024 * 1024;
export const MAX_PDF_TOTAL_BYTES = 16 * 1024 * 1024;

export function pdfNeedsOcr(pages) {
  const total = (pages || []).reduce((n, p) => n + String(p.text || '').trim().length, 0);
  return total < 120;
}

export function extractPdfPages(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('Not a PDF file');
  const raw = buf.toString('latin1');
  const pages = [];
  let totalBytes = 0;
  let pos = 0;
  for (;;) {
    const start = raw.indexOf('stream', pos);
    if (start < 0) break;
    const dictStart = Math.max(0, start - 300);
    const dict = raw.slice(dictStart, start);
    let dataStart = start + 'stream'.length;
    if (raw[dataStart] === '\r') dataStart++;
    if (raw[dataStart] === '\n') dataStart++;
    const end = raw.indexOf('endstream', dataStart);
    if (end < 0) break;
    let dataEnd = end;
    if (raw[dataEnd - 1] === '\n') dataEnd--;
    if (raw[dataEnd - 1] === '\r') dataEnd--;
    pos = end + 'endstream'.length;
    let content = null;
    try {
      const bytes = Buffer.from(raw.slice(dataStart, dataEnd), 'latin1');
      content = /FlateDecode/.test(dict) ? inflateSync(bytes, { maxOutputLength: MAX_PDF_STREAM_BYTES }).toString('latin1') : bytes.toString('latin1');
    } catch (e) {
      if (e && (e.code === 'ERR_BUFFER_TOO_LARGE' || e instanceof RangeError)) throw new Error('PDF content is too large to read safely.');
      continue;
    }
    totalBytes += content.length;
    if (totalBytes > MAX_PDF_TOTAL_BYTES) throw new Error('PDF content is too large to read safely.');
    const text = textFromContent(content);
    if (text && /[A-Za-z]{3,}/.test(text)) pages.push({ page: pages.length + 1, text });
  }
  return pages;
}
