import { MetaApiError, isRetryableHttpStatus } from './errors.mjs';
import { withRetry } from './fetch.mjs';
import { liveCallLimiter } from './limit.mjs';
import { createBreaker } from './breaker.mjs';
import { CONFIG } from './config.mjs';

// Voice dictation through Muse Voice Transcribe on Meta Model API.
// Same key and base URL as the judges. The file endpoint is used, not
// the realtime WebSocket: the key stays on the server, and the browser
// posts a short WAV clip to our own transcribe route instead.
const voiceBreaker = createBreaker({ threshold: CONFIG.BREAKER_THRESHOLD, cooldownMs: CONFIG.BREAKER_COOLDOWN_MS });

export const MAX_AUDIO_BYTES = 32 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 60;

export function voiceModel(env = process.env) {
  return env.META_VOICE_MODEL || 'muse-voice-transcribe-1.0';
}

export function asrTranscribeUrl(configured) {
  const u = String(configured || '').replace(/\/$/, '');
  const base = u.replace(/\/(chat\/completions|responses)$/, '');
  return `${base}/asr/transcribe`;
}

export function parseTranscription(json) {
  const turns = Array.isArray(json?.turns)
    ? json.turns.filter((t) => t && String(t.transcript || '').trim()).map((t) => ({ turnId: t.turnId, startMs: t.startMs, endMs: t.endMs, transcript: String(t.transcript).trim(), ...(t.speaker ? { speaker: t.speaker } : {}) }))
    : [];
  const fromTurns = turns.map((t) => t.transcript).join(' ');
  return { transcript: String(json?.transcript || fromTurns || '').trim(), turns };
}

/**
 * @param {Buffer|Uint8Array} wav
 * @param {{ env?: Record<string,string|undefined>, fetchImpl?: Function, keywords?: string[] }} [opts]
 */
export async function transcribeAudio(wav, { env = process.env, fetchImpl = fetch, keywords } = {}) {
  const apiUrl = env.META_MODEL_API_URL;
  const apiKey = env.META_MODEL_API_KEY;
  if (!apiUrl || !apiKey) throw new MetaApiError('Voice dictation is not configured: missing META_MODEL_API_URL, META_MODEL_API_KEY');
  const bytes = Buffer.isBuffer(wav) ? wav : Buffer.from(wav || []);
  if (!bytes.length) throw new MetaApiError('Audio is empty. Record something first.');
  if (bytes.length > MAX_AUDIO_BYTES) throw new MetaApiError(`Audio is too large (${bytes.length} bytes). Keep the clip under ${MAX_AUDIO_SECONDS} seconds.`);
  const res = await voiceBreaker.exec(() => liveCallLimiter(() => withRetry(async () => {
    const form = new FormData();
    form.append('request', JSON.stringify({ model: voiceModel(env), mode: 'PUSH_TO_TALK', audioEncoding: 'WAV', ...(Array.isArray(keywords) && keywords.length ? { keywords: keywords.slice(0, 50).map(String) } : {}) }));
    form.append('audio', new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }), 'dictation.wav');
    const r = await fetchImpl(asrTranscribeUrl(apiUrl), {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(90000),
    });
    if (!r.ok) throw new MetaApiError(`Muse Voice Transcribe returned ${r.status}`, { retryable: isRetryableHttpStatus(r.status) });
    return r;
  })));
  return parseTranscription(await res.json());
}
