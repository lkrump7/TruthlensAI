import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

// Original uploads, kept so the library viewer can show the file
// itself, not only the text read from it. Bytes live on disk under a
// content-hash name; the document record holds only this metadata.
// Documents stay whole JSON aggregates in the repository, so file
// bytes must never join them: a 100 MB video in the JSON store would
// be re-read and re-written with every document save.

// The only types ever served inline. SVG and anything else a browser
// could execute in this origin's context is deliberately absent.
export const EXT_BY_MIME = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/flac': 'flac',
  'audio/aac': 'aac',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};
export const MIME_BY_EXT = Object.fromEntries(Object.entries(EXT_BY_MIME).map(([mime, ext]) => [ext, mime]));
export const ORIGINAL_NOT_KEPT_WARNING = 'The original file was not kept. The viewer will show the extracted text only.';
export const MAX_ORIGINAL_BYTES = 100 * 1024 * 1024;
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
// Multipart bodies are larger than the file itself. Reject early on the
// declared size so a huge upload fails before formData buffers it. The
// per-file byte checks after arrayBuffer stay as the enforcing check when
// the header lies or is missing.
const UPLOAD_OVERHEAD_BYTES = 2 * 1024 * 1024;
export function contentLengthTooLarge(req, maxBytes, overheadBytes = UPLOAD_OVERHEAD_BYTES) {
  const raw = req?.headers?.get?.('content-length');
  if (raw == null || raw === '') return false;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return false;
  return n > maxBytes + overheadBytes;
}

// True when the request declares no usable content-length. Undici never
// fills this header in on a constructed Request (it is a transport-layer
// header), and browsers always send it on multipart uploads, so treat a
// missing or malformed value as absent rather than as zero.
export function contentLengthMissing(req) {
  const raw = req?.headers?.get?.('content-length');
  if (raw == null || raw === '') return true;
  const n = Number(raw);
  return !Number.isFinite(n) || n < 0;
}

function isMultipartForm(req) {
  return String(req?.headers?.get?.('content-type') || '').toLowerCase().startsWith('multipart/');
}

// True when the route should refuse the upload with 411 Length Required:
// there is a body to bound, it is not multipart (headerless multipart only
// happens for in-process harness Requests, which the real-bytes checks
// still bound), and no usable length was declared.
export function needsContentLength(req) {
  if (req?.body == null) return false;
  if (isMultipartForm(req)) return false;
  return contentLengthMissing(req);
}

const STORED_NAME = /^[a-f0-9]{64}\.([a-z0-9]{2,5})$/;

export function mediaDir() {
  if (process.env.TRUTHLENS_MEDIA_DIR) return process.env.TRUTHLENS_MEDIA_DIR;
  return join(dirname(process.env.TRUTHLENS_STORE_FILE || 'data/documents.json'), 'media');
}

export function isStoredName(name) {
  const m = STORED_NAME.exec(String(name || ''));
  return !!(m && MIME_BY_EXT[m[1]]);
}

// Absolute path for a stored original, or null for any name that is
// not exactly a content-hash name this module could have written.
export function mediaPath(storedName) {
  return isStoredName(storedName) ? join(mediaDir(), storedName) : null;
}

function safeOriginalName(name) {
  const base = String(name || '').replace(/[/\\]/g, ' ').replace(/["\r\n]/g, '').trim();
  return base.slice(0, 160) || 'original';
}

// Stores the uploaded bytes and returns the metadata for
// doc.media.file, or null when the type is not one the viewer may
// serve. Identical bytes store once.
export async function storeOriginal(buffer, mime, originalName) {
  const ext = EXT_BY_MIME[String(mime || '').toLowerCase()];
  if (!ext || !buffer?.length || buffer.length > MAX_ORIGINAL_BYTES) return null;
  const storedName = `${createHash('sha256').update(buffer).digest('hex')}.${ext}`;
  const path = join(mediaDir(), storedName);
  if (!existsSync(path)) {
    await mkdir(mediaDir(), { recursive: true });
    await writeFile(path, buffer);
  }
  return { storedName, mime: MIME_BY_EXT[ext], ext, bytes: buffer.length, originalName: safeOriginalName(originalName) };
}

export async function readOriginal(storedName) {
  const path = mediaPath(storedName);
  if (!path) return null;
  try { return await readFile(path); } catch { return null; }
}

export async function statOriginal(storedName) {
  const path = mediaPath(storedName);
  if (!path) return null;
  try {
    const s = await stat(path);
    return s.isFile() ? { path, size: s.size } : null;
  } catch { return null; }
}

export async function removeOriginal(storedName) {
  const path = mediaPath(storedName);
  if (!path) return false;
  try { await unlink(path); return true; } catch { return false; }
}
