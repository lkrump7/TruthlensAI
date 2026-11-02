import { createDocument, publicDocument } from '../../../../lib/store.mjs';
import { extractPdfPages, pdfNeedsOcr } from '../../../../lib/pdf.mjs';
import { pagesCharCount } from '../../../../lib/documents.mjs';
import { CONFIG } from '../../../../lib/config.mjs';
import { ocrPdfPages } from '../../../../lib/ocr.mjs';
import { liveStatus, getModels } from '../../../../lib/meta.mjs';
import { authEnabled, requestUser } from '../../../../lib/auth.mjs';
import { storeOriginal, ORIGINAL_NOT_KEPT_WARNING } from '../../../../lib/media-store.mjs';

const MAX_BYTES = 15 * 1024 * 1024;

export function pdfUploadTooLarge(fileSize, bufferLength, maxBytes = MAX_BYTES) {
  return Number(fileSize) > maxBytes || Number(bufferLength) > maxBytes;
}

export async function POST(req) {
  if (authEnabled() && !requestUser(req)) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') return Response.json({ error: 'Choose a PDF file first.' }, { status: 400 });
  if (Number(file.size) > MAX_BYTES) return Response.json({ error: 'PDF is larger than 15 MB.' }, { status: 413 });
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > MAX_BYTES) return Response.json({ error: 'PDF is larger than 15 MB.' }, { status: 413 });
  let pages;
  try {
    pages = extractPdfPages(buffer);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 400 });
  }
  let ocrUsed = false;
  if (pdfNeedsOcr(pages)) {
    const textPages = pages;
    try {
      const ocrPages = await ocrPdfPages(buffer);
      if (ocrPages.length) { pages = ocrPages; ocrUsed = true; } else pages = textPages;
    } catch { pages = textPages; /* keep any text layer when OCR is unavailable */ }
  }
  if (!pages.length) return Response.json({ error: 'No readable text layer found, and OCR is unavailable (start services/sidecar.py and set FAISS_SERVICE_URL).' }, { status: 422 });
  if (pagesCharCount(pages) > CONFIG.MAX_DOCUMENT_CHARS) return Response.json({ error: `Document is longer than ${CONFIG.MAX_DOCUMENT_CHARS} characters.` }, { status: 413 });
  let stored = null;
  try {
    stored = await storeOriginal(buffer, 'application/pdf', file.name);
  } catch (e) {
    console.error('[documents/pdf] original file not stored:', e);
  }
  const doc = await createDocument({ title: String(form.get('title') || file.name || 'Uploaded PDF'), pages, ocr: ocrUsed, ...(stored ? { media: { file: stored } } : {}), owner: requestUser(req)?.username || 'demo' });
  return Response.json({ document: publicDocument(doc), ...(stored ? {} : { warning: ORIGINAL_NOT_KEPT_WARNING }), mode: liveStatus().configured ? 'live-ready' : 'demo', models: getModels() });
}
