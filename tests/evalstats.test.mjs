import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summariseTrials } from '../lib/evalstats.mjs';

test('summariseTrials reports no flips when every trial agrees', () => {
  const s = summariseTrials(['Supported', 'Supported', 'Supported']);
  assert.equal(s.runs, 3);
  assert.equal(s.majority, 'Supported');
  assert.equal(s.flipRate, 0);
  assert.equal(s.agreed, true);
});

test('summariseTrials reports the majority and flip share on a split', () => {
  const s = summariseTrials(['Supported', 'Contradicted', 'Supported']);
  assert.equal(s.majority, 'Supported');
  assert.ok(Math.abs(s.flipRate - 1 / 3) < 1e-9, `flip rate should be one third, got ${s.flipRate}`);
  assert.equal(s.agreed, false);
});
