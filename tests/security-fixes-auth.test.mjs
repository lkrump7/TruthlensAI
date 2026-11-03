import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const usersDir = mkdtempSync(join(tmpdir(), 'tl-authfix-users-'));
process.env.TRUTHLENS_USERS_FILE = join(usersDir, 'users.json');
process.env.TRUTHLENS_STORE_FILE = join(usersDir, 'documents.json');
process.env.AUTH_ENABLED = 'true';
process.env.AUTH_SECRET = 'authfix-test-secret';

const post = (url, body, ip, extraHeaders = {}) => new Request(url, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(ip ? { 'x-forwarded-for': ip } : {}),
    ...extraHeaders,
  },
  body: JSON.stringify(body),
});

// 1. Stream route has a 30/min/IP limiter like /api/verify.
test('stream route exports a 30-per-minute per-IP limiter', async () => {
  const { streamRateLimited } = await import('../app/api/verify/stream/route.js');
  assert.equal(typeof streamRateLimited, 'function');
  const key = `stream:9.9.9.1-authfix-${Date.now()}`;
  for (let i = 0; i < 30; i++) assert.equal(streamRateLimited(key), false, `hit ${i + 1} should pass`);
  assert.equal(streamRateLimited(key), true, '31st hit in a minute is limited');
});

// 2. Auth limiter key carries an IP dimension (action:username:ip), 10 per 15 min.
test('auth attempts are limited per IP, not just per username', async () => {
  const { POST, rateLimited } = await import('../app/api/auth/route.js');
  assert.equal(typeof rateLimited, 'function', 'auth limiter is exported for tests');
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../app/api/auth/route.js', import.meta.url), 'utf8');
  const keyLine = src.split('\n').find((l) => l.includes('limitKey'));
  assert.ok(keyLine.includes('clientIp'), 'limiter key carries an IP dimension');
  assert.ok(keyLine.indexOf('username') < keyLine.indexOf('clientIp'), 'limiter key is action:username:ip');
  const user = `ipdim-${Date.now()}`;
  const bad = (ip) => POST(post('http://t/api/auth', { action: 'login', username: user, password: 'wrong-pass-123' }, ip));
  for (let i = 0; i < 10; i++) {
    const res = await bad('10.11.12.13');
    assert.equal(res.status, 401, `attempt ${i + 1} from same IP should be 401`);
  }
  assert.equal((await bad('10.11.12.13')).status, 429, '11th attempt from the same IP is limited');
  assert.equal((await bad('10.11.12.99')).status, 401, 'same username from a fresh IP is not limited');
});

// 3. Passwords longer than 128 chars are rejected before scrypt.
test('overlong passwords are rejected by register and login', async () => {
  const auth = await import('../lib/auth.mjs');
  assert.equal(auth.MAX_PASSWORD_LEN, 128, 'MAX_PASSWORD_LEN is 128');
  const long = 'x'.repeat(129);
  await assert.rejects(() => auth.registerUser(`toolong-${Date.now()}`, long), /at most 128/);
  assert.equal(await auth.authenticateUser(`nobody-${Date.now()}`, long), null);
});

// 4. JSON body-size pre-check runs before req.json() on all four POST routes.
test('auth/verify/batch/stream reject declared-huge bodies with 413', async () => {
  const big = { 'content-length': String(2_000_000) };
  const auth = await import('../app/api/auth/route.js');
  const verify = await import('../app/api/verify/route.js');
  const batch = await import('../app/api/verify/batch/route.js');
  const stream = await import('../app/api/verify/stream/route.js');
  for (const [name, mod, url, body] of [
    ['auth', auth, 'http://t/api/auth', { action: 'login', username: 'u', password: 'p' }],
    ['verify', verify, 'http://t/api/verify', { claim: 'water boils' }],
    ['batch', batch, 'http://t/api/verify/batch', { claims: ['water boils'] }],
    ['stream', stream, 'http://t/api/verify/stream', { claim: 'water boils' }],
  ]) {
    const res = await mod.POST(post(url, body, '127.0.0.40', big));
    assert.equal(res.status, 413, `${name} should 413 a huge content-length`);
  }
});

