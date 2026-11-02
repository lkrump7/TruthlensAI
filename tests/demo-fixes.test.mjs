import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildInvestigationReport } from '../lib/export.mjs';

process.env.TRUTHLENS_STORE_FILE = join(mkdtempSync(join(tmpdir(), 'tl-fixes-')), 'documents.json');
const { recordInvestigation, listHistory, getHistoryEntry } = await import('../lib/history.mjs');
const { createDocument, recheckDocument, getDocument, whenAutoVerificationDone, listDocuments } = await import('../lib/documents.mjs');
const { repository } = await import('../lib/repositories.mjs');
const { pdfNeedsOcr } = await import('../lib/pdf.mjs');
const { buildContradictionMap } = await import('../lib/contradictions.mjs');
const { applyGates } = await import('../lib/verdict.mjs');
const { localSuggestions } = await import('../lib/suggest.mjs');
const { pagesCharCount } = await import('../lib/documents.mjs');
const { CONFIG } = await import('../lib/config.mjs');
const verdictFor = (text, verdict = 'Supported') => ({ text, type: 'Scientific', verdict, judgedBy: 'Muse Spark 1.3', supporting: [], contradicting: [], explanation: 'Checked.', limitations: [] });

test('report renders follow-up checks stored on the claim', () => {
  const md = buildInvestigationReport({
    text: 'Water boils at 100 degrees Celsius.',
    verdict: 'Supported',
    judgedBy: 'Muse Spark 1.3',
    mode: 'demo',
    explanation: 'Fetched passages support it.',
    supporting: [], contradicting: [], limitations: ['l'],
    followups: [{ at: '2026-11-01T00:00:00Z', kind: 'prove-wrong', instruction: 'State what would prove this wrong.', verdict: 'Supported', judgedBy: 'Muse Spark 1.3', explanation: 'Nothing contradicted it.', falsifier: 'A contradicting passage.', falsifierFound: false }],
  }, { now: new Date('2026-11-01T00:00:00Z') });
  assert.match(md, /Follow-up/);
  assert.match(md, /State what would prove this wrong/);
});

test('history lookup finds a claim folded as a duplicate', async () => {
  const a = await recordInvestigation({ owner: 'fix-hist', workflow: 'claim', result: verdictFor('Water boils at 100 degrees Celsius at sea level in kitchens.') });
  const b = await recordInvestigation({ owner: 'fix-hist', workflow: 'claim', result: verdictFor('Water boils at 100 degrees Celsius at sea level in kitchens!') });
  const rows = await listHistory('fix-hist', { limit: 100 });
  assert.equal(rows.length, 1, 'similar claims fold to one row');
  const foldedId = rows[0].duplicates[0].claimId;
  assert.ok(await getHistoryEntry('fix-hist', foldedId), 'folded duplicate id must still resolve');
  assert.ok(await getHistoryEntry('fix-hist', a.claim.id));
  assert.ok(b.claim.id);
});

test('recheck checks unverified claims and keeps stored text and type', async () => {
  const doc = await createDocument({ title: 'Recheck fix', owner: 'fix-recheck', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }] });
  await whenAutoVerificationDone(doc.id);
  const stored = await getDocument(doc.id);
  stored.claims[0].status = 'unverified';
  stored.claims[0].type = 'Historical';
  delete stored.claims[0].verdict;
  await repository().save(stored);
  const updated = await recheckDocument(doc.id);
  const claim = updated.claims[0];
  assert.equal(claim.status, 'verified', 'unverified claim must be rechecked');
  assert.equal(claim.type, 'Historical', 'stored type must survive recheck');
  assert.match(claim.text, /Water boils at 100/);
});

test('whitespace title and missing title dedupe to one library entry', async () => {
  const pages = [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }];
  const a = await createDocument({ title: '   ', pages, owner: 'fix-dedupe' });
  const b = await createDocument({ title: undefined, pages, owner: 'fix-dedupe' });
  await whenAutoVerificationDone(a.id); await whenAutoVerificationDone(b.id);
  const listed = (await listDocuments('fix-dedupe')).filter((d) => d.owner === 'fix-dedupe');
  assert.equal(listed.length, 1, 'same source under whitespace vs missing title must list once');
});

test('pdfNeedsOcr flags empty and near-empty text layers', () => {
  assert.equal(pdfNeedsOcr([]), true);
  assert.equal(pdfNeedsOcr([{ page: 1, text: 'Short cover line.' }]), true, 'partial text layer must try OCR');
  assert.equal(pdfNeedsOcr([{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens. '.repeat(4) }]), false);
});

test('contradiction map flags unverified disagreement without calling it verified', () => {
  const docs = [
    { id: 'doc-a', title: 'A', claims: [{ id: 'a1', text: 'The programme increases rural clinic visits in 2020.', page: 1 }] },
    { id: 'doc-b', title: 'B', claims: [{ id: 'b1', text: 'The programme reduces rural clinic visits in 2020.', page: 2 }] },
  ];
  const map = buildContradictionMap(docs);
  assert.ok(map.length >= 1);
  assert.equal(map[0].verifiedDisagreement, false);
});

test('corroboration-created partial verdict can still become outdated', () => {
  const out = applyGates({ verdict: 'Supported', cited: [{ source: 'a.example', date: '2024-01-01' }], supporting: [{ source: 'a.example', date: '2019-01-01' }], contradicting: [{ source: 'a.example', date: '2024-01-01' }], limitations: [] });
  assert.equal(out.verdict, 'Outdated');
});

test('export never prints undefined for array-form judges', () => {
  const md = buildInvestigationReport({ text: 'A claim.', verdict: 'Supported', judgedBy: 'Muse Spark 1.3', mode: 'live', explanation: 'e', supporting: [], contradicting: [], limitations: ['l'], judges: [{ model: 'Muse Spark 1.3' }, { model: 'Muse Wonder' }] }, { now: new Date('2026-11-01T00:00:00Z') });
  assert.ok(!md.includes('undefined'));
});

test('pagesCharCount sums page text for the size cap', () => {
  assert.equal(pagesCharCount([{ page: 1, text: 'abc' }, { page: 2, text: 'de' }]), 5);
  assert.ok(pagesCharCount([{ page: 1, text: 'x'.repeat(CONFIG.MAX_DOCUMENT_CHARS + 1) }]) > CONFIG.MAX_DOCUMENT_CHARS);
});

test('local suggestions trace word-numeral figures', () => {
  const out = localSuggestions({ text: 'The fund spent forty million dollars on clinics.', supporting: [{ title: 'T', source: 's.example', date: '2020-01-01', passage: 'Spent money.' }], contradicting: [] });
  assert.ok(out.some((s) => /figure|forty/i.test(s.question + s.why)), 'word numeral must trigger the figure probe');
});
