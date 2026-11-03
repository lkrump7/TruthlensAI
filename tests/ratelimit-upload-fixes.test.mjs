import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolated store/media state: never touch the developer's data files.
const dir = mkdtempSync(join(tmpdir(), 'tl-ratelimit-upload-'));
process.env.TRUTHLENS_STORE_FILE = join(dir, 'documents.json');
process.env.TRUTHLENS_MEDIA_DIR = join(dir, 'media');
process.env.TRUTHLENS_USERS_FILE = join(dir, 'users.json');
delete process.env.META_MODEL_API_URL;
delete process.env.META_MODEL_API_KEY;

const { POST: streamPost } = await import('../app/api/verify/stream/route.js');

const streamReq = (ip, claim = '') => new Request('http://t/api/verify/stream', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  body: JSON.stringify({ claim }),
});

test('stream: more than 30 POSTs/min from one IP get 429 with Retry-After', async () => {
  const ip = 'test-stream-limit-1';
  let last;
  for (let i = 0; i < 31; i++) {
    last = await streamPost(streamReq(ip));
  }
  assert.equal(last.status, 429);
  assert.equal(last.headers.get('retry-after'), '60');
  const body = await last.json();
  assert.ok(body.error, '429 carries an error message');
});

test('stream: the limiter is keyed by client IP, not global', async () => {
  const res = await streamPost(streamReq('test-stream-limit-2'));
  assert.notEqual(res.status, 429);
});

const { POST: transcribePost } = await import('../app/api/transcribe/route.js');

test('transcribe: more than 10 POSTs/min from one IP get 429 with Retry-After', async () => {
  const ip = 'test-transcribe-limit-1';
  let last;
  for (let i = 0; i < 11; i++) {
    last = await transcribePost(new Request('http://t/api/transcribe', { method: 'POST', headers: { 'x-forwarded-for': ip } }));
  }
  assert.equal(last.status, 429);
  assert.equal(last.headers.get('retry-after'), '60');
});

test('transcribe: the limiter is keyed by client IP, not global', async () => {
  const res = await transcribePost(new Request('http://t/api/transcribe', { method: 'POST', headers: { 'x-forwarded-for': 'test-transcribe-limit-2' } }));
  assert.notEqual(res.status, 429);
});

const { POST: audioPost } = await import('../app/api/documents/audio/route.js');
const { POST: videoPost } = await import('../app/api/documents/video/route.js');
const { POST: imagePost } = await import('../app/api/documents/image/route.js');
const { POST: docxPost } = await import('../app/api/documents/docx/route.js');
const pdfRoute = await import('../app/api/documents/pdf/route.js');
const { POST: pdfPost } = pdfRoute;

const uploadPosts = [
  ['audio', audioPost],
  ['video', videoPost],
  ['image', imagePost],
  ['docx', docxPost],
  ['pdf', pdfPost],
];

test('uploads: more than 10 POSTs/min from one IP get 429 with Retry-After on every document route', async () => {
  for (const [kind, post] of uploadPosts) {
    let last;
    for (let i = 0; i < 11; i++) {
      last = await post(new Request(`http://t/api/documents/${kind}`, { method: 'POST', headers: { 'x-forwarded-for': 'test-upload-limit-1' } }));
    }
    assert.equal(last.status, 429, `${kind} route limits uploads`);
    assert.equal(last.headers.get('retry-after'), '60', `${kind} route sends Retry-After`);
  }
});

test('uploads: each document route has its own limiter', async () => {
  const res = await audioPost(new Request('http://t/api/documents/audio', { method: 'POST', headers: { 'x-forwarded-for': 'test-upload-limit-2' } }));
  assert.notEqual(res.status, 429);
});

const { POST: suggestPost } = await import('../app/api/claims/suggest/route.js');

const suggestReq = (ip) => new Request('http://t/api/claims/suggest', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  body: JSON.stringify({ result: { text: 'Water boils.', verdict: 'Supported' } }),
});

test('suggest: more than 30 POSTs/min from one IP get 429 with Retry-After', async () => {
  const ip = 'test-suggest-limit-1';
  let last;
  for (let i = 0; i < 31; i++) {
    last = await suggestPost(suggestReq(ip));
  }
  assert.equal(last.status, 429);
  assert.equal(last.headers.get('retry-after'), '60');
});

test('suggest: the limiter is keyed by client IP, not global', async () => {
  const res = await suggestPost(suggestReq('test-suggest-limit-2'));
  assert.notEqual(res.status, 429);
});

const { contentLengthMissing, needsContentLength } = await import('../lib/media-store.mjs');

