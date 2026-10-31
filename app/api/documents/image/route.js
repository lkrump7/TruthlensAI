import { createDocument } from '../../../../lib/documents.mjs';
import { captionImage, BlankCaptionError, mimeForImageFile, IMAGE_MIME_BY_EXT, MAX_IMAGE_BYTES } from '../../../../lib/caption.mjs';
import { liveStatus, getModels } from '../../../../lib/meta.mjs';
import { requestUser } from '../../../../lib/auth.mjs';

const SUPPORTED_IMAGE_MIMES = new Set(Object.values(IMAGE_MIME_BY_EXT));

export async function POST(req) {
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
  let caption;
  try {
    caption = await captionImage(Buffer.from(await file.arrayBuffer()), { mime });
  } catch (e) {
    if (e instanceof BlankCaptionError) return Response.json({ error: e.message }, { status: 422 });
    return Response.json({ error: `Captioning failed. ${e.message}` }, { status: 502 });
  }
  const models = getModels();
  const doc = await createDocument({
    title: String(form.get('title') || file.name || 'Uploaded image'),
    pages: [{ page: 1, text: caption }],
    kind: 'image',
    media: { caption, model: models.spark },
    owner: requestUser(req)?.username || 'demo',
  });
  const { chunks, ...pub } = doc;
  return Response.json({ document: { ...pub, chunkCount: chunks.length }, caption, model: models.spark, mode: 'live-ready', models });
}
