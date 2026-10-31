import { createDocument } from '../../../../lib/store.mjs';
import { extractPdfPages } from '../../../../lib/pdf.mjs';
import { ocrPdfPages } from '../../../../lib/ocr.mjs';
import { liveStatus, getModels } from '../../../../lib/meta.mjs';
import { currentUser } from '../../../../lib/auth.mjs';

const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(req) {
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') return Response.json({ error: 'Choose a PDF file first.' }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: 'PDF is larger than 15 MB.' }, { status: 413 });
  const buffer = Buffer.from(await file.arrayBuffer());
  let pages;
  try {
    pages = extractPdfPages(buffer);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 400 });
  }
  let ocrUsed = false;
  if (!pages.length) {
    try {
      pages = await ocrPdfPages(buffer);
      ocrUsed = pages.length > 0;
    } catch { /* no sidecar/vision configured: fall through to the honest 422 */ }
  }
  if (!pages.length) return Response.json({ error: 'No readable text layer found, and OCR is unavailable (start services/sidecar.py and set FAISS_SERVICE_URL).' }, { status: 422 });
  const doc = await createDocument({ title: String(form.get('title') || file.name || 'Uploaded PDF'), pages, owner: currentUser(req)?.username || 'demo' });
  doc.ocr = ocrUsed;
  const { chunks, ...pub } = doc;
  return Response.json({ document: { ...pub, chunkCount: chunks.length }, mode: liveStatus().configured ? 'live-ready' : 'demo', models: getModels() });
}
