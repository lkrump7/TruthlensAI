import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dossierBuckets, chapterIndexForPage, filterDossierClaims } from '../lib/ui-state.mjs';

const dossierSrc = readFileSync(new URL('../app/components/book-dossier.js', import.meta.url), 'utf8');

// The dossier component ships JSX, which node:test cannot import, so the
// pure helpers live in a marked dependency-free block that the tests below
// extract and run. This executes the shipped code, not a copy of it.
function loadDossierHelpers() {
  const start = dossierSrc.indexOf('// dossier-pure-helpers:start');
  const end = dossierSrc.indexOf('// dossier-pure-helpers:end');
  assert.ok(start !== -1 && end !== -1 && end > start, 'book-dossier keeps an extractable pure-helper block');
  const block = dossierSrc
    .slice(start, end)
    .split('\n')
    .filter((line) => !line.includes('dossier-pure-helpers:'))
    .map((line) => line.replace(/^export\s+/, ''))
    .join('\n');
  return new Function(`${block}\nreturn { dossierWordDisplay, dossierDocId, serializeClaimCitations };`)();
}

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

test('dossier word display estimates honestly when the doc carries no real count', () => {
  const { dossierWordDisplay } = loadDossierHelpers();
  const claims = Array.from({ length: 8 }, (_, i) => ({ id: `c${i + 1}`, text: `Claim ${i + 1}.`, verdict: 'Supported' }));
  assert.deepEqual(dossierWordDisplay({ id: 'doc-1', title: 'Demo', pages: 312 }, claims), { text: '1,120', estimated: true });
});

test('dossier word display prefers real document text over the claims-based estimate', () => {
  const { dossierWordDisplay } = loadDossierHelpers();
  assert.deepEqual(
    dossierWordDisplay({ id: 'doc-2', title: 'Real', sourcePages: [{ page: 1, text: 'one two three four' }] }, [{ id: 'c1', text: 'x' }]),
    { text: '4', estimated: false },
  );
  assert.deepEqual(
    dossierWordDisplay({ id: 'doc-2b', title: 'Stored', pages: 10, wordCount: 4242 }, [{ id: 'c1', text: 'x' }]),
    { text: '4,242', estimated: false },
  );
});

test('dossier word display reports zero without inventing words for an empty corpus', () => {
  const { dossierWordDisplay } = loadDossierHelpers();
  assert.deepEqual(dossierWordDisplay({ id: 'doc-3', title: 'Empty', pages: 0 }, []), { text: '0', estimated: false });
});

test('dossier doc id shows a short id and never a hash label', () => {
  const { dossierDocId } = loadDossierHelpers();
  assert.equal(dossierDocId({ id: 'doc-1234567890abcdef' }), 'doc-12345678…');
  assert.equal(dossierDocId({ id: 'doc-7' }), 'doc-7');
  assert.equal(dossierDocId({}), 'untitled');
});

test('serializeClaimCitations keeps checked claims with their citations', () => {
  const { serializeClaimCitations } = loadDossierHelpers();
  const parsed = JSON.parse(serializeClaimCitations({ id: 'doc-9', title: 'Mind' }, [
    { id: 'c1', text: 'Gamma matters.', verdict: 'Supported', judgedBy: 'Muse Spark 1.3', page: 14, supporting: [{ title: 'T', source: 'J', passage: 'p' }], contradicting: [] },
    { id: 'c2', text: 'Unchecked.', verdict: null },
    { id: 'c3', text: 'Wrong.', verdict: 'Contradicted', judgedBy: 'Muse Wonder', page: 72, supporting: [], contradicting: [{ title: 'U', source: 'K', passage: 'q' }] },
  ]));
  assert.equal(parsed.docId, 'doc-9');
  assert.equal(parsed.title, 'Mind');
  assert.ok(typeof parsed.exportedAt === 'string' && parsed.exportedAt.length > 0);
  assert.equal(parsed.claims.length, 2);
  assert.equal(parsed.claims[0].id, 'c1');
  assert.equal(parsed.claims[0].supporting.length, 1);
  assert.equal(parsed.claims[1].verdict, 'Contradicted');
  assert.equal(parsed.claims[1].contradicting.length, 1);
});

test('claim citations button downloads client-side JSON instead of the markdown export', () => {
  const line = dossierSrc.split('\n').find((l) => l.includes('Claim Citations JSON'));
  assert.ok(line, 'citations button still exists');
  assert.ok(line.includes('serializeClaimCitations'), 'citations button serializes JSON on the client');
  assert.ok(line.includes('.json'), 'citations download names a JSON file');
  assert.ok(!line.includes('onExportClaim'), 'citations button no longer calls the markdown export');
  const reportLine = dossierSrc.split('\n').find((l) => l.includes('Export Section Report'));
  assert.ok(reportLine && reportLine.includes('onExportClaim'), 'section report button keeps the markdown export');
});

test('dossier never shows a fabricated hash or an unlabelled estimate', () => {
  assert.ok(!dossierSrc.includes('SHA-256'), 'no fabricated hash label in the dossier');
  assert.ok(!dossierSrc.includes('b84c'), 'no hardcoded hash suffix in the dossier');
  assert.ok(dossierSrc.includes('Doc ID:'), 'dossier shows an honest doc id');
  assert.ok(dossierSrc.includes('(estimate)'), 'estimates are labelled as estimates');
});

test('page bins read as sections, never real chapters', () => {
  for (const leftover of ['Chapter Heatmap', 'All Chapters', 'Chapter {', 'Ch {', 'per chapter', 'by chapter', 'Chapter Report']) {
    assert.ok(!dossierSrc.includes(leftover), `no chapter label remains: ${leftover}`);
  }
  for (const marker of ['All Sections', 'Section Heatmap', 'Filter by section', 'Claims per section', 'Section {c.idx}', 'Section {chIdx}', 'Sec {c.idx}']) {
    assert.ok(dossierSrc.includes(marker), marker);
  }
});
