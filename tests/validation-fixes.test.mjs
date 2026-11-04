import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'tl-validation-'));
process.env.TRUTHLENS_STORE_FILE = join(dir, 'documents.json');

const { POST: batchPost } = await import('../app/api/verify/batch/route.js');
const jsonReq = (body) => new Request('http://t/api/verify/batch', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

// --- Bug 1: batch input validation ---

test('batch rejects an object claim instead of coercing it to "[object Object]"', async () => {
  const res = await batchPost(jsonReq({ claims: { text: 'Water boils at sea level.' } }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error || '', /string/i);
});

test('batch rejects a numeric claim instead of coercing it', async () => {
  const res = await batchPost(jsonReq({ claims: 42 }));
  assert.equal(res.status, 400);
});

test('batch rejects an array containing non-strings instead of coercing members', async () => {
  const res = await batchPost(jsonReq({ claims: ['Water boils at sea level.', 42] }));
  assert.equal(res.status, 400);
});

test('batch rejects a non-string text field instead of coercing it', async () => {
  const res = await batchPost(jsonReq({ text: { text: 'Water boils at sea level.' } }));
  assert.equal(res.status, 400);
});

test('batch refuses an oversized input with 413 before parsing', async () => {
  const res = await batchPost(jsonReq({ text: 'x'.repeat(100_001) }));
  assert.equal(res.status, 413);
});

// --- Bug 2: sidecar hardening (localhost HTTP) ---

import { spawn, execFileSync } from 'node:child_process';
import net from 'node:net';

const pickPython = () => {
  for (const py of ['python3', '.venv/bin/python']) {
    try { execFileSync(py, ['-c', 'import faiss, pymupdf'], { stdio: 'ignore' }); return py; } catch { /* try next */ }
  }
  return null;
};
const SIDECAR_PY = pickPython();
const sidecarAvailable = Boolean(SIDECAR_PY);

const freePort = () => new Promise((resolve) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});

let sidecarPort = 0;
let sidecarProc = null;
const sidecarBase = () => `http://127.0.0.1:${sidecarPort}`;
const sidecarPost = (path, body) => fetch(sidecarBase() + path, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

import { before, after } from 'node:test';
before(async () => {
  if (!sidecarAvailable) return;
  sidecarPort = await freePort();
  sidecarProc = spawn(SIDECAR_PY, ['services/sidecar.py', String(sidecarPort)], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(sidecarBase() + '/health'); if (r.ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('sidecar did not start');
});
after(() => { if (sidecarProc) sidecarProc.kill(); });

const skipIfNoSidecar = (t) => { if (!sidecarAvailable) t.skip('sidecar python unavailable'); };

test('sidecar clamps a negative k to 1 instead of erroring', async (t) => {
  skipIfNoSidecar(t);
  const ns = 'negk-probe-' + Date.now();
  try {
    const added = await sidecarPost('/faiss/add', { namespace: ns, items: [{ id: 'a', vector: [1, 0] }] });
    assert.equal(added.status, 200);
    const res = await sidecarPost('/faiss/search', { namespace: ns, vector: [1, 0], k: -5 });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).hits.length, 1);
  } finally {
    await sidecarPost('/faiss/add', { namespace: ns, reset: true, items: [] });
  }
});

test('sidecar rejects an over-cap /faiss/add with 413', async (t) => {
  skipIfNoSidecar(t);
  const items = Array.from({ length: 1500 }, (_, i) => ({ id: `x${i}`, vector: [1, 0, 0] }));
  const res = await sidecarPost('/faiss/add', { namespace: 'cap-probe-' + Date.now(), items });
  assert.equal(res.status, 413);
});

test('sidecar rejects over-cap /embed and /guard batches with 413', async (t) => {
  skipIfNoSidecar(t);
  const texts = Array.from({ length: 200 }, (_, i) => `Over-cap probe sentence number ${i}.`);
  assert.equal((await sidecarPost('/embed', { texts })).status, 413);
  assert.equal((await sidecarPost('/guard', { texts })).status, 413);
});

test('sidecar rejects over-cap /rerank and /nli batches with 413', async (t) => {
  skipIfNoSidecar(t);
  const passages = Array.from({ length: 200 }, (_, i) => `Over-cap passage number ${i}.`);
  assert.equal((await sidecarPost('/rerank', { query: 'Which passage matters?', passages })).status, 413);
  const pairs = Array.from({ length: 200 }, () => ['Water boils at sea level.', 'Water boils at sea level.']);
  assert.equal((await sidecarPost('/nli', { pairs })).status, 413);
});

test('sidecar refuses a huge declared content-length with 413 without reading the body', async (t) => {
  skipIfNoSidecar(t);
  const status = await new Promise((resolve, reject) => {
    const sock = net.connect(sidecarPort, '127.0.0.1', () => {
      sock.write(
        'POST /embed HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\n' +
        'Content-Length: 300000000\r\nConnection: close\r\n\r\n{"texts":["hi"]}',
      );
      sock.end();
    });
    let data = '';
    sock.on('data', (c) => { data += c.toString('latin1'); });
    sock.on('end', () => resolve(Number((data.match(/HTTP\/\d(?:\.\d)? (\d+)/) || [])[1])));
    sock.on('error', reject);
    setTimeout(() => reject(new Error('no response, still waiting on the body')), 10000);
  });
  assert.equal(status, 413);
});

// --- Bug 3: events SSE trailing-edge coalescing ---

test('events route coalesces a rapid burst into one trailing send with the latest state', async () => {
  const { createDocument, getDocument, whenAutoVerificationDone } = await import('../lib/documents.mjs');
  const { docEvents } = await import('../lib/events.mjs');
  const { repository } = await import('../lib/repositories.mjs');
  const eventsRoute = await import('../app/api/documents/[id]/events/route.js');
  const doc = await createDocument({ title: 'Coalesce Excerpt', owner: 'reader', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }] });
  await whenAutoVerificationDone(doc.id);
  const res = await eventsRoute.GET(new Request('http://t/x'), { params: { id: doc.id } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const first = await reader.read();
  assert.match(dec.decode(first.value), /Coalesce Excerpt/, 'initial snapshot still sends immediately');
  const stored = await getDocument(doc.id);
  stored.title = 'Coalesce Excerpt v2';
  await repository().save(stored);
  for (let i = 0; i < 5; i++) docEvents.emit('changed', doc.id);
  const chunks = [];
  const stop = setTimeout(() => reader.cancel(), 1500);
  try {
    for (;;) { const r = await reader.read(); if (r.done) break; chunks.push(dec.decode(r.value, { stream: true })); }
  } finally { clearTimeout(stop); }
  const text = chunks.join('');
  const sends = text.split('data: ').length - 1;
  assert.ok(sends <= 2, `burst of 5 rapid changes must coalesce, got ${sends} follow-up sends`);
  assert.match(text.split('data: ').pop(), /Coalesce Excerpt v2/, 'the trailing send carries the latest state');
  await reader.cancel().catch(() => {});
});
