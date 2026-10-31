import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pingForMiss, PING_CATEGORIES } from '../lib/failures.mjs';

test('PING taxonomy covers the four trajectory failure types', () => {
  assert.deepEqual(PING_CATEGORIES, ['Propagation', 'Intent', 'Noise-induced', 'Grounding']);
});

test('pingForMiss derives the category from a missed verdict shape', () => {
  assert.equal(pingForMiss(null), 'Grounding');
  assert.equal(pingForMiss({ verdict: 'Not fact-checkable', research: { fetched: 0 } }), 'Intent');
  assert.equal(pingForMiss({ verdict: 'Unverifiable', research: { fetched: 0 } }), 'Grounding');
  assert.equal(pingForMiss({ verdict: 'Partially supported', subclaims: [{ verdict: 'Supported' }, { verdict: 'Unverifiable' }] }), 'Propagation');
  assert.equal(pingForMiss({ verdict: 'Unverifiable', research: { fetched: 3 } }), 'Noise-induced');
  // A decisive miss with evidence in hand has no shape-provable cause:
  // guessing Grounding would mislabel possible judge errors.
  assert.equal(pingForMiss({ verdict: 'Supported', research: { fetched: 3 } }), null);
});
