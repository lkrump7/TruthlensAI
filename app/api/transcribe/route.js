import { transcribeAudio, MAX_AUDIO_BYTES, voiceModel } from '../../../lib/voice.mjs';
import { liveStatus } from '../../../lib/meta.mjs';
import { authEnabled, requestUser } from '../../../lib/auth.mjs';
import { contentLengthTooLarge } from '../../../lib/media-store.mjs';

export async function POST(req) {
  if (authEnabled() && !requestUser(req)) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  if (contentLengthTooLarge(req, MAX_AUDIO_BYTES)) return Response.json({ error: 'That clip is too long. Keep it under a minute and try again.' }, { status: 413 });
  const form = await req.formData().catch(() => null);
  const file = form?.get('audio');
  if (!file || typeof file.arrayBuffer !== 'function') {
    return Response.json({ error: 'Record something first, then release the mic button.' }, { status: 400 });
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return Response.json({ error: 'That clip is too long. Keep it under a minute and try again.' }, { status: 413 });
  }
  if (!liveStatus().configured) {
    return Response.json({ error: 'Voice dictation is unavailable here. It needs Muse Voice Transcribe on Meta Model API, and no Meta key is set on this deployment. Type the claim instead.' }, { status: 503 });
  }
  try {
    const wav = Buffer.from(await file.arrayBuffer());
    const out = await transcribeAudio(wav);
    if (!out.transcript) return Response.json({ error: 'No speech was heard in that clip. Try again, closer to the microphone.' }, { status: 422 });
    return Response.json({ transcript: out.transcript, turns: out.turns, model: voiceModel(), mode: 'live' });
  } catch (e) {
    return Response.json({ error: `Transcription failed. ${e.message}` }, { status: 502 });
  }
}
