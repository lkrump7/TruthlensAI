import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.TRUTHLENS_USERS_FILE = join(mkdtempSync(join(tmpdir(), 'tl-users-')), 'users.json');
const { registerUser, authenticateUser, createSessionToken, verifySessionToken, hashPassword, verifyPassword, authEnabled, requestUser, authSecret, sessionCookie, currentUser } = await import('../lib/auth.mjs');

test('accounts are off by default and only on when AUTH_ENABLED opts in', () => {
  assert.equal(authEnabled({}), false);
  assert.equal(authEnabled({ AUTH_ENABLED: 'false' }), false);
  assert.equal(authEnabled({ AUTH_ENABLED: '0' }), false);
  assert.equal(authEnabled({ AUTH_ENABLED: 'true' }), true);
  assert.equal(authEnabled({ AUTH_ENABLED: '1' }), true);
  assert.equal(authEnabled({ AUTH_ENABLED: 'TRUE' }), true);
});

test('passwords are hashed with a salt and verify correctly', () => {
  const h = hashPassword('correct horse battery');
  assert.ok(!h.includes('correct horse'));
  assert.equal(verifyPassword('correct horse battery', h), true);
  assert.equal(verifyPassword('wrong password', h), false);
  assert.notEqual(hashPassword('correct horse battery'), h);
});

test('register then authenticate round-trips; duplicates and bad passwords fail', async () => {
  await registerUser('alice', 'password-123');
  assert.equal((await authenticateUser('alice', 'password-123')).username, 'alice');
  assert.equal(await authenticateUser('alice', 'nope-nope'), null);
  await assert.rejects(() => registerUser('alice', 'password-123'), /already exists/);
  await assert.rejects(() => registerUser('bob', 'short'), /8 characters/);
});

test('requestUser is null with accounts off and reads the session with accounts on', () => {
  const saved = process.env.AUTH_ENABLED;
  const savedSecret = process.env.AUTH_SECRET;
  try {
    process.env.AUTH_SECRET = 'test-secret-for-auth-test';
    const cookie = sessionCookie(createSessionToken('alice', authSecret()));
    const req = () => new Request('http://t/x', { headers: { cookie } });
    delete process.env.AUTH_ENABLED;
    assert.equal(requestUser(req()), null);
    process.env.AUTH_ENABLED = 'true';
    assert.equal(requestUser(req()).username, 'alice');
    assert.equal(requestUser(new Request('http://t/x')), null);
  } finally {
    if (saved === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = saved;
    if (savedSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = savedSecret;
  }
});

test('a malformed session cookie reads as signed out, not as a server error', () => {
  assert.equal(currentUser(new Request('http://t/x', { headers: { cookie: 'tl_session=%zz' } })), null);
  assert.equal(currentUser(new Request('http://t/x', { headers: { cookie: 'tl_session=abc%' } })), null);
});

test('session tokens verify, and tampered or expired tokens do not', () => {
  const tok = createSessionToken('alice', 'secret-x', 60000);
  assert.equal(verifySessionToken(tok, 'secret-x').username, 'alice');
  assert.equal(verifySessionToken(tok + 'x', 'secret-x'), null);
  assert.equal(verifySessionToken(tok, 'other-secret'), null);
  const expired = createSessionToken('alice', 'secret-x', -1000);
  assert.equal(verifySessionToken(expired, 'secret-x'), null);
});
