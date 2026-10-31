import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../lib/report.mjs';
import { buildContradictionMap } from '../lib/contradictions.mjs';
import { createDocument, recheckDocument } from '../lib/store.mjs';

test('report puts high-impact disputed claims first and never emits a truth score', () => {
  const claims = [
    { id: 'a', text: 'The mayor was born in 1960 in the capital city.', verdict: 'Supported', page: 1 },
    { id: 'b', text: 'The vaccine reduced hospitalisations by 80 percent among elderly residents.', verdict: 'Contradicted', page: 3 },
    { id: 'c', text: 'A minor festival happens each spring in the village square.', verdict: 'Contradicted', page: 2 },
  ];
  const r = buildReport(claims);
  assert.equal(r.totalClaims, 3);
  assert.equal(r.distribution.Contradicted, 2);
  assert.equal(r.highImpactDisputed[0].id, 'b');
  assert.equal('score' in r, false);
  assert.equal('truthScore' in r, false);
});

test('contradiction map links opposing claims from different books by topic', () => {
  const docs = [
    { id: 'd1', title: 'Book A', claims: [{ id: 'a', text: 'Artificial intelligence increases employment across the economy.', verdict: 'Supported', page: 1 }] },
    { id: 'd2', title: 'Book B', claims: [{ id: 'b', text: 'Artificial intelligence reduces employment across the economy.', verdict: 'Supported', page: 4 }] },
  ];
  const map = buildContradictionMap(docs);
  assert.ok(map.length >= 1);
  assert.equal(map[0].verifiedDisagreement, true);
  assert.equal(map[0].positions.length, 2);
  const unverified = buildContradictionMap(docs.map((d) => ({ ...d, claims: d.claims.map((c) => ({ ...c, verdict: 'Unverifiable' })) })));
  assert.equal(unverified[0].verifiedDisagreement, false);
  assert.deepEqual(map[0].positions.map((p) => p.docTitle).sort(), ['Book A', 'Book B']);
});

test('recheck appends a verdict history without losing the original assessment', async () => {
  const doc = await createDocument({ title: 'Recheck probe', owner: 'impact', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }] });
  const before = doc.claims[0];
  assert.equal(before.history.length, 1);
  assert.equal(before.history[0].verdict, before.verdict);
  const updated = await recheckDocument(doc.id);
  const after = updated.claims[0];
  assert.equal(after.history.length, 2);
  assert.equal(after.history[0].verdict, before.verdict);
});
