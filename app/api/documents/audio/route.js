import { createDocument, publicDocument } from '../../../../lib/documents.mjs';
import { audioToPages, mimeForAudioFile, makePlaybackAudio, MAX_AUDIO_FILE_BYTES } from '../../../../lib/audio.mjs';
import { voiceModel } from '../../../../lib/voice.mjs';
import { liveStatus, getModels } from '../../../../lib/meta.mjs';
import { authEnabled, requestUser } from '../../../../lib/auth.mjs';
import { storeOriginal, ORIGINAL_NOT_KEPT_WARNING } from '../../../../lib/media-store.mjs';
import { pagesCharCount } from '../../../../lib/documents.mjs';
import { CONFIG } from '../../../../lib/config.mjs';
import { contentLengthTooLarge, needsContentLength, boundedFormData } from '../../../../lib/media-store.mjs';
import { createBoundedLimiter, clientIp } from '../../../../lib/rate-limit.mjs';

const audioUploadLimiter = createBoundedLimiter({ windowMs: 60 * 1000, maxHits: 10, maxKeys: 1000 });
export function audioUploadRateLimited(key) {
  return audioUploadLimiter.check(key);
}

export async function POST(req) {
  if (authEnabled() && !requestUser(req)) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const ip = clientIp(req);
  if (audioUploadRateLimited(`documents-audio:${ip}`)) return Response.json({ error: 'Too many uploads. Wait a minute and try again.' }, { status: 429, headers: { 'Retry-After': '60' } });
  if (contentLengthTooLarge(req, MAX_AUDIO_FILE_BYTES)) return Response.json({ error: `Audio is larger than ${MAX_AUDIO_FILE_BYTES / (1024 * 1024)} MB.` }, { status: 413 });
  if (needsContentLength(req)) return Response.json({ error: 'Uploads need a Content-Length header so oversize files fail fast. Your client did not send one.' }, { status: 411 });
  const { form, tooLarge } = await boundedFormData(req, MAX_AUDIO_FILE_BYTES);
  if (tooLarge) return Response.json({ error: `Audio is larger than ${MAX_AUDIO_FILE_BYTES / (1024 * 1024)} MB.` }, { status: 413 });
  const file = form?.get('file');
  if (!file || typeof file.arrayBuffer !== 'function') return Response.json({ error: 'Choose an audio file first.' }, { status: 400 });
  if (file.size > MAX_AUDIO_FILE_BYTES) return Response.json({ error: `Audio is larger than ${MAX_AUDIO_FILE_BYTES / (1024 * 1024)} MB.` }, { status: 413 });
  if (!mimeForAudioFile(file.name) && !String(file.type || '').startsWith('audio/')) {
    return Response.json({ error: 'That is not an audio file TruthLens can transcribe. Use MP3, WAV, M4A, OGG, OGA, OPUS, FLAC, or AAC.' }, { status: 400 });
  }
  if (!liveStatus().configured) {
    return Response.json({ error: 'Audio transcription is unavailable here. It needs Muse Voice Transcribe on Meta Model API, and no Meta key is set on this deployment.' }, { status: 503 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length > MAX_AUDIO_FILE_BYTES) return Response.json({ error: `Audio is larger than ${MAX_AUDIO_FILE_BYTES / (1024 * 1024)} MB.` }, { status: 413 });
  let pages;
  let durationSec;
  try {
    ({ pages, durationSec } = await audioToPages(buffer));
  } catch (e) {
    console.error('[documents/audio] transcription failed:', e?.message || e);
    return Response.json({ error: 'Audio transcription failed. The file may be corrupt or use an unsupported format. Try a different file.' }, { status: 502 });
  }
  if (!pages.length) return Response.json({ error: 'No speech was found in that audio file.' }, { status: 422 });
  if (pagesCharCount(pages) > CONFIG.MAX_DOCUMENT_CHARS) return Response.json({ error: `Document is longer than ${CONFIG.MAX_DOCUMENT_CHARS} characters.` }, { status: 413 });
  const models = getModels();
  const transcript = pages.map((p) => p.text).join('\n');
  // Only the filename extension names the stored format. The client
  // supplied type is enough to attempt transcription, never to label
  // bytes the viewer will serve back.
  const storedMime = mimeForAudioFile(file.name);
  let stored = null;
  if (storedMime) {
    try {
      stored = await storeOriginal(buffer, storedMime, file.name);
    } catch (e) {
      console.error('[documents/audio] original file not stored:', e);
    }
  } else if (String(file.type || '').startsWith('audio/')) {
    // The filename names no playable format, so nothing may be stored
    // under the client's label. The bytes just transcribed successfully,
    // which proves they hold audio: keep an MP3 copy every browser plays.
    try {
      const playback = await makePlaybackAudio(buffer, { ext: '' });
      if (playback.mime) stored = await storeOriginal(playback.buffer, playback.mime, file.name);
    } catch (e) {
      console.error('[documents/audio] original file not stored:', e);
    }
  }
  const doc = await createDocument({
    title: String(form.get('title') || file.name || 'Uploaded audio'),
    pages,
    kind: 'audio',
    media: { durationSec, transcript, voiceModel: voiceModel(), ...(stored ? { file: stored } : {}) },
    owner: requestUser(req)?.username || 'demo',
  });
  return Response.json({ document: publicDocument(doc), ...(stored ? {} : { warning: ORIGINAL_NOT_KEPT_WARNING }), transcript, pages, voiceModel: voiceModel(), mode: 'live-ready', models });
}