// 5. Limiter eviction is bounded LRU: a hot key survives a distinct-key flood.
test('limiter keeps a hot key while flooding distinct keys, thresholds hold', async () => {
  const { createBoundedLimiter } = await import('../lib/rate-limit.mjs');
  const limit = createBoundedLimiter({ windowMs: 60000, maxHits: 2, maxKeys: 3 });
  assert.equal(limit.check('hot'), false);
  assert.equal(limit.check('filler-a'), false);
  assert.equal(limit.check('filler-b'), false);
  assert.equal(limit.check('hot'), false, 're-check refreshes recency');
  assert.equal(limit.check('filler-c'), false, 'insert over capacity evicts filler-a, not hot');
  assert.ok(limit.size() <= 3, `keys stay bounded, got ${limit.size()}`);
  assert.equal(limit.check('hot'), true, 'recently used hot key was not washed clean');
  for (let i = 0; i < 50; i++) limit.check(`flood-${i}`);
  assert.ok(limit.size() <= 3, `keys stay bounded after a flood, got ${limit.size()}`);
  // Thresholds from the routes: verify 30, batch 20, stream 30, auth 10.
  const { verifyRateLimited } = await import('../app/api/verify/route.js');
  const { batchRateLimited } = await import('../app/api/verify/batch/route.js');
  const { streamRateLimited } = await import('../app/api/verify/stream/route.js');
  const { rateLimited } = await import('../app/api/auth/route.js');
  const stamp = Date.now();
  const cases = [
    [verifyRateLimited, 30, `v:${stamp}`],
    [batchRateLimited, 20, `b:${stamp}`],
    [streamRateLimited, 30, `s:${stamp}`],
    [rateLimited, 10, `login:user:${stamp}:1.2.3.4`],
  ];
  for (const [fn, max, key] of cases) {
    for (let i = 0; i < max; i++) assert.equal(fn(key), false, `${key} hit ${i + 1} passes`);
    assert.equal(fn(key), true, `${key} hit ${max + 1} is limited`);
  }
});

// 6. Auth GET and the login Set-Cookie carry Cache-Control: no-store.
test('auth GET and login cookie responses are not cacheable', async () => {
  const { POST, GET } = await import('../app/api/auth/route.js');
  const { registerUser } = await import('../lib/auth.mjs');
  const get = await GET(new Request('http://t/api/auth'));
  assert.equal(get.headers.get('cache-control'), 'no-store');
  const user = `nostore-${Date.now()}`;
  await registerUser(user, 'password-123');
  const res = await POST(post('http://t/api/auth', { action: 'login', username: user, password: 'password-123' }, '127.0.0.50'));
  assert.equal(res.status, 200);
  assert.ok((res.headers.get('set-cookie') || '').includes('tl_session='), 'login sets the session cookie');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

// 7. A corrupt stored hash fails closed with a generic error, never raw text.
test('corrupt stored hash gives a generic login failure', async () => {
  const auth = await import('../lib/auth.mjs');
  const name = `corrupt-${Date.now()}`;
  writeFileSync(process.env.TRUTHLENS_USERS_FILE, JSON.stringify([{ username: name, passwordHash: 'not-a-valid-hash', createdAt: new Date().toISOString() }]));
  assert.equal(await auth.authenticateUser(name, 'password-123'), null);
  const { POST } = await import('../app/api/auth/route.js');
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../app/api/auth/route.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /e\.message/, 'login never returns a raw exception message');
  const res = await POST(post('http://t/api/auth', { action: 'login', username: name, password: 'password-123' }, '127.0.0.60'));
  const body = await res.json();
  assert.equal(res.status, 401);
  assert.equal(body.error, 'Invalid username or password.');
});

// 8. Logout clears the cookie with Max-Age=0 and a matching Expires.
test('logout clear-cookie carries Max-Age=0 plus Expires in the past', async () => {
  const { POST } = await import('../app/api/auth/route.js');
  const res = await POST(post('http://t/api/auth', { action: 'logout' }, '127.0.0.70'));
  const cookie = res.headers.get('set-cookie') || '';
  assert.match(cookie, /Max-Age=0/);
  assert.match(cookie, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
});
