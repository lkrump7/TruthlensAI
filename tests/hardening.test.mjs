import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('authSecret uses AUTH_SECRET and compose ships no predictable default', async () => {
  const savedSecret = process.env.AUTH_SECRET;
  try {
    process.env.AUTH_SECRET = '<MASKED_SECRET_001>';
    const { authSecret } = await import('../lib/auth.mjs');
    assert.equal(authSecret(), '<MASKED_SECRET_001>');
    const compose = readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8');
    assert.doesNotMatch(compose, /change-me/);
  } finally {
    if (savedSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = savedSecret;
  }
});

test('session cookie is Secure in production', async () => {
  const saved = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    const { sessionCookie } = await import('../lib/auth.mjs?x=secure');
    assert.match(sessionCookie('tok'), /; Secure/);
    process.env.NODE_ENV = 'development';
    const fresh = await import('../lib/auth.mjs?x=dev');
    assert.doesNotMatch(fresh.sessionCookie('tok'), /; Secure/);
  } finally {
    if (saved === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = saved;
  }
});

test('demo documents are viewable but not deletable by another user', async () => {
  const saved = process.env.AUTH_ENABLED;
  try {
    process.env.AUTH_ENABLED = 'true';
    const { canView, canDelete } = await import('../lib/auth.mjs?x=del');
    assert.equal(canView({ owner: 'demo' }, 'alice'), true);
    assert.equal(canDelete({ owner: 'demo' }, 'alice'), false);
    assert.equal(canDelete({ owner: 'alice' }, 'alice'), true);
    assert.equal(canDelete({ owner: 'alice' }, 'bob'), false);
  } finally {
    if (saved === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = saved;
  }
});

test('corrupt document store is quarantined, not silently discarded', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tl-store-'));
  const file = join(dir, 'documents.json');
  writeFileSync(file, '{not json');
  const { FileRepository } = await import('../lib/repositories.mjs');
  const repo = new FileRepository(file);
  assert.equal((await repo.loadAll()).length, 0);
  assert.ok(readdirSync(dir).some((f) => f.includes('corrupt')), 'corrupt bytes preserved aside');
});

test('document store writes are atomic (rename replaces the file, no temp left)', async () => {
  const { statSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'tl-store2-'));
  const file = join(dir, 'documents.json');
  const { FileRepository } = await import('../lib/repositories.mjs?x=atomic');
  const repo = new FileRepository(file);
  await repo.save({ id: 'doc-1', owner: 'demo', claims: [] });
  const ino1 = statSync(file).ino;
  await repo.save({ id: 'doc-2', owner: 'demo', claims: [] });
  assert.ok(!readdirSync(dir).some((f) => f.includes('.tmp')));
  assert.notEqual(statSync(file).ino, ino1, 'write must rename a temp file over the target');
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).length, 2);
});

test('faiss client times out instead of hanging forever', async () => {
  const { FaissClient } = await import('../lib/faiss.mjs');
  const never = (url, init) => new Promise((_, reject) => {
    init?.signal?.addEventListener('abort', () => reject(init.signal.reason));
  });
  const client = new FaissClient('http://x', never, 100);
  const keepAlive = setInterval(() => {}, 25);
  try {
    await assert.rejects(() => client.search('ns', [1, 0]), /timed out|timeout|abort/i);
  } finally { clearInterval(keepAlive); }
});

test('sidecar faiss endpoints reject missing vectors with 400', { skip: !existsSync('.venv/bin/python') }, async (t) => {
  const { spawn } = await import('node:child_process');
  const port = 8198;
  const proc = spawn('.venv/bin/python', ['services/sidecar.py', String(port)], { stdio: 'ignore' });
  t.after(() => proc.kill());
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/health`); if (r.ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const res = await fetch(`http://127.0.0.1:${port}/faiss/search`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ namespace: 'probe' }),
  });
  assert.equal(res.status, 400);
});
