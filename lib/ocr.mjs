import { FaissClient, faissSidecarUrl } from './faiss.mjs';
import { getModels } from './meta.mjs';
import { OCR_SYSTEM, OCR_INSTRUCTION } from './prompts.mjs';

// OCR for scanned PDFs: sidecar renders pages to PNG, Muse Spark vision transcribes.
// Without a sidecar there is no honest OCR path, so this refuses clearly.
/**
 * @param {any} pdfBuffer
 * @param {{ sidecarUrl?: string, fetchImpl?: Function, vision?: Function }} [opts]
 */
export async function ocrPdfPages(pdfBuffer, { sidecarUrl = faissSidecarUrl(), fetchImpl, vision } = {}) {
  if (!sidecarUrl) throw new Error('OCR needs the Python sidecar (set FAISS_SERVICE_URL to services/sidecar.py) to render scanned pages');
  const client = new FaissClient(sidecarUrl, fetchImpl);
  const { pages } = await client.renderPdf(pdfBuffer);
  const transcribe = vision || defaultVision;
  const out = [];
  for (const p of pages || []) {
    const text = String(await transcribe(p.imageBase64)).trim();
    if (text) out.push({ page: p.page, text });
  }
  return out;
}

async function defaultVision(imageBase64) {
  const apiUrl = process.env.META_MODEL_API_URL;
  const apiKey = process.env.META_MODEL_API_KEY;
  if (!apiUrl || !apiKey) throw new Error('OCR vision needs Meta Model API credentials');
  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: getModels().spark,
      messages: [
        { role: 'system', content: OCR_SYSTEM },
        { role: 'user', content: [
          { type: 'text', text: OCR_INSTRUCTION },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
        ] },
      ],
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error(`OCR vision returned ${res.status}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}
