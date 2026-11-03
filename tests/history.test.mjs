import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'tl-history-'));
const storeFile = join(dir, 'documents.json');
process.env.TRUTHLENS_STORE_FILE = storeFile;
delete process.env.META_MODEL_API_URL;
delete process.env.META_MODEL_API_KEY;

const { parseClaimBatch, recordInvestigation, listHistory, verifyClaimBatch, MAX_BATCH_CLAIMS } = await import('../lib/history.mjs');
const { createDocument, whenAutoVerificationDone, seedDemo, deleteDocument } = await import('../lib/documents.mjs');

const verdictFor = (text, verdict = 'Supported') => ({
  text, type: 'Scientific', verdict, judgedBy: 'Muse Spark 1.3',
  supporting: [], contradicting: [], explanation: 'Checked.', limitations: [],
});

test('parseClaimBatch splits one claim per line, trims, and drops blanks', () => {
  const out = parseClaimBatch('  Water boils at 100 degrees Celsius at sea level.  \n\nHumans only use 10% of their brains.\n   \n');
  assert.deepEqual(out, [
    'Water boils at 100 degrees Celsius at sea level.',
    'Humans only use 10% of their brains.',
  ]);
});

test('parseClaimBatch accepts a list and drops exact duplicates keeping first order', () => {
  const out = parseClaimBatch(['B claim here.', 'A claim here.', 'b claim here.', 'A claim here.']);
  assert.deepEqual(out, ['B claim here.', 'A claim here.']);
});

test('parseClaimBatch caps the batch and reports the cap', () => {
  const many = Array.from({ length: MAX_BATCH_CLAIMS + 5 }, (_, i) => `Claim number ${i + 1} is stated here.`);
  assert.equal(parseClaimBatch(many.join('\n')).length, MAX_BATCH_CLAIMS);
  assert.equal(parseClaimBatch('').length, 0);
  assert.equal(parseClaimBatch(null).length, 0);
});

test('recordInvestigation persists a standalone verdict a fresh read can find', async () => {
  const saved = await recordInvestigation({
    owner: 'reader-a',
    workflow: 'claim',
    result: verdictFor('Water boils at 100 degrees Celsius at sea level.'),
  });
  assert.ok(saved.claim.id, 'record returns the stored claim id');
  assert.equal(saved.claim.source, 'standalone');
  assert.equal(saved.claim.status, 'verified');

  const onDisk = JSON.parse(readFileSync(storeFile, 'utf8'));
  const historyDoc = onDisk.find((d) => d.kind === 'history' && d.owner === 'reader-a');
  assert.ok(historyDoc, 'history document is written to the store file');
  assert.ok(historyDoc.claims.some((c) => c.text.includes('Water boils')), 'verdict text is on disk');

  const entries = await listHistory('reader-a');
  const hit = entries.find((e) => e.claimId === saved.claim.id);
  assert.ok(hit, 'history listing finds the recorded claim');
  assert.equal(hit.workflow, 'claim');
  assert.equal(hit.verdict, 'Supported');
  assert.equal(hit.text, 'Water boils at 100 degrees Celsius at sea level.');
  assert.ok(hit.claim.supporting !== undefined, 'entry carries the full verdict record for resume');
});

test('recordInvestigation replays the same key instead of recording twice', async () => {
  const { recordInvestigation: record2 } = await import('../lib/history.mjs');
  const key = `idem-${Date.now()}-${Math.random()}`;
  const first = await record2({ owner: 'reader-idem', workflow: 'claim', result: verdictFor('Water boils at 100 degrees Celsius at sea level.'), idempotencyKey: key });
  const second = await record2({ owner: 'reader-idem', workflow: 'claim', result: verdictFor('Water boils at 100 degrees Celsius at sea level.'), idempotencyKey: key });
  assert.equal(second.claim.id, first.claim.id, 'same key replays the same claim');
  assert.equal(second.doc.id, first.doc.id);
});

