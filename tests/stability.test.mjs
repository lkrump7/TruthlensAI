import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summariseStability } from '../lib/stability.mjs';

test('summariseStability reports agreement when every run matches', () => {
  const s = summariseStability(['Supported', 'Supported', 'Supported']);
  assert.equal(s.runs, 3);
  assert.equal(s.agreed, true);
  assert.equal(s.majority, 'Supported');
});

test('summariseStability reports disagreement and the majority on a split', () => {
  const s = summariseStability(['Contradicted', 'Supported', 'Contradicted']);
  assert.equal(s.runs, 3);
  assert.equal(s.agreed, false);
  assert.equal(s.majority, 'Contradicted');
  assert.deepEqual(s.verdicts, ['Contradicted', 'Supported', 'Contradicted']);
});

test('summariseStability handles a single run without claiming agreement', () => {
  const s = summariseStability(['Supported']);
  assert.equal(s.runs, 1);
  assert.equal(s.agreed, false);
  assert.equal(s.majority, 'Supported');
});
