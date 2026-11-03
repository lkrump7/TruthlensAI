import { createDocument, publicDocument } from '../../../../lib/documents.mjs';
import { captionImage, BlankCaptionError, mimeForImageFile, IMAGE_MIME_BY_EXT, MAX_IMAGE_BYTES } from '../../../../lib/caption.mjs';
import { liveStatus, getModels } from '../../../../lib/meta.mjs';
import { authEnabled, requestUser } from '../../../../lib/auth.mjs';
import { storeOriginal, ORIGINAL_NOT_KEPT_WARNING, contentLengthTooLarge, needsContentLength } from '../../../../lib/media-store.mjs';
import { CONFIG } from '../../../../lib/config.mjs';
import { createBoundedLimiter, clientIp } from '../../../../lib/rate-limit.mjs';

const imageUploadLimiter = createBoundedLimiter({ windowMs: 60 * 1000, maxHits: 10, maxKeys: 1000 });
export function imageUploadRateLimited(key) {
  return imageUploadLimiter.check(key);
}

const SUPPORTED_IMAGE_MIMES = new Set(Object.values(IMAGE_MIME_BY_EXT));

export async function POST(req) {
  if (authEnabled() && !requestUser(req)) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const ip = clientIp(req);
  if (imageUploadRateLimited(`documents-image:${ip}`)) return Response.json({ error: 'Too many uploads. Wait a minute and try again.' }, { status: 429, headers: { 'Retry-After': '60' } });
  if (contentLengthTooLarge(req, MAX_IMAGE_BYTES)) return Response.json({ error: `Image is larger than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.` }, { status: 413 });
  if (needsContentLength(req)) return Response.json({ error: 'Uploads need a Content-Length header so oversize files fail fast. Your client did not send one.' }, { status: 411 });
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') return Response.json({ error: 'Choose an image file first.' }, { status: 400 });
  if (file.size > MAX_IMAGE_BYTES) return Response.json({ error: `Image is larger than ${MAX_IMAGE_BYTES / (1024 * 1024)} MB.` }, { status: 413 });
  const extMime = mimeForImageFile(file.name);
  const hasExtension = /\.[a-z0-9]+$/i.test(String(file.name || ''));
  const mime = extMime || (hasExtension ? null : (String(file.type || '').startsWith('image/') ? String(file.type) : null));
  if (!mime || !SUPPORTED_IMAGE_MIMES.has(mime)) return Response.json({ error: 'That is not an image TruthLens can caption. Use PNG, JPEG, WebP, or GIF.' }, { status: 400 });
  if (!liveStatus().configured) {
    return Response.json({ error: 'Image captioning is unavailable here. It needs Muse Spark vision on Meta Model API, and no Meta key is set on this deployment.' }, { status: 503 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  let caption;
  try {
    caption = await captionImage(buffer, { mime });
  } catch (e) {
    if (e instanceof BlankCaptionError) return Response.json({ error: e.message }, { status: 422 });
    return Response.json({ error: `Captioning failed. ${e.message}` }, { status: 502 });
  }
  if (String(caption || '').length > CONFIG.MAX_DOCUMENT_CHARS) return Response.json({ error: `Document is longer than ${CONFIG.MAX_DOCUMENT_CHARS} characters.` }, { status: 413 });
  const models = getModels();
  let stored = null;
  try {
    stored = await storeOriginal(buffer, mime, file.name);
  } catch (e) {
    console.error('[documents/image] original file not stored:', e);
  }
  const doc = await createDocument({
    title: String(form.get('title') || file.name || 'Uploaded image'),
    pages: [{ page: 1, text: caption }],
    kind: 'image',
    media: { caption, model: models.spark, ...(stored ? { file: stored } : {}) },
    owner: requestUser(req)?.username || 'demo',
  });
  return Response.json({ document: publicDocument(doc), ...(stored ? {} : { warning: ORIGINAL_NOT_KEPT_WARNING }), caption, model: models.spark, mode: 'live-ready', models });
}