test('recordInvestigation drops ephemeral verdict fields instead of persisting them', async () => {
  const saved = await recordInvestigation({
    owner: 'reader-ephemeral',
    workflow: 'claim',
    result: {
      ...verdictFor('Water boils at 100 degrees Celsius at sea level.'),
      mode: 'live', models: ['muse-spark-1.3'], missing: ['x'], nliChecks: [{ ok: true }],
    },
  });
  for (const key of ['mode', 'models', 'missing', 'nliChecks']) {
    assert.equal(saved.claim[key], undefined, `stored claim drops ${key}`);
  }
  assert.ok(saved.claim.supporting !== undefined, 'evidence fields are kept');
  const onDisk = JSON.parse(readFileSync(storeFile, 'utf8'));
  const stored = onDisk.find((d) => d.kind === 'history' && d.owner === 'reader-ephemeral')
    .claims.find((c) => c.id === saved.claim.id);
  for (const key of ['mode', 'models', 'missing', 'nliChecks']) {
    assert.equal(stored[key], undefined, `persisted claim drops ${key}`);
  }
});

test('listHistory covers book claims and standalone claims in one list, newest first', async () => {
  const doc = await createDocument({
    title: 'Memory Book', owner: 'reader-b',
    pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens everywhere today. Humans only use 10 percent of their brains according to the old myth repeated here.' }],
  });
  await whenAutoVerificationDone(doc.id);
  await recordInvestigation({ owner: 'reader-b', workflow: 'claim', result: verdictFor('The Moon landing happened in 1969.', 'Supported') });

  const all = await listHistory('reader-b');
  const workflows = new Set(all.map((e) => e.workflow));
  assert.ok(workflows.has('claim'), 'standalone workflow present');
  assert.ok(workflows.has('book'), `book workflow present, got ${[...workflows]}`);
  assert.ok(all.length >= 2);
  const times = all.map((e) => e.at);
  assert.deepEqual(times, [...times].sort().reverse(), 'entries sort newest first');
});

test('listHistory narrows by search words, verdict, and workflow', async () => {
  await recordInvestigation({ owner: 'reader-c', workflow: 'claim', result: verdictFor('Water boils at 100 degrees Celsius at sea level.', 'Supported') });
  await recordInvestigation({ owner: 'reader-c', workflow: 'claim', result: verdictFor('Humans only use 10% of their brains.', 'Contradicted') });

  const byWords = await listHistory('reader-c', { query: 'brains' });
  assert.ok(byWords.length >= 1 && byWords.every((e) => /brains/i.test(e.text)), 'word search keeps only matches');

  const byVerdict = await listHistory('reader-c', { verdict: 'Contradicted' });
  assert.ok(byVerdict.length >= 1 && byVerdict.every((e) => e.verdict === 'Contradicted'), 'verdict filter keeps only matches');

  const byWorkflow = await listHistory('reader-c', { workflow: 'book' });
  assert.ok(byWorkflow.every((e) => e.workflow === 'book'), 'workflow filter keeps only matches');
});

test('listHistory does not leak another owner history when accounts scope it', async () => {
  await recordInvestigation({ owner: 'owner-one', workflow: 'claim', result: verdictFor('A private claim about reservoirs rising.', 'Supported') });
  const mine = await listHistory('owner-two');
  assert.ok(!mine.some((e) => /reservoirs rising/.test(e.text)), 'other owner standalone claims stay private');
});

test('batch route runs a pasted block in order and history route finds it again', async () => {
  const { POST: batchPost } = await import('../app/api/verify/batch/route.js');
  const { GET: historyGet } = await import('../app/api/history/route.js');
  const req = new Request('http://x/api/verify/batch', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'Water boils at 100 degrees Celsius at sea level.\nHumans only use 10% of their brains.' }),
  });
  const res = await batchPost(req);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.results.length, 2);
  assert.deepEqual(body.results.map((r) => r.text), [
    'Water boils at 100 degrees Celsius at sea level.',
    'Humans only use 10% of their brains.',
  ]);
  assert.ok(body.results.every((r) => r.ok && r.claimId), 'each finished claim carries its history id');

  const histRes = await historyGet(new Request('http://x/api/history?query=brains&workflow=claim'));
  assert.equal(histRes.status, 200);
  const hist = await histRes.json();
  assert.ok(hist.entries.some((e) => /brains/.test(e.text)), 'history route returns the batch claim');
  assert.ok(hist.entries.every((e) => e.workflow === 'claim'), 'workflow filter holds on the route');
});

