import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'tl-audio-route-'));
process.env.TRUTHLENS_STORE_FILE = join(dir, 'documents.json');
process.env.TRUTHLENS_USERS_FILE = join(dir, 'users.json');
delete process.env.META_MODEL_API_URL;
delete process.env.META_MODEL_API_KEY;

const { createDocument, getDocument } = await import('../lib/documents.mjs');
const { POST: audioPost } = await import('../app/api/documents/audio/route.js');
const { storeOriginal } = await import('../lib/media-store.mjs');

test('createDocument keeps the audio kind and its media summary', async () => {
  const doc = await createDocument({
    title: 'Interview clip',
    kind: 'audio',
    media: { durationSec: 75, voiceModel: 'muse-voice-transcribe-1.0' },
    pages: [{ page: 1, text: '[00:00–00:50] Speech: Water boils at 100 degrees Celsius at sea level in kitchens.' }],
  });
  assert.equal(doc.kind, 'audio');
  assert.equal(doc.media.durationSec, 75);
  assert.equal((await getDocument(doc.id)).kind, 'audio');
});

test('storeOriginal keeps audio bytes for the viewer', async () => {
  const bytes = Buffer.from('RIFFfake-wav-bytes');
  const meta = await storeOriginal(bytes, 'audio/mpeg', 'clip.mp3');
  assert.ok(meta, 'audio mime is stored');
  assert.equal(meta.mime, 'audio/mpeg');
  assert.match(meta.storedName, /^[a-f0-9]{64}\.mp3$/);
});

function uploadReq(url, name, bytes, type = 'application/octet-stream') {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), name);
  return new Request(url, { method: 'POST', body: form });
}

test('audio route refuses a missing file, a wrong type, and unconfigured Meta', async () => {
  assert.equal((await audioPost(new Request('http://t/api/documents/audio', { method: 'POST' }))).status, 400);
  assert.equal((await audioPost(uploadReq('http://t/api/documents/audio', 'notes.txt', Buffer.from('hello')))).status, 400);
  const wrong = await audioPost(uploadReq('http://t/api/documents/audio', 'clip.wma', Buffer.from('x')));
  assert.equal(wrong.status, 400);
  const message = (await wrong.json()).error;
  const { AUDIO_MIME_BY_EXT } = await import('../lib/audio.mjs');
  for (const ext of Object.keys(AUDIO_MIME_BY_EXT)) {
    assert.ok(message.includes(ext.slice(1).toUpperCase()), `rejection names ${ext}`);
  }
  const res = await audioPost(uploadReq('http://t/api/documents/audio', 'clip.mp3', Buffer.from('ID3'), 'audio/mpeg'));
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /Voice Transcribe|Meta/i);
});

async function withLiveEnv(fetchImpl, fn) {
  const savedFetch = globalThis.fetch;
  const saved = { u: process.env.META_MODEL_API_URL, k: process.env.META_MODEL_API_KEY };
  process.env.META_MODEL_API_URL = 'https://example.invalid/chat';
  process.env.META_MODEL_API_KEY = 'k';
  globalThis.fetch = fetchImpl;
  try { return await fn(); } finally {
    globalThis.fetch = savedFetch;
    if (saved.u === undefined) delete process.env.META_MODEL_API_URL; else process.env.META_MODEL_API_URL = saved.u;
    if (saved.k === undefined) delete process.env.META_MODEL_API_KEY; else process.env.META_MODEL_API_KEY = saved.k;
  }
}

async function makeToneWav() {
  const { execFileSync } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { execFile } = await import('node:child_process');
  const { readFile } = await import('node:fs/promises');
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  const run = promisify(execFile);
  const out = join(dir, 'tone.wav');
  await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-ar', '24000', '-ac', '1', out]);
  return readFile(out);
}

test('audio route stores a transcript document from a wav upload', async (t) => {
  let wav;
  try { wav = await makeToneWav(); } catch { t.skip('ffmpeg not available'); return; }
  const asrFetch = async () => ({ ok: true, status: 200, json: async () => ({ transcript: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }) });
  const res = await withLiveEnv(asrFetch, () => audioPost(uploadReq('http://t/api/documents/audio', 'tone.wav', wav, 'audio/wav')));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.document.kind, 'audio');
  assert.ok(Math.abs(body.document.media.durationSec - 3) < 0.5, `durationSec ${body.document.media.durationSec}`);
  assert.match(body.transcript, /Water boils/);
  assert.equal(body.document.media.transcript, body.transcript);
  assert.equal(body.voiceModel, 'muse-voice-transcribe-1.0');
  const stored = await getDocument(body.document.id);
  assert.equal(stored.media.durationSec, body.document.media.durationSec);
});

test('audio route keeps a playable copy when the filename has no usable extension', async (t) => {
  let wav;
  try { wav = await makeToneWav(); } catch { t.skip('ffmpeg not available'); return; }
  const asrFetch = async () => ({ ok: true, status: 200, json: async () => ({ transcript: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }) });
  const res = await withLiveEnv(asrFetch, () => audioPost(uploadReq('http://t/api/documents/audio', 'Audio recording', wav, 'audio/wav')));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.document.media.file, 'the viewer gets a file to play, not text only');
  assert.equal(body.document.media.file.mime, 'audio/mpeg', 'the copy is stored as MP3 every browser plays');
  assert.equal(body.warning, undefined, 'no missing-file warning when a playable copy was kept');
});

test('audio route returns 422 when nothing transcribed', async (t) => {
  let wav;
  try { wav = await makeToneWav(); } catch { t.skip('ffmpeg not available'); return; }
  const emptyFetch = async () => ({ ok: true, status: 200, json: async () => ({ transcript: '   ' }) });
  const res = await withLiveEnv(emptyFetch, () => audioPost(uploadReq('http://t/api/documents/audio', 'tone.wav', wav, 'audio/wav')));
  assert.equal(res.status, 422);
});
