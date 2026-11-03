import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'tl-bdd-d-'));
process.env.TRUTHLENS_STORE_FILE = join(dir, 'documents.json');
process.env.TRUTHLENS_USERS_FILE = join(dir, 'users.json');
delete process.env.META_MODEL_API_URL;
delete process.env.META_MODEL_API_KEY;
delete process.env.AUTH_ENABLED;

const { givenWhenThen, jsonReq } = await import('./bdd-helper.mjs');
const { POST: verifyPost } = await import('../app/api/verify/route.js');

test('BDD demo trio: the three canonical checks return honest, cited verdicts', async () => {
  await givenWhenThen(
    'a standard reader running the three demo-script checks',
    'each claim is verified',
    'Supported with a passage, Contradicted by two passages, Unverifiable with honesty',
    async () => {
      const check = async (claim) => (await (await verifyPost(jsonReq('http://t/api/verify', { claim }))).json());
      const supported = await check('Water boils at 100 degrees Celsius at sea level.');
      assert.equal(supported.verdict, 'Supported');
      assert.equal(supported.judgedBy, 'Muse Spark 1.3');
      assert.ok(supported.supporting.length >= 1);
      assert.ok(supported.forensics && supported.uncertainty, 'evidence chain and uncertainty ship with the verdict');
      const contradicted = await check('Humans only use 10% of their brains.');
      assert.equal(contradicted.verdict, 'Contradicted');
      assert.equal(contradicted.judgedBy, 'Muse Wonder');
      assert.ok(contradicted.contradicting.length >= 2, 'two independent sources push back');
      const abstained = await check('The village of Upper Snelgrove brewed exactly 41 barrels of ale in March 1731.');
      assert.equal(abstained.verdict, 'Unverifiable');
      assert.equal([...abstained.supporting, ...abstained.contradicting].length, 0, 'no citations invented');
      assert.match(abstained.explanation, /different from the claim being false|not.*false/i);
    },
  );
});

test('BDD other verdicts: misleading and outdated claims are labelled, not forced true/false', async () => {
  await givenWhenThen(
    'claims that are misleading or time-bound',
    'each claim is verified',
    'Misleading and Outdated verdicts with dated passages on both sides',
    async () => {
      const check = async (claim) => (await (await verifyPost(jsonReq('http://t/api/verify', { claim }))).json());
      const misleading = await check('The Great Wall of China is visible from space with the naked eye.');
      assert.equal(misleading.verdict, 'Misleading');
      const outdated = await check('Pluto is a planet.');
      assert.equal(outdated.verdict, 'Outdated');
      assert.ok(outdated.historicalAssessment && outdated.currentAssessment, 'both eras are named');
      assert.ok(outdated.supporting.length >= 1 && outdated.contradicting.length >= 1);
    },
  );
});

test('BDD journalist export: a checked claim downloads with verdict and passage addresses', async () => {
  const { POST: exportPost } = await import('../app/api/export/route.js');
  await givenWhenThen(
    'a verified Contradicted claim in history',
    'the reader exports the investigation',
    'markdown carrying verdict, passage, and source address',
    async () => {
      const res = await verifyPost(jsonReq('http://t/api/verify', { claim: 'Humans only use 10% of their brains.' }));
      const body = await res.json();
      assert.ok(body.historyClaimId && body.historyDocId);
      const exp = await exportPost(jsonReq('http://t/api/export', { docId: body.historyDocId, claimId: body.historyClaimId }));
      assert.equal(exp.status, 200);
      const md = await exp.text();
      assert.ok(md.includes('Contradicted'));
      assert.ok(md.includes('Brain scans show activity throughout the brain'));
      assert.ok(md.includes('Scientific American') || md.includes('scientificamerican.com'));
    },
  );
});

test('BDD repeat checks: running the same claim twice groups into one history entry', async () => {
  const { GET: historyGet } = await import('../app/api/history/route.js');
  await givenWhenThen(
    'a claim checked twice',
    'the reader opens Past checks',
    'one grouped entry recording both runs',
    async () => {
      const text = `Repeat grouping probe ${Date.now()}: water boils at 100 degrees Celsius at sea level.`;
      await verifyPost(jsonReq('http://t/api/verify', { claim: text }));
      await verifyPost(jsonReq('http://t/api/verify', { claim: text }));
      const { entries } = await (await historyGet(new Request('http://t/api/history?limit=1000'))).json();
      const rows = entries.filter((e) => e.text === text);
      assert.equal(rows.length, 1, 'repeats fold into one row');
      assert.equal(rows[0].duplicateCount, 2, 'both runs are counted');
    },
  );
});

test('BDD compound input: a two-part claim is judged on both parts, never as one blob', async () => {
  await givenWhenThen(
    'one sentence joining a true and a false atomic claim',
    'the reader verifies it',
    'a Partially supported verdict citing evidence for each side',
    async () => {
      const body = await (await verifyPost(jsonReq('http://t/api/verify', {
        claim: 'Water boils at 100 degrees Celsius at sea level and humans only use 10% of their brains.',
      }))).json();
      assert.equal(body.verdict, 'Partially supported');
      assert.ok(body.supporting.length >= 1 && body.contradicting.length >= 1);
    },
  );
});
