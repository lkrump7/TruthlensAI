import { transcribeAudio, MAX_AUDIO_BYTES, voiceModel } from '../../../lib/voice.mjs';
import { mimeForAudioFile } from '../../../lib/audio.mjs';
import { liveStatus } from '../../../lib/meta.mjs';
import { authEnabled, requestUser } from '../../../lib/auth.mjs';
import { contentLengthTooLarge, needsContentLength, boundedFormData } from '../../../lib/media-store.mjs';
import { createBoundedLimiter, clientIp } from '../../../lib/rate-limit.mjs';

const transcribeLimiter = createBoundedLimiter({ windowMs: 60 * 1000, maxHits: 10, maxKeys: 1000 });
export function transcribeRateLimited(key) {
  return transcribeLimiter.check(key);
}

export async function POST(req) {
  if (authEnabled() && !requestUser(req)) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const ip = clientIp(req);
  if (transcribeRateLimited(`transcribe:${ip}`)) return Response.json({ error: 'Too many transcriptions. Wait a minute and try again.' }, { status: 429, headers: { 'Retry-After': '60' } });
  if (contentLengthTooLarge(req, MAX_AUDIO_BYTES)) return Response.json({ error: 'That clip is too long. Keep it under a minute and try again.' }, { status: 413 });
  if (needsContentLength(req)) return Response.json({ error: 'Uploads need a Content-Length header so oversize files fail fast. Your client did not send one.' }, { status: 411 });
  const { form, tooLarge } = await boundedFormData(req, MAX_AUDIO_BYTES);
  if (tooLarge) return Response.json({ error: 'That clip is too long. Keep it under a minute and try again.' }, { status: 413 });
  const file = form?.get('audio');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return Response.json({ error: 'Record something first, then release the mic button.' }, { status: 400 });
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return Response.json({ error: 'That clip is too long. Keep it under a minute and try again.' }, { status: 413 });
  }
  if (!mimeForAudioFile(file.name)) {
    return Response.json({ error: 'That is not an audio TruthLens can transcribe. Use MP3, WAV, M4A, OGG, OGA, OPUS, FLAC, or AAC.' }, { status: 400 });
  }
  if (!liveStatus().configured) {
    return Response.json({ error: 'Voice dictation is unavailable here. It needs Muse Voice Transcribe on Meta Model API, and no Meta key is set on this deployment. Type the claim instead.' }, { status: 503 });
  }
  try {
    const wav = Buffer.from(await file.arrayBuffer());
    if (wav.length > MAX_AUDIO_BYTES) {
      return Response.json({ error: 'That clip is too long. Keep it under a minute and try again.' }, { status: 413 });
    }
    const out = await transcribeAudio(wav);
    if (!out.transcript) return Response.json({ error: 'No speech was heard in that clip. Try again, closer to the microphone.' }, { status: 422 });
    return Response.json({ transcript: out.transcript, turns: out.turns, model: voiceModel(), mode: 'live' });
  } catch (e) {
    console.error('[transcribe] transcription failed:', e?.message || e);
    return Response.json({ error: 'Transcription failed. Please try again.' }, { status: 502 });
  }
}
