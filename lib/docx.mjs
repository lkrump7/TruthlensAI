import { inflateRawSync } from 'node:zlib';

// Minimal DOCX text extraction, no dependencies: a DOCX is a zip, and the
// words live in word/document.xml. Local zip entries are scanned in order;
// stored (0) and deflated (8) entries are read, CRCs are not verified.
// Word does not store fixed pages, so pages split on explicit page breaks
// and, past a size cap, on paragraph boundaries.

const MAX_PAGE_CHARS = 6000;
export const MAX_DOCX_ENTRIES = 512;
export const MAX_DOCX_ENTRY_BYTES = 16 * 1024 * 1024;
export const MAX_DOCX_TOTAL_BYTES = 32 * 1024 * 1024;

function inflateEntry(method, data) {
  try {
    return method === 8 ? inflateRawSync(data, { maxOutputLength: MAX_DOCX_ENTRY_BYTES }) : Buffer.from(data);
  } catch (e) {
    if (e && (e.code === 'ERR_BUFFER_TOO_LARGE' || e instanceof RangeError)) throw new Error('DOCX content is too large to read safely.');
    throw e;
  }
}

// The central directory carries every entry's real compressed size and
// local-header offset. Streaming zip writers zero those fields in the
// local header and append a data descriptor instead, so the directory
// is the only reliable map of the archive.
function entriesFromCentralDirectory(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65536); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  if (count > MAX_DOCX_ENTRIES) throw new Error('DOCX has too many entries to read safely.');
  let pos = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  let totalBytes = 0;
  for (let n = 0; n < count && pos + 46 <= buf.length && buf.readUInt32LE(pos) === 0x02014b50; n++) {
    const method = buf.readUInt16LE(pos + 10);
    const compSize = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localPos = buf.readUInt32LE(pos + 42);
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
    pos += 46 + nameLen + extraLen + commentLen;
    if (localPos + 30 > buf.length || buf.readUInt32LE(localPos) !== 0x04034b50) continue;
    const dataStart = localPos + 30 + buf.readUInt16LE(localPos + 26) + buf.readUInt16LE(localPos + 28);
    try {
      const inflated = inflateEntry(method, buf.subarray(dataStart, dataStart + compSize));
      totalBytes += inflated.length;
      if (totalBytes > MAX_DOCX_TOTAL_BYTES) throw new Error('DOCX content is too large to read safely.');
      entries.set(name, inflated);
    } catch (e) {
      if (/too large|too many/.test(e.message)) throw e;
      /* a damaged entry is skipped; missing document text fails below */
    }
  }
  return entries;
}

function readZipEntries(buf) {
  const fromDirectory = entriesFromCentralDirectory(buf);
  if (fromDirectory) return fromDirectory;
  const entries = new Map();
  let totalBytes = 0;
  let pos = 0;
  while (pos + 30 <= buf.length && buf.readUInt32LE(pos) === 0x04034b50) {
    const method = buf.readUInt16LE(pos + 8);
    const flags = buf.readUInt16LE(pos + 6);
    let compSize = buf.readUInt32LE(pos + 18);
    const nameLen = buf.readUInt16LE(pos + 26);
    const extraLen = buf.readUInt16LE(pos + 28);
    const name = buf.subarray(pos + 30, pos + 30 + nameLen).toString('utf8');
    const dataStart = pos + 30 + nameLen + extraLen;
    let next = dataStart + compSize;
    if (compSize === 0 && (flags & 0x08)) {
      // Sizes live in a data descriptor after the data: find its
      // signature, read the compressed size out of it, and step past it.
      const desc = buf.indexOf(Buffer.from([0x50, 0x4b, 0x07, 0x08]), dataStart);
      if (desc < 0) break;
      compSize = buf.readUInt32LE(desc + 8);
      next = desc + 16;
    }
    if (entries.size >= MAX_DOCX_ENTRIES) throw new Error('DOCX has too many entries to read safely.');
    const data = buf.subarray(dataStart, dataStart + compSize);
    try {
      const inflated = inflateEntry(method, data);
      totalBytes += inflated.length;
      if (totalBytes > MAX_DOCX_TOTAL_BYTES) throw new Error('DOCX content is too large to read safely.');
      entries.set(name, inflated);
    } catch (e) {
      if (/too large|too many/.test(e.message)) throw e;
      /* a damaged entry is skipped; missing document text fails below */
    }
    pos = next;
  }
  return entries;
}

function safeCodePoint(n) {
  return Number.isFinite(n) && n >= 0 && n <= 0x10FFFF ? String.fromCodePoint(n) : '\uFFFD';
}

function decodeXmlEntities(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function splitLongPage(text) {
  if (text.length <= MAX_PAGE_CHARS) return [text];
  const out = [];
  let current = '';
  for (const para of text.split('\n')) {
    if (current && current.length + para.length + 1 > MAX_PAGE_CHARS) { out.push(current); current = ''; }
    current = current ? `${current}\n${para}` : para;
  }
  if (current) out.push(current);
  return out.length ? out : [text];
}

export function extractDocxPages(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || '');
  if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) throw new Error('Not a DOCX file');
  const entries = readZipEntries(buf);
  const xmlBuf = entries.get('word/document.xml');
  if (!xmlBuf) throw new Error('Not a DOCX file: word/document.xml is missing');
  const xml = xmlBuf.toString('utf8')
    .replace(/<w:tab\s*\/?>/g, '\t')
    .replace(/<w:br[^>]*w:type="page"[^>]*\/?>/g, '\f')
    .replace(/<w:lastRenderedPageBreak\s*\/?>/g, '\f')
    .replace(/<w:br\s*\/?>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '');
  const text = decodeXmlEntities(xml);
  const pages = [];
  for (const chunk of text.split('\f')) {
    const cleaned = chunk.split('\n').map((line) => line.trim()).filter(Boolean).join('\n');
    if (!cleaned || !/[A-Za-z]{3,}/.test(cleaned)) continue;
    for (const part of splitLongPage(cleaned)) pages.push({ page: pages.length + 1, text: part });
  }
  return pages;
}
