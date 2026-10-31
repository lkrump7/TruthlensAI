import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter, mapWithConcurrency } from '../lib/limit.mjs';

test('limiter never runs more than the cap at once and completes everything', async () => {
  const run = createLimiter(4);
  let active = 0, peak = 0, done = 0;
  await Promise.all(Array.from({ length: 10 }, () => run(async () => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 10)); active--; done++; })));
  assert.equal(peak, 4);
  assert.equal(done, 10);
});

test('mapWithConcurrency preserves order under a cap', async () => {
  let active = 0, peak = 0;
  const out = await mapWithConcurrency([1, 2, 3, 4, 5, 6], 4, async (n) => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 5)); active--; return n * 2; });
  assert.deepEqual(out, [2, 4, 6, 8, 10, 12]);
  assert.ok(peak <= 4 && peak > 1);
});
