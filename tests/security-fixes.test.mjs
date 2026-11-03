import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const usersDir = mkdtempSync(join(tmpdir(), 'tl-sec-users-'));
process.env.TRUTHLENS_USERS_FILE = join(usersDir, 'users.json');
process.env.TRUTHLENS_STORE_FILE = join(usersDir, 'documents.json');

test('authSecret refuses to fall back to dev secret when accounts are on', async () => {
  const savedEnabled = process.env.AUTH_ENABLED;
  const savedSecret = process.env.AUTH_SECRET;
  try {
    process.env.AUTH_ENABLED = 'true';
    delete process.env.AUTH_SECRET;
    const { authSecret } = await import('../lib/auth.mjs?x=secret-guard');
    assert.throws(() => authSecret(), /AUTH_SECRET/);
  } finally {
    if (savedEnabled === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = savedEnabled;
    if (savedSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = savedSecret;
  }
});

test('unknown users still run the password hash so timing does not leak names', async () => {
  const { authenticateUser, registerUser, verifyPassword, DUMMY_PASSWORD_HASH } = await import('../lib/auth.mjs?x=timing');
  assert.ok(typeof DUMMY_PASSWORD_HASH === 'string' && DUMMY_PASSWORD_HASH.includes(':'), 'dummy hash exists for constant-time path');
  assert.equal(verifyPassword('anything-123', DUMMY_PASSWORD_HASH), false);
  await registerUser('timing-alice', 'password-123');
  assert.equal(await authenticateUser('no-such-user-xyz', 'password-123'), null);
  assert.equal((await authenticateUser('timing-alice', 'password-123')).username, 'timing-alice');
});

test('rate limiter bounds memory with many distinct keys', async () => {
  const { createBoundedLimiter } = await import('../lib/rate-limit.mjs');
  const limit = createBoundedLimiter({ windowMs: 60000, maxHits: 2, maxKeys: 5 });
  for (let i = 0; i < 10; i++) limit.check(`key-${i}`);
  assert.ok(limit.size() <= 5, `expected bounded keys, got ${limit.size()}`);
  assert.equal(limit.check('fresh-a'), false);
  assert.equal(limit.check('fresh-a'), false);
  assert.equal(limit.check('fresh-a'), true);
});

test('logout clears the session with the same flags it was set with', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../app/api/auth/route.js', import.meta.url), 'utf8');
  assert.match(src, /SameSite=Lax/);
  assert.match(src, /tl_session=; HttpOnly; Path=\/; SameSite=Lax; Max-Age=0/);
});

test('live research failures stay generic for the client', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../app/api/verify/route.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /Live research failed \(\$\{err\.message\}\)/);
  assert.match(src, /Live research failed\. Retry the claim/);
});

test('a corrupt document store fails closed instead of wiping on next save', async () => {
  const { writeFileSync, readFileSync, readdirSync } = await import('node:fs');
  const dir = mkdtempSync(join(tmpdir(), 'tl-sec-corrupt-'));
  const file = join(dir, 'documents.json');
  writeFileSync(file, '{not json');
  const { FileRepository } = await import('../lib/repositories.mjs?x=sec-corrupt');
  const repo = new FileRepository(file);
  assert.equal((await repo.loadAll()).length, 0);
  await assert.rejects(() => repo.save({ id: 'doc-1', owner: 'demo', claims: [] }), /corrupt/);
  const raw = readFileSync(file, 'utf8');
  assert.equal(raw, '{not json', 'corrupt bytes must survive a refused write');
  assert.ok(readdirSync(dir).some((f) => f.includes('corrupt')));
});

test('website viewer iframe does not allow scripts', async () => {
  const { readFileSync } = await import('node:fs');
  const page = readFileSync(new URL('../app/page.js', import.meta.url), 'utf8');
  const frames = [...page.matchAll(/<iframe[^>]*src=\{viewerDoc\.sourceUrl\}[^>]*>/g)].map((m) => m[0]);
  assert.ok(frames.length >= 1, 'website iframe exists');
  for (const f of frames) assert.doesNotMatch(f, /allow-scripts/);
});

test('oversize uploads are rejected from headers before buffering the body', async () => {
  const { contentLengthTooLarge } = await import('../lib/media-store.mjs');
  const big = new Request('http://t/x', { method: 'POST', headers: { 'content-length': String(30 * 1024 * 1024) } });
  const small = new Request('http://t/x', { method: 'POST', headers: { 'content-length': '100' } });
  assert.equal(contentLengthTooLarge(big, 15 * 1024 * 1024), true);
  assert.equal(contentLengthTooLarge(small, 15 * 1024 * 1024), false);
  const { readFileSync } = await import('node:fs');
  for (const f of ['pdf', 'docx', 'image', 'video', 'audio'].map((k) => `../app/api/documents/${k}/route.js`)) {
    assert.match(readFileSync(new URL(f, import.meta.url), 'utf8'), /contentLengthTooLarge/, `${f} pre-checks content-length`);
  }
});
