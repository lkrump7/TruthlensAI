import { createDocument } from '../../../../lib/documents.mjs';
import { videoToPages, mimeForVideoFile, MAX_VIDEO_BYTES } from '../../../../lib/video.mjs';
import { voiceModel } from '../../../../lib/voice.mjs';
import { liveStatus, getModels } from '../../../../lib/meta.mjs';
import { requestUser } from '../../../../lib/auth.mjs';

export async function POST(req) {
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
  let pages;
  try {
    pages = await videoToPages(Buffer.from(await file.arrayBuffer()));
  } catch (e) {
    return Response.json({ error: `Transcription failed. ${e.message}` }, { status: 502 });
  }
  if (!pages.length) return Response.json({ error: 'No speech or readable frames were found in that video.' }, { status: 422 });
  const models = getModels();
  const transcript = pages.map((p) => p.text).join('\n');
  const doc = await createDocument({
    title: String(form.get('title') || file.name || 'Uploaded video'),
    pages,
    kind: 'video',
    media: { transcript, model: models.spark, voiceModel: voiceModel() },
    owner: requestUser(req)?.username || 'demo',
  });
  const { chunks, ...pub } = doc;
  return Response.json({ document: { ...pub, chunkCount: chunks.length }, transcript, pages, model: models.spark, voiceModel: voiceModel(), mode: 'live-ready', models });
}