test('batch route names the claims it dropped past the batch limit', async () => {
  const { POST: batchPost } = await import('../app/api/verify/batch/route.js');
  const many = Array.from({ length: MAX_BATCH_CLAIMS + 3 }, (_, i) => `Dropped probe claim number ${i + 1} is stated here.`);
  const res = await batchPost(new Request('http://x/api/verify/batch', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: many.join('\n') }),
  }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.results.length, MAX_BATCH_CLAIMS);
  assert.deepEqual(body.dropped, many.slice(MAX_BATCH_CLAIMS), 'claims past the limit are named, not silently lost');
  assert.equal(body.limit, MAX_BATCH_CLAIMS);
});

test('batch route rejects an empty batch with a plain message', async () => {
  const { POST: batchPost } = await import('../app/api/verify/batch/route.js');
  const res = await batchPost(new Request('http://x/api/verify/batch', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '  \n\n' }),
  }));
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /claim/i);
});

test('listHistory deduplicates similar results and counts the repeats', async () => {
  await recordInvestigation({ owner: 'reader-dedupe', workflow: 'claim', result: verdictFor('The valley reservoir released 40 million litres of water in June.', 'Supported') });
  await recordInvestigation({ owner: 'reader-dedupe', workflow: 'claim', result: verdictFor('The valley reservoir released 40 million litres of water in June today.', 'Supported') });
  await recordInvestigation({ owner: 'reader-dedupe', workflow: 'claim', result: verdictFor('The valley reservoir released 40 million litres of water in June across the whole valley.', 'Supported') });
  await recordInvestigation({ owner: 'reader-dedupe', workflow: 'claim', result: verdictFor('Humans only use 10% of their brains.', 'Contradicted') });
  await recordInvestigation({ owner: 'reader-dedupe', workflow: 'claim', result: verdictFor('The valley reservoir released 90 million litres of water in June.', 'Contradicted') });

  const entries = await listHistory('reader-dedupe');
  const boils100 = entries.filter((e) => /released 40 million/.test(e.text));
  assert.equal(boils100.length, 1, `similar reservoir claims collapse to one row, got ${boils100.map((e) => e.text)}`);
  assert.equal(boils100[0].duplicateCount, 3, 'newest row counts the similar repeats');
  assert.equal(boils100[0].duplicates.length, 2, 'repeats stay inspectable on the row');
  assert.ok(entries.some((e) => /brains/.test(e.text)), 'distinct claim stays');
  assert.ok(entries.some((e) => /released 90 million/.test(e.text)), 'a different number is a different claim, not a duplicate');

  await recordInvestigation({ owner: 'reader-dedupe', workflow: 'question', result: verdictFor('The valley reservoir released 40 million litres of water in June.', 'Supported') });
  const split = await listHistory('reader-dedupe');
  assert.ok(split.some((e) => e.workflow === 'claim' && /released 40 million/.test(e.text)), 'standalone row survives');
  assert.ok(split.some((e) => e.workflow === 'question' && /released 40 million/.test(e.text)), 'same words in another workflow stay a separate result');
});

test('verifyClaimBatch honors an already-aborted signal and launches nothing', async () => {
  let calls = 0;
  const controller = new AbortController();
  controller.abort();
  const out = await verifyClaimBatch(['Alpha reservoir levels rose sharply during June.'], {
    owner: 'reader-batch-abort',
    signal: controller.signal,
    verifyOne: async (text) => { calls++; return verdictFor(text, 'Supported'); },
  });
  assert.equal(calls, 0, 'aborted batch launches no investigations');
  assert.equal(out.length, 0, 'aborted batch returns no results');
});

