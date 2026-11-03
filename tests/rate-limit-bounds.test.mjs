import test from 'node:test';
import assert from 'node:assert/strict';

import { createBoundedLimiter } from '../lib/rate-limit.mjs';

test('allows maxHits per window, then blocks', () => {
  const limit = createBoundedLimiter({ windowMs: 60000, maxHits: 2, maxKeys: 5 });
  assert.equal(limit.check('k'), false);
  assert.equal(limit.check('k'), false);
  assert.equal(limit.check('k'), true);
});

test('evicts oldest keys past maxKeys but keeps recent counts', () => {
  const limit = createBoundedLimiter({ windowMs: 60000, maxHits: 1, maxKeys: 3 });
  limit.check('a');
  limit.check('b');
  limit.check('c');
  limit.check('d');
  assert.ok(limit.size() <= 3, `expected <= 3 keys, got ${limit.size()}`);
  // 'd' is recent: second hit is still blocked.
  assert.equal(limit.check('d'), true);
  // 'a' was evicted as oldest: treated as fresh again.
  assert.equal(limit.check('a'), false);
});

test('re-allows after the window slides past', async () => {
  const limit = createBoundedLimiter({ windowMs: 50, maxHits: 2, maxKeys: 5 });
  limit.check('k');
  limit.check('k');
  assert.equal(limit.check('k'), true);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(limit.check('k'), false);
});

test('single-key flood stays fast and stays blocked', () => {
  const limit = createBoundedLimiter({ windowMs: 60000, maxHits: 30, maxKeys: 1000 });
  const floods = 8000;
  const started = Date.now();
  for (let i = 0; i < floods; i++) limit.check('flood');
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 400, `expected 8000-hit flood under 400ms, took ${elapsed}ms`);
  assert.equal(limit.size(), 1);
  for (let i = 0; i < 10; i++) assert.equal(limit.check('flood'), true);
});
