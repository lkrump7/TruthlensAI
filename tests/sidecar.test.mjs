import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, rmSync } from 'node:fs';

const PY = '.venv/bin/python';
const PORT = 8199;
const BASE = `http://127.0.0.1:${PORT}`;
let proc = null;
let available = existsSync(PY) && existsSync('services/sidecar.py');

before(async () => {
  if (!available) return;
  proc = spawn(PY, ['services/sidecar.py', String(PORT)], { stdio: 'ignore' });
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(BASE + '/health'); if (r.ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  available = false;
});
after(() => { if (proc) proc.kill(); });

const post = (path, body) => fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('sidecar rejects traversal namespaces with 400 JSON and writes nothing outside data/faiss', async (t) => {
  if (!available) return t.skip('sidecar venv unavailable');
  rmSync('data/escape-probe.faiss', { force: true }); rmSync('data/escape-probe.ids.json', { force: true });
  const res = await post('/faiss/add', { namespace: '../../data/escape-probe', items: [{ id: 'x', vector: [1, 0] }] });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.ok(body.error);
  assert.ok(!readdirSync('data').some((f) => f.includes('escape-probe')));
});

test('sidecar /embed validates input and either embeds or honestly reports 503', async (t) => {
  if (!available) return t.skip('sidecar venv unavailable');
  const bad = await post('/embed', { texts: 'not-a-list' });
  assert.equal(bad.status, 400);
  const res = await post('/embed', { texts: ['Exercise improves memory.', 'Aerobic training enhanced recall.'] });
  if (res.status === 503) {
    assert.ok((await res.json()).error, 'unavailable embeddings must say why');
    return;
  }
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.vectors.length, 2);
  assert.ok(body.dim > 0 && body.vectors.every((v) => v.length === body.dim));
});

test('sidecar returns 400 JSON on vector dimension mismatch, never a dropped connection', async (t) => {
  if (!available) return t.skip('sidecar venv unavailable');
  const ns = 'dims-probe-' + Date.now();
  await post('/faiss/add', { namespace: ns, items: [{ id: 'a', vector: [1, 0] }] });
  const res = await post('/faiss/add', { namespace: ns, items: [{ id: 'b', vector: [1, 0, 0] }] });
  assert.equal(res.status, 400);
  assert.ok((await res.json()).error);
});

test('reset with no items clears a namespace instead of leaving stale hits', async (t) => {
  if (!available) return t.skip('sidecar venv unavailable');
  const ns = 'reset-empty-probe-' + Date.now();
  await post('/faiss/add', { namespace: ns, items: [{ id: 'ev1', vector: [1, 0, 0] }] });
  await post('/faiss/add', { namespace: ns, reset: true, items: [] });
  const res = await post('/faiss/search', { namespace: ns, vector: [1, 0, 0], k: 3 });
  const { hits } = await res.json();
  assert.equal(hits.length, 0);
});

test('reset add replaces a namespace instead of duplicating evidence ids', async (t) => {
  if (!available) return t.skip('sidecar venv unavailable');
  const ns = 'reset-probe-' + Date.now();
  await post('/faiss/add', { namespace: ns, items: [{ id: 'ev1', vector: [1, 0, 0] }] });
  await post('/faiss/add', { namespace: ns, reset: true, items: [{ id: 'ev1', vector: [1, 0, 0] }] });
  const res = await post('/faiss/search', { namespace: ns, vector: [1, 0, 0], k: 3 });
  const { hits } = await res.json();
  assert.equal(hits.filter((h) => h.id === 'ev1').length, 1);
});
