import { createDocument, publicDocument } from '../../../../lib/store.mjs';
import { extractDocxPages } from '../../../../lib/docx.mjs';
import { pagesCharCount } from '../../../../lib/documents.mjs';
import { CONFIG } from '../../../../lib/config.mjs';
import { liveStatus, getModels } from '../../../../lib/meta.mjs';
import { authEnabled, requestUser } from '../../../../lib/auth.mjs';
import { storeOriginal, DOCX_MIME, ORIGINAL_NOT_KEPT_WARNING, contentLengthTooLarge, needsContentLength, boundedFormData } from '../../../../lib/media-store.mjs';
import { createBoundedLimiter, clientIp } from '../../../../lib/rate-limit.mjs';

const docxUploadLimiter = createBoundedLimiter({ windowMs: 60 * 1000, maxHits: 10, maxKeys: 1000 });
export function docxUploadRateLimited(key) {
  return docxUploadLimiter.check(key);
}

const MAX_BYTES = 15 * 1024 * 1024;

export function docxUploadTooLarge(fileSize, bufferLength, maxBytes = MAX_BYTES) {
  return Number(fileSize) > maxBytes || Number(bufferLength) > maxBytes;
}

export async function POST(req) {
  if (authEnabled() && !requestUser(req)) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const ip = clientIp(req);
  if (docxUploadRateLimited(`documents-docx:${ip}`)) return Response.json({ error: 'Too many uploads. Wait a minute and try again.' }, { status: 429, headers: { 'Retry-After': '60' } });
  if (contentLengthTooLarge(req, MAX_BYTES)) return Response.json({ error: 'DOCX is larger than 15 MB.' }, { status: 413 });
  if (needsContentLength(req)) return Response.json({ error: 'Uploads need a Content-Length header so oversize files fail fast. Your client did not send one.' }, { status: 411 });
  const { form, tooLarge } = await boundedFormData(req, MAX_BYTES);
  if (tooLarge) return Response.json({ error: 'DOCX is larger than 15 MB.' }, { status: 413 });
  const file = form?.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') return Response.json({ error: 'Choose a DOCX file first.' }, { status: 400 });
  if (Number(file.size) > MAX_BYTES) return Response.json({ error: 'DOCX is larger than 15 MB.' }, { status: 413 });
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > MAX_BYTES) return Response.json({ error: 'DOCX is larger than 15 MB.' }, { status: 413 });
  let pages;
  try {
    pages = extractDocxPages(buffer);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 400 });
  }
  if (!pages.length) return Response.json({ error: 'No readable text was found in that DOCX.' }, { status: 422 });
  if (pagesCharCount(pages) > CONFIG.MAX_DOCUMENT_CHARS) return Response.json({ error: `Document is longer than ${CONFIG.MAX_DOCUMENT_CHARS} characters.` }, { status: 413 });
  let stored = null;
  try {
    stored = await storeOriginal(buffer, DOCX_MIME, file.name);
  } catch (e) {
    console.error('[documents/docx] original file not stored:', e);
  }
  let doc;
  try {
    doc = await createDocument({ title: String(form.get('title') || file.name || 'Uploaded DOCX'), pages, ...(stored ? { media: { file: stored } } : {}), owner: requestUser(req)?.username || 'demo' });
  } catch (e) {
    console.error('[documents/docx] could not save the document:', e);
    return Response.json({ error: 'We could not save that DOCX. Try again.' }, { status: 500 });
  }
  return Response.json({ document: publicDocument(doc), ...(stored ? {} : { warning: ORIGINAL_NOT_KEPT_WARNING }), mode: liveStatus().configured ? 'live-ready' : 'demo', models: getModels() });
}
