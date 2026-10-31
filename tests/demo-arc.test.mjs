import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyClaim, DEMO_EVIDENCE } from '../lib/demo.mjs';

// The three investigations the demo walks, in order. Pinned here so a
// change to the demo corpus that breaks the arc fails loudly.
test('demo arc: a supported claim', async () => {
  const r = await verifyClaim({ text: 'Water boils at 100 degrees Celsius at sea level.' }, DEMO_EVIDENCE);
  assert.equal(r.verdict, 'Supported');
  assert.ok(r.supporting.length >= 1);
});

test('demo arc: a contradicted claim with two independent sources', async () => {
  const r = await verifyClaim({ text: 'Humans only use 10% of their brains.' }, DEMO_EVIDENCE);
  assert.equal(r.verdict, 'Contradicted');
  assert.ok(r.contradicting.length >= 2, 'skeptic turning point needs at least two passages');
  assert.ok(new Set(r.contradicting.map((e) => e.source)).size >= 2, 'passages come from two sources');
});

test('demo arc: an honestly unverifiable claim', async () => {
  const r = await verifyClaim({ text: 'The village of Upper Snelgrove brewed exactly 41 barrels of ale in March 1731.' }, DEMO_EVIDENCE);
  assert.equal(r.verdict, 'Unverifiable');
});
