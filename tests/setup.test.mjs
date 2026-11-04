import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, constants } from 'node:fs';
import { access } from 'node:fs/promises';

test('setup script exists and covers the easy path', async () => {
  assert.ok(existsSync('setup.sh'), 'setup.sh is missing');
  await access('setup.sh', constants.X_OK);
  const sh = readFileSync('setup.sh', 'utf8');
  assert.ok(sh.includes('node'), 'setup.sh should check node');
  assert.ok(sh.includes('npm ci') || sh.includes('npm install'), 'setup.sh should install deps');
  assert.ok(sh.includes('.env.example') && sh.includes('.env.local'), 'setup.sh should seed .env.local');
  assert.ok(sh.includes('data/') || sh.includes('mkdir'), 'setup.sh should ensure data dirs');
});

test('setup docs exist with copy-paste steps', () => {
  assert.ok(existsSync('SETUP.md'), 'SETUP.md is missing');
  const md = readFileSync('SETUP.md', 'utf8');
  for (const s of ['setup.sh', 'npm run dev', '.env.local', 'npm test', 'localhost:3000']) {
    assert.ok(md.includes(s), `SETUP.md should mention ${s}`);
  }
});

test('package.json exposes the setup entry point', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.ok(pkg.scripts && pkg.scripts.setup, 'package.json needs a setup script');
});
