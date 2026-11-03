import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('registerUser rejects when the users file cannot be written (no phantom account)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tl-users-fail-'));
  const blocker = join(dir, 'blocker');
  writeFileSync(blocker, 'x');
  process.env.TRUTHLENS_USERS_FILE = join(blocker, 'users.json');
  const { registerUser } = await import('../lib/auth.mjs');
  await assert.rejects(() => registerUser('phantom-user', 'password-123'));
});
