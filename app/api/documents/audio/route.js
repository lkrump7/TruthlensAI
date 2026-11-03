import { createDocument, publicDocument } from '../../../../lib/documents.mjs';
import { audioToPages, mimeForAudioFile, MAX_AUDIO_FILE_BYTES } from '../../../../lib/audio.mjs';
import { voiceModel } from '../../../../lib/voice.mjs';
import { liveStatus, getModels } from '../../../../lib/meta.mjs';
import { authEnabled, requestUser } from '../../../../lib/auth.mjs';
import { storeOriginal, ORIGINAL_NOT_KEPT_WARNING } from '../../../../lib/media-store.mjs';
import { pagesCharCount } from '../../../../lib/documents.mjs';
import { CONFIG } from '../../../../lib/config.mjs';
import { contentLengthTooLarge } from '../../../../lib/media-store.mjs';

export async function POST(req) {
  if (authEnabled() && !requestUser(req)) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  if (contentLengthTooLarge(req, MAX_AUDIO_FILE_BYTES)) return Response.json({ error: `Audio is larger than ${MAX_AUDIO_FILE_BYTES / (1024 * 1024)} MB.` }, { status: 413 });
  const form = await req.formData().catch(() => null);
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
  let pages;
  let durationSec;
  try {
    ({ pages, durationSec } = await audioToPages(buffer));
  } catch (e) {
    return Response.json({ error: `Transcription failed. ${e.message}` }, { status: 502 });
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
