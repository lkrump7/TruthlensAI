import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoundedLimiter } from '../lib/rate-limit.mjs';

test('stale keys are pruned after the window expires', () => {
  const realNow = Date.now;
  try {
    let now = 1_000_000;
    Date.now = () => now;
    const limit = createBoundedLimiter({ windowMs: 1000, maxHits: 100, maxKeys: 100 });
    for (let i = 0; i < 10; i++) limit.check(`stale-${i}`);
    assert.equal(limit.size(), 10);
    now += 2000; // window expired for all 10 stale keys
    for (let i = 0; i < 40; i++) limit.check('fresh');
    assert.ok(limit.size() <= 2, `expected stale keys pruned, got ${limit.size()}`);
  } finally {
    Date.now = realNow;
  }
});