// Undici never fills in content-length on a constructed Request: it is a
// transport-layer header. Browsers always send it on multipart uploads, so a
// multipart Request without one only happens for in-process harness calls,
// which the real-bytes checks still bound. A non-multipart body without a
// declared length is the length-hiding shape, and that gets 411.
test('contentLengthMissing spots an absent or unusable length', () => {
  const none = new Request('http://t/x', { method: 'POST' });
  assert.equal(contentLengthMissing(none), true);
  const malformed = new Request('http://t/x', { method: 'POST', headers: { 'content-length': 'huge' } });
  assert.equal(contentLengthMissing(malformed), true);
  const ok = new Request('http://t/x', { method: 'POST', headers: { 'content-length': '100' } });
  assert.equal(contentLengthMissing(ok), false);
});

test('needsContentLength requires a length only for non-multipart bodies that have one', () => {
  const form = new FormData();
  form.append('file', new Blob(['hello']), 'a.txt');
  const multipart = new Request('http://t/x', { method: 'POST', body: form });
  assert.equal(needsContentLength(multipart), false, 'headerless harness multipart still reaches the real-bytes checks');
  const none = new Request('http://t/x', { method: 'POST' });
  assert.equal(needsContentLength(none), false, 'body-less requests keep the 400-missing-file path');
  const raw = new Request('http://t/x', { method: 'POST', body: 'raw-bytes' });
  assert.equal(needsContentLength(raw), true, 'raw body without a length needs 411');
  const declared = new Request('http://t/x', { method: 'POST', headers: { 'content-length': '9' }, body: 'raw-bytes' });
  assert.equal(needsContentLength(declared), false);
});

const rawUploadReq = (kind, ip, length) => new Request(`http://t/api/${kind}`, {
  method: 'POST',
  headers: { 'x-forwarded-for': ip, ...(length == null ? {} : { 'content-length': String(length) }) },
  body: 'raw-bytes',
});
const emptyFormReq = (kind, ip) => new Request(`http://t/api/${kind}`, {
  method: 'POST', headers: { 'x-forwarded-for': ip }, body: new FormData(),
});
const audioUploadReq = (ip, name, bytes, length) => {
  const form = new FormData();
  form.append('audio', new Blob([bytes], { type: 'application/octet-stream' }), name);
  return new Request('http://t/api/transcribe', {
    method: 'POST', headers: { 'x-forwarded-for': ip, 'content-length': String(length) }, body: form,
  });
};

test('uploads: a body without a declared length gets 411 on every upload route', async () => {
  const routes = [
    ['transcribe', transcribePost],
    ['documents/audio', audioPost],
    ['documents/video', videoPost],
    ['documents/image', imagePost],
    ['documents/docx', docxPost],
    ['documents/pdf', pdfPost],
  ];
  for (const [kind, post] of routes) {
    const res = await post(rawUploadReq(kind, `test-411-${kind.replace('/', '-')}`));
    assert.equal(res.status, 411, `${kind} requires Content-Length`);
  }
});

test('uploads: headerless harness multipart still reaches the file checks (no 411)', async () => {
  const res = await audioPost(emptyFormReq('documents/audio', 'test-411-multipart-1'));
  assert.equal(res.status, 400, 'empty multipart keeps the missing-file 400, not 411');
  const tx = await transcribePost(emptyFormReq('transcribe', 'test-411-multipart-2'));
  assert.equal(tx.status, 400, 'empty transcribe multipart keeps the missing-audio 400, not 411');
});

test('transcribe: a non-audio upload is rejected with 400 by extension', async () => {
  const res = await transcribePost(audioUploadReq('test-mime-1', 'notes.txt', Buffer.from('hello'), 6000));
  assert.equal(res.status, 400);
  const body = await res.json();
  for (const ext of ['MP3', 'WAV', 'M4A', 'OGG', 'OPUS', 'FLAC', 'AAC']) {
    assert.ok(body.error.includes(ext), `rejection names ${ext}`);
  }
});

test('pdf: an OCR page-cap error maps to 413 instead of silent fallback', () => {
  const capped = new Error('scanned PDF exceeds the OCR page cap');
  capped.code = 'too-many-pages';
  assert.equal(pdfRoute.ocrPageCapExceeded(capped), true);
  assert.equal(pdfRoute.ocrPageCapExceeded(new Error('sidecar down')), false);
  assert.equal(pdfRoute.ocrPageCapExceeded(null), false);
});

test('uploads: a huge declared length is rejected with 413 before buffering', async () => {
  const huge = String(200 * 1024 * 1024);
  const routes = [
    ['transcribe', transcribePost],
    ['documents/audio', audioPost],
    ['documents/video', videoPost],
    ['documents/image', imagePost],
    ['documents/docx', docxPost],
    ['documents/pdf', pdfPost],
  ];
  for (const [kind, post] of routes) {
    const res = await post(rawUploadReq(kind, `test-413-${kind.replace('/', '-')}`, huge));
    assert.equal(res.status, 413, `${kind} rejects the declared oversize early`);
  }
});
