// Pure page helpers, kept free of JSX and DOM access so node --test can run them.

/**
 * Decide whether a failed streamed check may fall back to the blocking
 * endpoint. HTTP errors (especially 429) must not fall back: the blocking
 * retry would burn quota a second time. Only network failures and
 * truncated streams (no verdict received) may fall back.
 * @param {unknown} err
 * @returns {boolean}
 */
export function shouldFallbackAfterStreamError(err) {
  if (!err || (typeof err === 'object' && err !== null && 'status' in err && typeof err.status === 'number')) return false;
  return true;
}

const MB = 1024 * 1024;
const UPLOAD_CLASSES = [
  { kind: 'pdf', re: /\.pdf$/i, bytes: 15 * MB, over: 'PDF is larger than 15 MB.' },
  { kind: 'docx', re: /\.docx$/i, bytes: 15 * MB, over: 'DOCX is larger than 15 MB.' },
  { kind: 'image', re: /\.(png|jpe?g|webp|gif)$/i, bytes: 10 * MB, over: 'Image is larger than 10 MB.' },
  { kind: 'video', re: /\.(mp4|mov|webm|mkv)$/i, bytes: 100 * MB, over: 'Video is larger than 100 MB.' },
  { kind: 'audio', re: /\.(mp3|wav|m4a|ogg|oga|opus|flac|aac)$/i, bytes: 50 * MB, over: 'Audio is larger than 50 MB.' },
  { kind: 'text', re: /\.(txt|md|markdown)$/i, bytes: 15 * MB, over: 'Text is larger than 15 MB.' },
];

/**
 * Classify an upload by file name before any bytes are read, so an
 * oversized text file is rejected on its byte size instead of being read
 * fully first. Unknown extensions are rejected rather than skipping limits.
 * @param {{ name?: string, size?: number }} [file]
 * @returns {{ ok: boolean, kind: string, error?: string }}
 */
export function classifyUpload({ name, size } = {}) {
  const fname = String(name || '');
  const entry = UPLOAD_CLASSES.find((l) => l.re.test(fname));
  if (!entry) return { ok: false, kind: 'unsupported', error: 'That file type is not supported. Add a PDF, DOCX, text, image, audio, or video file.' };
  const bytes = Number(size);
  if (Number.isFinite(bytes) && bytes > entry.bytes) return { ok: false, kind: entry.kind, error: entry.over };
  return { ok: true, kind: entry.kind };
}

/**
 * Claim location label. Prefers the first entry of pages[] when page is
 * missing, so claims carrying only pages[] never render "Page undefined".
 * @param {{ page?: number | null, pages?: Array<number> | null } | null | undefined} [claim]
 * @returns {string}
 */
export function pageLabel(claim) {
  const pages = Array.isArray(claim?.pages) ? claim.pages.filter((p) => p !== null && p !== undefined) : [];
  if (pages.length > 1) return `Pages ${pages.join(', ')}`;
  const page = pages.length === 1 ? pages[0] : claim?.page;
  return `Page ${page ?? '?'}`;
}
