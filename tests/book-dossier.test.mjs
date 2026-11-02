import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dossierBuckets, chapterIndexForPage, filterDossierClaims } from '../lib/ui-state.mjs';

const claims8 = [
  { id: 'c1', text: 'Gamma synchrony underlies perception.', verdict: 'Supported', page: 14 },
  { id: 'c2', text: 'Adult neurogenesis persists lifelong.', verdict: 'Partially supported', page: 48 },
  { id: 'c3', text: 'Humans use 10% of their brains.', verdict: 'Contradicted', page: 72 },
  { id: 'c4', text: 'Lucid clarity exceeds waking baseline.', verdict: 'Unverifiable', page: 119 },
  { id: 'c5', text: 'Orientation columns prefer lines.', verdict: 'Supported', page: 142 },
  { id: 'c6', text: 'Engram reactivation retrieves fear.', verdict: 'Supported', page: 188 },
  { id: 'c7', text: 'Population vectors predict trajectory.', verdict: 'Supported', page: 246 },
  { id: 'c8', text: 'Workspace ignition marks consciousness.', verdict: 'Supported', page: 31 },
];

test('dossierBuckets sorts eight checked claims the way the dashboard shows them', () => {
  const b = dossierBuckets(claims8);
  assert.equal(b.total, 8);
  assert.equal(b.supported, 5);
  assert.equal(b.contradicted, 1);
  assert.equal(b.partial, 1);
  assert.equal(b.unverifiable, 1);
  assert.equal(b.supportedPct, 62.5);
  assert.equal(b.contradictedPct, 12.5);
});

test('dossierBuckets folds edge verdicts and unchecked claims into the four cards', () => {
  const b = dossierBuckets([
    { id: 'a', text: 'A claim with spin.', verdict: 'Misleading' },
    { id: 'b', text: 'An old consensus.', verdict: 'Outdated' },
    { id: 'c', text: 'Nobody checked this yet.', verdict: null },
    { id: 'd', text: 'Not a factual claim.', verdict: 'Not fact-checkable' },
  ]);
  assert.equal(b.total, 4);
  assert.equal(b.partial, 2);
  assert.equal(b.unverifiable, 2);
  assert.equal(b.supported, 0);
  assert.equal(b.contradicted, 0);
  assert.deepEqual(dossierBuckets(null), { total: 0, supported: 0, contradicted: 0, partial: 0, unverifiable: 0, supportedPct: 0, contradictedPct: 0, partialPct: 0, unverifiablePct: 0 });
});

test('chapterIndexForPage spreads pages across eight chapters', () => {
  assert.equal(chapterIndexForPage(14, 312, 8), 1);
  assert.equal(chapterIndexForPage(31, 312, 8), 1);
  assert.equal(chapterIndexForPage(48, 312, 8), 2);
  assert.equal(chapterIndexForPage(246, 312, 8), 7);
  assert.equal(chapterIndexForPage(312, 312, 8), 8);
  assert.equal(chapterIndexForPage(null, 312, 8), 1);
  assert.equal(chapterIndexForPage(10, 0, 8), 1);
});

test('filterDossierClaims narrows by verdict bucket and chapter together', () => {
  assert.deepEqual(filterDossierClaims(claims8, { bucket: 'all', chapter: 'all', totalPages: 312 }).map((c) => c.id),
    ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8']);
  assert.deepEqual(filterDossierClaims(claims8, { bucket: 'supported', chapter: 'all', totalPages: 312 }).map((c) => c.id),
    ['c1', 'c5', 'c6', 'c7', 'c8']);
  assert.deepEqual(filterDossierClaims(claims8, { bucket: 'all', chapter: 1, totalPages: 312 }).map((c) => c.id),
    ['c1', 'c8']);
  assert.deepEqual(filterDossierClaims(claims8, { bucket: 'contradicted', chapter: 2, totalPages: 312 }).map((c) => c.id),
    ['c3']);
  assert.deepEqual(filterDossierClaims(claims8, { bucket: 'contradicted', chapter: 5, totalPages: 312 }).map((c) => c.id),
    []);
  assert.deepEqual(filterDossierClaims(null, { bucket: 'all', chapter: 'all' }), []);
});
