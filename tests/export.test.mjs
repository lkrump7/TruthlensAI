import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInvestigationReport } from '../lib/export.mjs';

const RECORD = {
  text: 'Humans only use 10% of their brains.',
  verdict: 'Contradicted',
  type: 'Scientific',
  judgedBy: 'Muse Wonder',
  mode: 'live',
  explanation: 'Fetched passages contradict it.',
  supporting: [],
  contradicting: [{ id: 'e1', title: 'Brain scans', source: 'a.example', date: '2020-01-01', url: 'https://a.example/brain', passage: 'Activity throughout the brain.' }],
  limitations: ['Verdict rests only on the fetched passages cited here.'],
  stability: { runs: 3, verdicts: ['Contradicted', 'Contradicted', 'Contradicted'], agreed: true, majority: 'Contradicted' },
  trajectory: ['triage', 'researchNode', 'judge', 'gates', 'challengeNode', 'assemble'],
};

test('report names the claim, verdict, passage and its URL, and the limits', () => {
  const md = buildInvestigationReport(RECORD, { now: new Date('2026-10-31T00:00:00Z') });
  assert.match(md, /Humans only use 10% of their brains\./);
  assert.match(md, /Contradicted/);
  assert.match(md, /Activity throughout the brain\./);
  assert.match(md, /https:\/\/a\.example\/brain/);
  assert.match(md, /Verdict rests only on the fetched passages/);
  assert.match(md, /Muse Wonder/);
  assert.match(md, /2026-10-31/);
});

test('report shows stability runs and agreement when present', () => {
  const md = buildInvestigationReport(RECORD, { now: new Date('2026-10-31T00:00:00Z') });
  assert.match(md, /3 runs/);
  assert.match(md, /agreed/i);
});

test('report never invents a confidence percentage', () => {
  const md = buildInvestigationReport(RECORD, { now: new Date('2026-10-31T00:00:00Z') });
  assert.ok(!/\b\d{1,3}\s*%\s*confiden/i.test(md), 'no confidence percentage may appear');
  assert.ok(!/truth score/i.test(md), 'no truth score may appear');
});

test('unverifiable report exports with no passages and still states limits', () => {
  const md = buildInvestigationReport({ text: 'An obscure claim.', verdict: 'Unverifiable', type: 'Scientific', judgedBy: 'Muse Spark 1.3', mode: 'live', explanation: 'Nothing fetched touched it.', supporting: [], contradicting: [], limitations: ['No fetched passage passed relevance checks.'] }, { now: new Date('2026-10-31T00:00:00Z') });
  assert.match(md, /Unverifiable/);
  assert.match(md, /No fetched passage passed/);
});

test('report labels the export date and never stamps a prompt version the record lacks', () => {
  const md = buildInvestigationReport({ text: 'A claim.', verdict: 'Supported', judgedBy: 'Muse Spark 1.3', mode: 'demo', explanation: 'e', supporting: [], contradicting: [], limitations: ['l'] }, { now: new Date('2026-10-31T00:00:00Z') });
  assert.match(md, /Exported: 2026-10-31/);
  assert.ok(!/Run date/.test(md), 'export date must not be called the run date');
  assert.ok(!/Prompt version/.test(md), 'no prompt version may be printed for a record that does not carry one');
});

test('report prints the prompt version the record carries', () => {
  const md = buildInvestigationReport({ ...RECORD, promptVersion: '2026-10-31' }, { now: new Date('2026-10-31T00:00:00Z') });
  assert.match(md, /Prompt version: 2026-10-31/);
});

test('report records the run date and every model from judges plus judgedBy', () => {
  const record = {
    ...RECORD,
    judgedBy: 'Muse Wonder',
    judges: { spark: 'Supported', wonder: 'Contradicted', agreed: false },
    history: [
      { at: '2026-10-29T10:00:00.000Z', verdict: 'Supported', judgedBy: 'Muse Spark 1.3' },
      { at: '2026-10-30T12:00:00.000Z', verdict: 'Contradicted', judgedBy: 'Muse Wonder' },
    ],
  };
  const md = buildInvestigationReport(record, { now: new Date('2026-10-31T00:00:00Z') });
  const modelsLine = md.split('\n').find((l) => l.startsWith('Models:')) || '';
  assert.match(modelsLine, /Muse Spark 1\.3/);
  assert.match(modelsLine, /Muse Wonder/);
  assert.match(md, /^Run: 2026-10-30$/m);
  assert.match(md, /^Exported: 2026-10-31$/m);
});

test('report gives Run: not recorded when the record has no history', () => {
  const md = buildInvestigationReport({ text: 'A claim.', verdict: 'Supported', judgedBy: 'Muse Spark 1.3', mode: 'live', explanation: 'e', supporting: [], contradicting: [], limitations: ['l'] }, { now: new Date('2026-10-31T00:00:00Z') });
  assert.match(md, /^Run: not recorded$/m);
  const modelsLine = md.split('\n').find((l) => l.startsWith('Models:')) || '';
  assert.match(modelsLine, /Muse Spark 1\.3/);
});

