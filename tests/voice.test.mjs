import { test } from 'node:test';
import assert from 'node:assert/strict';
import { asrTranscribeUrl, voiceModel, parseTranscription, transcribeAudio, MAX_AUDIO_BYTES } from '../lib/voice.mjs';

test('asrTranscribeUrl derives the ASR endpoint from the chat completions URL', () => {
  assert.equal(asrTranscribeUrl('https://api.meta.ai/v1/chat/completions'), 'https://api.meta.ai/v1/asr/transcribe');
  assert.equal(asrTranscribeUrl('https://api.meta.ai/v1'), 'https://api.meta.ai/v1/asr/transcribe');
  assert.equal(asrTranscribeUrl('https://api.meta.ai/v1/responses'), 'https://api.meta.ai/v1/asr/transcribe');
});

test('voiceModel defaults to Muse Voice Transcribe and is overridable', () => {
  assert.equal(voiceModel({}), 'muse-voice-transcribe-1.0');
  assert.equal(voiceModel({ META_VOICE_MODEL: 'custom-voice' }), 'custom-voice');
});

test('parseTranscription keeps transcript and turns, drops empty turns text', () => {
  const out = parseTranscription({ transcript: 'Water boils at sea level.', turns: [{ turnId: 1, transcript: 'Water boils at sea level.', startMs: 0, endMs: 900 }] });
  assert.equal(out.transcript, 'Water boils at sea level.');
  assert.equal(out.turns.length, 1);
  assert.equal(parseTranscription({}).transcript, '');
  assert.deepEqual(parseTranscription(null).turns, []);
});

test('transcribeAudio posts multipart WAV to Meta with push-to-talk and returns the transcript', async () => {
  let seen;
  const fetchImpl = async (url, opts) => {
    seen = { url, opts };
    return { ok: true, status: 200, json: async () => ({ transcript: 'Humans only use ten percent.', turns: [] }) };
  };
  const out = await transcribeAudio(Buffer.from('RIFFfake'), {
    fetchImpl,
    env: { META_MODEL_API_URL: 'https://api.meta.ai/v1/chat/completions', META_MODEL_API_KEY: 'secret-key' },
  });
  assert.equal(out.transcript, 'Humans only use ten percent.');
  assert.equal(seen.url, 'https://api.meta.ai/v1/asr/transcribe');
  assert.equal(seen.opts.method, 'POST');
  assert.equal(seen.opts.headers.authorization, 'Bearer secret-key');
  assert.ok(seen.opts.body instanceof FormData);
  const request = JSON.parse(seen.opts.body.get('request'));
  assert.equal(request.model, 'muse-voice-transcribe-1.0');
  assert.equal(request.mode, 'PUSH_TO_TALK');
  assert.equal(request.audioEncoding, 'WAV');
  assert.ok(seen.opts.body.get('audio'));
});

test('transcribeAudio refuses when Meta is not configured, and rejects oversize or empty audio', async () => {
  await assert.rejects(() => transcribeAudio(Buffer.from('x'), { env: {} }), /not configured/i);
  const env = { META_MODEL_API_URL: 'https://api.meta.ai/v1/chat/completions', META_MODEL_API_KEY: 'k' };
  await assert.rejects(() => transcribeAudio(Buffer.alloc(0), { env, fetchImpl: async () => { throw new Error('should not fetch'); } }), /empty/i);
  assert.ok(MAX_AUDIO_BYTES <= 32 * 1024 * 1024);
  await assert.rejects(() => transcribeAudio(Buffer.alloc(MAX_AUDIO_BYTES + 1), { env, fetchImpl: async () => { throw new Error('should not fetch'); } }), /too large/i);
});

test('transcribe route refuses without audio and reports unavailable in demo mode', async () => {
  const route = await import('../app/api/transcribe/route.js');
  const empty = await route.POST(new Request('http://t/api/transcribe', { method: 'POST' }));
  assert.equal(empty.status, 400);
  const form = new FormData();
  form.append('audio', new Blob([Buffer.from('RIFFfake')], { type: 'audio/wav' }), 'dictation.wav');
  const saved = { u: process.env.META_MODEL_API_URL, k: process.env.META_MODEL_API_KEY };
  delete process.env.META_MODEL_API_URL; delete process.env.META_MODEL_API_KEY;
  try {
    const res = await route.POST(new Request('http://t/api/transcribe', { method: 'POST', body: form }));
    assert.equal(res.status, 503);
    const body = await res.json();
    assert.match(body.error, /not configured|unavailable/i);
    assert.equal(body.transcript, undefined);
  } finally {
    if (saved.u === undefined) delete process.env.META_MODEL_API_URL; else process.env.META_MODEL_API_URL = saved.u;
    if (saved.k === undefined) delete process.env.META_MODEL_API_KEY; else process.env.META_MODEL_API_KEY = saved.k;
  }
});

test('transcribeAudio surfaces a Meta failure instead of inventing a transcript', async () => {
  const env = { META_MODEL_API_URL: 'https://api.meta.ai/v1/chat/completions', META_MODEL_API_KEY: 'k' };
  const fetchImpl = async () => ({ ok: false, status: 500, json: async () => ({}) });
  await assert.rejects(() => transcribeAudio(Buffer.from('RIFFfake'), { env, fetchImpl }), /500/);
});
