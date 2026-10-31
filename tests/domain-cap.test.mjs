import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capPoolByDomain } from '../lib/rank.mjs';

test('capPoolByDomain keeps at most N passages per domain, best first', () => {
  const pooled = [
    { id: 'a1', source: 'a.example', fusionScore: 0.09 },
    { id: 'a2', source: 'a.example', fusionScore: 0.08 },
    { id: 'a3', source: 'a.example', fusionScore: 0.07 },
    { id: 'a4', source: 'a.example', fusionScore: 0.06 },
    { id: 'b1', source: 'b.example', fusionScore: 0.05 },
    { id: 'c1', source: 'c.example', fusionScore: 0.04 },
  ];
  const capped = capPoolByDomain(pooled, 3);
  assert.deepEqual(capped.map((e) => e.id), ['a1', 'a2', 'a3', 'b1', 'c1']);
  assert.equal(capPoolByDomain(pooled, 0).length, 6, 'a non-positive cap means no cap');
});
