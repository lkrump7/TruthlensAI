import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'tl-media-'));
process.env.TRUTHLENS_STORE_FILE = join(dir, 'documents.json');
process.env.TRUTHLENS_USERS_FILE = join(dir, 'users.json');
delete process.env.META_MODEL_API_URL;
delete process.env.META_MODEL_API_KEY;

const { createDocument, getDocument } = await import('../lib/documents.mjs');
const { POST: imagePost } = await import('../app/api/documents/image/route.js');
const { POST: videoPost } = await import('../app/api/documents/video/route.js');
const { mimeForVideoFile } = await import('../lib/video.mjs');

test('createDocument keeps image and video kinds and their media summary', async () => {
  const img = await createDocument({ title: 'Sign photo', kind: 'image', media: { caption: 'A sign says water boils at 100 degrees Celsius at sea level.', model: 'muse-spark-1.3' }, pages: [{ page: 1, text: 'A sign says water boils at 100 degrees Celsius at sea level in kitchens.' }] });
  assert.equal(img.kind, 'image');
  assert.equal(img.media.caption, 'A sign says water boils at 100 degrees Celsius at sea level.');
  assert.equal((await getDocument(img.id)).kind, 'image');

  const vid = await createDocument({ title: 'Lecture clip', kind: 'video', media: { durationSec: 75, model: 'muse-spark-1.3', voiceModel: 'muse-voice-transcribe-1.0' }, pages: [{ page: 1, text: '[00:00–00:50] Speech: Water boils at 100 degrees Celsius at sea level in kitchens.' }] });
  assert.equal(vid.kind, 'video');
  assert.equal(vid.media.durationSec, 75);

  const excerpt = await createDocument({ title: 'Plain', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }] });
  assert.equal(excerpt.kind, 'excerpt');
  assert.equal(excerpt.media, undefined);
});

test('mimeForVideoFile maps common video extensions and rejects others', () => {
  assert.equal(mimeForVideoFile('a.MP4'), 'video/mp4');
  assert.equal(mimeForVideoFile('a.mov'), 'video/quicktime');
  assert.equal(mimeForVideoFile('a.webm'), 'video/webm');
  assert.equal(mimeForVideoFile('a.mkv'), 'video/x-matroska');
  assert.equal(mimeForVideoFile('a.png'), null);
});

function uploadReq(url, name, bytes, type = 'application/octet-stream') {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), name);
  return new Request(url, { method: 'POST', body: form });
}

test('image route refuses a missing file, a wrong type, and unconfigured Meta', async () => {
  assert.equal((await imagePost(new Request('http://t/api/documents/image', { method: 'POST' }))).status, 400);
  assert.equal((await imagePost(uploadReq('http://t/api/documents/image', 'notes.txt', Buffer.from('hello')))).status, 400);
  const res = await imagePost(uploadReq('http://t/api/documents/image', 'sign.png', Buffer.from([137, 80, 78, 71]), 'image/png'));
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /Muse Spark|Meta/i);
});

async function withVisionFetch(fetchImpl, fn) {
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

const blankVisionFetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '   ' } }] }) });

test('image route returns 422 when the vision model returns a blank caption', async () => {
  const res = await withVisionFetch(blankVisionFetch, () => imagePost(uploadReq('http://t/api/documents/image', 'sign.png', Buffer.from([137, 80, 78, 71]), 'image/png')));
  assert.equal(res.status, 422);
});

test('image route returns 400 for an SVG upload before any model call', async () => {
  let calls = 0;
  const countingBlankFetch = async (...args) => { calls++; return blankVisionFetch(...args); };
  const svgByType = await withVisionFetch(countingBlankFetch, () => imagePost(uploadReq('http://t/api/documents/image', 'icon.svg', Buffer.from('<svg/>'), 'image/svg+xml')));
  assert.equal(svgByType.status, 400);
  assert.equal(calls, 0);
  const svgByExtension = await withVisionFetch(countingBlankFetch, () => imagePost(uploadReq('http://t/api/documents/image', 'icon.svg', Buffer.from('<svg/>'), 'image/png')));
  assert.equal(svgByExtension.status, 400);
  assert.equal(calls, 0);
});

test('image route lets the extension win over file.type', async () => {
  const res = await withVisionFetch(blankVisionFetch, () => imagePost(uploadReq('http://t/api/documents/image', 'sign.png', Buffer.from([137, 80, 78, 71]), 'image/svg+xml')));
  assert.equal(res.status, 422);
});

test('image route returns 502 when the vision model throws', async () => {
  const throwingFetch = async () => { throw new Error('vision exploded'); };
  const res = await withVisionFetch(throwingFetch, () => imagePost(uploadReq('http://t/api/documents/image', 'sign.png', Buffer.from([137, 80, 78, 71]), 'image/png')));
  assert.equal(res.status, 502);
});

test('video route stores durationSec for a silent video', async (t) => {
  const { execFile, execFileSync } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { readFile } = await import('node:fs/promises');
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { t.skip('ffmpeg not available'); return; }
  const run = promisify(execFile);
  const silentPath = join(dir, 'silent.mp4');
  await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x240:rate=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', silentPath]);
  const bytes = await readFile(silentPath);
  const captionFetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'A silent chart.' } }] }) });
  const res = await withVisionFetch(captionFetch, () => videoPost(uploadReq('http://t/api/documents/video', 'silent.mp4', bytes, 'video/mp4')));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Math.abs(body.document.media.durationSec - 3) < 0.5, `durationSec ${body.document.media.durationSec}`);
  assert.equal(body.document.media.transcript, body.transcript);
  const stored = await getDocument(body.document.id);
  assert.equal(stored.media.durationSec, body.document.media.durationSec);
});

test('video route keeps no original when the type comes only from the client', async (t) => {
  const { execFile, execFileSync } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { readFile } = await import('node:fs/promises');
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { t.skip('ffmpeg not available'); return; }
  const run = promisify(execFile);
  const silentPath = join(dir, 'silent-noext.mp4');
  await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x240:rate=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', silentPath]);
  const bytes = await readFile(silentPath);
  const captionFetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'A silent chart.' } }] }) });
  const res = await withVisionFetch(captionFetch, () => videoPost(uploadReq('http://t/api/documents/video', 'silentclip', bytes, 'video/mp4')));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.document.media.file, undefined, 'a client-supplied type alone never names the stored format');
  assert.match(body.warning || '', /was not kept/i, 'the response says the original is missing');
});

test('video route refuses a missing file, a wrong type, and unconfigured Meta', async () => {
  assert.equal((await videoPost(new Request('http://t/api/documents/video', { method: 'POST' }))).status, 400);
  assert.equal((await videoPost(uploadReq('http://t/api/documents/video', 'sign.png', Buffer.from('hello')))).status, 400);
  const res = await videoPost(uploadReq('http://t/api/documents/video', 'clip.mp4', Buffer.from('fake'), 'video/mp4'));
  assert.equal(res.status, 503);
  assert.match((await res.json()).error, /Meta/i);
});