test('verifyClaimBatch degrades a slow claim to Unverifiable without stalling the batch', async () => {
  const out = await verifyClaimBatch(
    ['Fast reservoir claim passes quickly here.', 'Slow reservoir claim stalls far too long here.'],
    {
      owner: 'reader-batch-timeout',
      timeoutMs: 30,
      verifyOne: async (text) => {
        if (/Slow/.test(text)) await new Promise((r) => setTimeout(r, 500));
        return verdictFor(text, 'Supported');
      },
    },
  );
  assert.equal(out[0].ok, true);
  assert.equal(out[0].result.verdict, 'Supported');
  assert.equal(out[1].ok, true, 'timeout still yields a result slot');
  assert.equal(out[1].result.verdict, 'Unverifiable', JSON.stringify(out[1].result));
});

test('verifyClaimBatch keeps typed order, isolates one failure, and records the rest', async () => {
  const seen = [];
  const out = await verifyClaimBatch(
    ['Alpha reservoir levels rose sharply during June.', 'This middle claim breaks during checking.', 'Bananas ripen faster in warm rooms than in cold stores.'],
    {
      owner: 'reader-batch',
      verifyOne: async (text) => {
        seen.push(text);
        if (/breaks/.test(text)) throw new Error('research exploded');
        return verdictFor(text, 'Supported');
      },
    },
  );
  assert.deepEqual(out.map((r) => r.text), ['Alpha reservoir levels rose sharply during June.', 'This middle claim breaks during checking.', 'Bananas ripen faster in warm rooms than in cold stores.'], 'results stay in typed order');
  assert.equal(out[0].ok, true);
  assert.equal(out[1].ok, false);
  assert.match(out[1].error, /exploded/);
  assert.equal(out[2].ok, true);
  assert.ok(out[0].claimId && out[2].claimId, 'finished claims carry history ids');

  const entries = await listHistory('reader-batch');
  assert.ok(entries.some((e) => /Alpha reservoir/.test(e.text)), 'first verdict was recorded');
  assert.ok(entries.some((e) => /Bananas ripen/.test(e.text)), 'third verdict was recorded');
  assert.ok(!entries.some((e) => /middle claim/.test(e.text)), 'failed claim was not recorded as a verdict');
});

test('a deleted demo book is not seeded back on the next listing', async () => {
  const seeded = await seedDemo();
  const demo = seeded.find((d) => d.title === 'The Mind, Examined — demo book');
  assert.ok(demo, 'first listing seeds the demo book');
  await deleteDocument(demo.id);
  const after = await seedDemo();
  assert.ok(!after.some((d) => d.title === 'The Mind, Examined — demo book'), 'the deleted demo book stays deleted');
});

test('verify route replay keeps the honest demo label instead of claiming live', async () => {
  const { POST: verifyPost } = await import('../app/api/verify/route.js');
  const text = 'Replay keeps its honest demo mode label here.';
  const key = `replay-mode-${Date.now()}-${Math.random()}`;
  const makeReq = () => new Request('http://x/api/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify({ claim: text }),
  });
  const first = await verifyPost(makeReq());
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.mode, 'demo', 'fresh demo verdict is labelled demo');
  const second = await verifyPost(makeReq());
  assert.equal(second.status, 200);
  const secondBody = await second.json();
  assert.equal(secondBody.mode, 'demo', `replay keeps the demo label, got ${secondBody.mode}`);
  assert.equal(secondBody.historyClaimId, firstBody.historyClaimId, 'replay returns the same stored record');
});

test('verifyClaimBatch timeout verdict carries the classified claim type', async () => {
  const { classifyClaim } = await import('../lib/claims.mjs');
  const slow = 'Slow reservoir claim stalls far too long here.';
  const out = await verifyClaimBatch([slow], {
    owner: 'reader-batch-type',
    timeoutMs: 30,
    verifyOne: async (text) => { await new Promise((r) => setTimeout(r, 500)); return verdictFor(text, 'Supported'); },
  });
  assert.equal(out[0].ok, true, 'timeout still yields a result slot');
  assert.equal(out[0].result.verdict, 'Unverifiable');
  assert.equal(out[0].result.type, classifyClaim(slow), `timeout type is classified, got ${out[0].result.type}`);
});
