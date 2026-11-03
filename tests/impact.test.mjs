import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../lib/report.mjs';
import { buildContradictionMap } from '../lib/contradictions.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolated store: this file writes documents and must not share
// data/documents.json with parallel test processes (see loop/bdd-progress.md).
const impactDir = mkdtempSync(join(tmpdir(), 'tl-impact-'));
process.env.TRUTHLENS_STORE_FILE = join(impactDir, 'documents.json');
process.env.TRUTHLENS_USERS_FILE = join(impactDir, 'users.json');
import { createDocument, getDocument, recheckDocument, whenAutoVerificationDone } from '../lib/store.mjs';

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
  await whenAutoVerificationDone(doc.id);
  // The repository has copy semantics: re-read settled state instead of
  // relying on the held object being the stored object.
  const before = (await getDocument(doc.id)).claims[0];
  assert.equal(before.history.length, 1);
  assert.equal(before.history[0].verdict, before.verdict);
  const updated = await recheckDocument(doc.id);
  const after = updated.claims[0];
  assert.equal(after.history.length, 2);
  assert.equal(after.history[0].verdict, before.verdict);
});