test('single-run stability never claims the runs disagreed', () => {
  const md = buildInvestigationReport({ ...RECORD, stability: { runs: 1, verdicts: ['Contradicted'], agreed: false, majority: 'Contradicted' } }, { now: new Date('2026-10-31T00:00:00Z') });
  assert.match(md, /No repeat run/);
  assert.ok(!/runs disagreed/.test(md), 'one run cannot disagree with itself');
});

// Route tests: export renders only a verdict already stored on a document.
// Seeded through the document helpers, the same way reader.test.mjs does.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'tl-export-'));
process.env.TRUTHLENS_STORE_FILE = join(dir, 'documents.json');
delete process.env.META_MODEL_API_URL;
delete process.env.META_MODEL_API_KEY;

const { createDocument, getDocument, whenAutoVerificationDone } = await import('../lib/documents.mjs');
const { createSessionToken, authSecret } = await import('../lib/auth.mjs');
const exportRoute = await import('../app/api/export/route.js');

const postExport = (body) => exportRoute.POST(new Request('http://t/api/export', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}));

async function seededDoc() {
  const pages = [];
  for (let p = 1; p <= 60; p++) pages.push({ page: p, text: `Chapter background on page ${p} explains general context and definitions for readers of this book at length today.` });
  pages[58] = { page: 59, text: 'The vaccine reduced hospitalisations by 80 percent among elderly residents in the trial.' };
  const doc = await createDocument({ title: 'Export Book', owner: 'reader', pages });
  await whenAutoVerificationDone(doc.id);
  return getDocument(doc.id);
}

test('export route renders the stored verdict for its doc and claim IDs', async () => {
  const doc = await seededDoc();
  const claim = doc.claims.find((c) => c.status === 'verified');
  assert.ok(claim, 'seeded doc has a verified claim');
  const res = await postExport({ docId: doc.id, claimId: claim.id });
  assert.equal(res.status, 200);
  assert.match(await res.text(), new RegExp(claim.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('export route refuses a forged record posted with no IDs', async () => {
  const res = await postExport({ record: { text: 'Forged claim that was never checked.', verdict: 'Supported', judgedBy: 'Nobody', explanation: 'Made up.', supporting: [], contradicting: [], limitations: [] } });
  assert.equal(res.status, 400);
  assert.ok(!(await res.text()).includes('Forged claim'));
});

test('export route 404s an unknown document and an unknown claim', async () => {
  const doc = await seededDoc();
  const claim = doc.claims.find((c) => c.status === 'verified');
  assert.equal((await postExport({ docId: 'doc-999999', claimId: claim.id })).status, 404);
  assert.equal((await postExport({ docId: doc.id, claimId: 'no-such-claim' })).status, 404);
});

test('export route owner-checks when accounts are on (TL-019)', async () => {
  const mk = async (owner) => {
    const doc = await createDocument({ title: `Export ${owner}`, owner, pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }] });
    await whenAutoVerificationDone(doc.id);
    const fresh = await getDocument(doc.id);
    return { doc: fresh, claim: fresh.claims.find((c) => c.status === 'verified') };
  };
  const alice = await mk('alice');
  const bob = await mk('bob');
  const demo = await mk('demo');
  assert.ok(alice.claim && bob.claim && demo.claim, 'seeded docs have verified claims');
  const cookie = `tl_session=${encodeURIComponent(createSessionToken('alice', authSecret()))}`;
  const as = (body, headers = {}) => exportRoute.POST(new Request('http://t/api/export', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  }));
  const saved = process.env.AUTH_ENABLED;
  try {
    process.env.AUTH_ENABLED = 'true';
    assert.equal((await as({ docId: bob.doc.id, claimId: bob.claim.id }, { cookie })).status, 404, 'other user gets 404');
    assert.equal((await as({ docId: bob.doc.id, claimId: bob.claim.id })).status, 404, 'anonymous gets 404');
    assert.equal((await as({ docId: alice.doc.id, claimId: alice.claim.id }, { cookie })).status, 200, 'owner gets 200');
    assert.equal((await as({ docId: demo.doc.id, claimId: demo.claim.id }, { cookie })).status, 200, 'demo doc gets 200');
    delete process.env.AUTH_ENABLED;
    assert.equal((await as({ docId: bob.doc.id, claimId: bob.claim.id })).status, 200, 'accounts off stays open');
  } finally {
    if (saved === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = saved;
  }
});

test('export route 422s a claim with no verdict yet', async () => {
  const doc = await seededDoc();
  const claim = doc.claims.find((c) => c.status !== 'verified');
  assert.ok(claim, 'seeded doc has a claim with no verdict');
  assert.equal((await postExport({ docId: doc.id, claimId: claim.id })).status, 422);
});
