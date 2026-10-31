import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.TRUTHLENS_USERS_FILE = join(mkdtempSync(join(tmpdir(), 'tl-users-')), 'users.json');
const { registerUser, authenticateUser, createSessionToken, verifySessionToken, hashPassword, verifyPassword } = await import('../lib/auth.mjs');

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

test('session tokens verify, and tampered or expired tokens do not', () => {
  const tok = createSessionToken('alice', 'secret-x', 60000);
  assert.equal(verifySessionToken(tok, 'secret-x').username, 'alice');
  assert.equal(verifySessionToken(tok + 'x', 'secret-x'), null);
  assert.equal(verifySessionToken(tok, 'other-secret'), null);
  const expired = createSessionToken('alice', 'secret-x', -1000);
  assert.equal(verifySessionToken(expired, 'secret-x'), null);
});
