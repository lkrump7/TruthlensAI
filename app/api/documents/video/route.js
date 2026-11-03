import { createDocument, publicDocument } from '../../../../lib/documents.mjs';
import { videoToPages, mimeForVideoFile, MAX_VIDEO_BYTES } from '../../../../lib/video.mjs';
import { voiceModel } from '../../../../lib/voice.mjs';
import { liveStatus, getModels } from '../../../../lib/meta.mjs';
import { authEnabled, requestUser } from '../../../../lib/auth.mjs';
import { storeOriginal, ORIGINAL_NOT_KEPT_WARNING, contentLengthTooLarge, needsContentLength } from '../../../../lib/media-store.mjs';
import { pagesCharCount } from '../../../../lib/documents.mjs';
import { CONFIG } from '../../../../lib/config.mjs';
import { createBoundedLimiter, clientIp } from '../../../../lib/rate-limit.mjs';

const videoUploadLimiter = createBoundedLimiter({ windowMs: 60 * 1000, maxHits: 10, maxKeys: 1000 });
export function videoUploadRateLimited(key) {
  return videoUploadLimiter.check(key);
}

export async function POST(req) {
  if (authEnabled() && !requestUser(req)) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const ip = clientIp(req);
  if (videoUploadRateLimited(`documents-video:${ip}`)) return Response.json({ error: 'Too many uploads. Wait a minute and try again.' }, { status: 429, headers: { 'Retry-After': '60' } });
  if (contentLengthTooLarge(req, MAX_VIDEO_BYTES)) return Response.json({ error: `Video is larger than ${MAX_VIDEO_BYTES / (1024 * 1024)} MB.` }, { status: 413 });
  if (needsContentLength(req)) return Response.json({ error: 'Uploads need a Content-Length header so oversize files fail fast. Your client did not send one.' }, { status: 411 });
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') return Response.json({ error: 'Choose a video file first.' }, { status: 400 });
  if (file.size > MAX_VIDEO_BYTES) return Response.json({ error: `Video is larger than ${MAX_VIDEO_BYTES / (1024 * 1024)} MB.` }, { status: 413 });
  if (!mimeForVideoFile(file.name) && !String(file.type || '').startsWith('video/')) {
    return Response.json({ error: 'That is not a video TruthLens can transcribe. Use MP4, MOV, WebM, or MKV.' }, { status: 400 });
  }
  if (!liveStatus().configured) {
    return Response.json({ error: 'Video transcription is unavailable here. It needs Muse Voice Transcribe and Muse Spark vision on Meta Model API, and no Meta key is set on this deployment.' }, { status: 503 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  let pages;
  let durationSec;
  try {
    ({ pages, durationSec } = await videoToPages(buffer));
  } catch (e) {
    return Response.json({ error: `Transcription failed. ${e.message}` }, { status: 502 });
  }
  if (!pages.length) return Response.json({ error: 'No speech or readable frames were found in that video.' }, { status: 422 });
  if (pagesCharCount(pages) > CONFIG.MAX_DOCUMENT_CHARS) return Response.json({ error: `Document is longer than ${CONFIG.MAX_DOCUMENT_CHARS} characters.` }, { status: 413 });
  const models = getModels();
  const transcript = pages.map((p) => p.text).join('\n');
  // Only the filename extension names the stored format. The client
  // supplied type is enough to attempt transcription, never to label
  // bytes the viewer will serve back.
  const storedMime = mimeForVideoFile(file.name);
  let stored = null;
  if (storedMime) {
    try {
      stored = await storeOriginal(buffer, storedMime, file.name);
    } catch (e) {
      console.error('[documents/video] original file not stored:', e);
    }
  }
  const doc = await createDocument({
    title: String(form.get('title') || file.name || 'Uploaded video'),
    pages,
    kind: 'video',
    media: { durationSec, transcript, model: models.spark, voiceModel: voiceModel(), ...(stored ? { file: stored } : {}) },
    owner: requestUser(req)?.username || 'demo',
  });
  return Response.json({ document: publicDocument(doc), ...(stored ? {} : { warning: ORIGINAL_NOT_KEPT_WARNING }), transcript, pages, model: models.spark, voiceModel: voiceModel(), mode: 'live-ready', models });
}
