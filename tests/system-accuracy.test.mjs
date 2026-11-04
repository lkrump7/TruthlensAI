import { test } from 'node:test';
import assert from 'node:assert/strict';
import { researchClaim } from '../lib/research.mjs';
import { researchStage } from '../lib/stages.mjs';
import { splitAtomicClaims } from '../lib/claims.mjs';

// General robustness: a search outage must propagate so the pipeline marks
// live-failed (never a live verdict), for any claim type.
test('researchClaim propagates search failure for live-failed handling', async () => {
  const search = async () => { throw new Error('provider down'); };
  const fetchText = async () => { throw new Error('must not fetch when search failed'); };
  await assert.rejects(
    researchClaim('Water boils at 100 degrees Celsius at sea level.', { search, fetchText, cache: false }),
    /provider down/,
  );
});

test('researchStage propagates search failure for live-failed handling', async () => {
  const search = async () => { throw new Error('provider down'); };
  await assert.rejects(
    researchStage('Water boils at 100 degrees Celsius at sea level.', 'Scientific', { search, cache: false }),
    /provider down/,
  );
});

test('live failure hides raw internals and marks live-failed for any claim', async () => {
  const { liveFailedResult } = await import('../lib/errors.mjs');
  const out = liveFailedResult('Apollo 11 landed on the Moon in 1969.', new Error('raw-backend-detail-xyz'), { type: 'Historical' });
  assert.equal(out.verdict, 'Unverifiable');
  assert.equal(out.mode, 'live-failed');
  assert.ok(!JSON.stringify(out).includes('raw-backend-detail-xyz'));
});

// General decomposition: multi-sentence input must split into one atomic per sentence
// for any topic, so each part gets its own research and rollup stays honest.
test('splitAtomicClaims splits unrelated sentences into separate atomics', () => {
  const out = splitAtomicClaims('Apollo 11 landed on the Moon in 1969. Water boils at 100 degrees Celsius at sea level.');
  assert.equal(out.length, 2);
  assert.match(out[0], /Apollo 11/);
  assert.match(out[1], /Water boils/);
});

// General calibration: one-sided support must not force abstention for any claim.
// True claims often have only supporting passages; thin or off-topic is the bar.
test('judge prompt does not list one-sided evidence as abstention trigger', async () => {
  const { JUDGE_SYSTEM } = await import('../lib/prompts.mjs');
  assert.doesNotMatch(JUDGE_SYSTEM, /one-sided/);
  assert.match(JUDGE_SYSTEM, /Unverifiable when/i);
});

// General typing: science detector must fire for varied science wording,
// not one example. Used for routing and reporting across all questions.
test('classifyClaim marks varied science claims as Scientific', async () => {
  const { classifyClaim } = await import('../lib/claims.mjs');
  assert.equal(classifyClaim('Photosynthesis converts carbon dioxide and water into glucose using sunlight.'), 'Scientific');
  assert.equal(classifyClaim('Plant cells store chemical energy in glucose.'), 'Scientific');
  assert.equal(classifyClaim('Vaccines reduce disease in treated populations.'), 'Scientific');
});

// General metrics: score any verdict list the same way for different people and questions.
test('accuracy metrics score verdicts, citations, and coverage for any claim set', async () => {
  const { verdictAccuracy, citationValidity, evidenceCoverage } = await import('../lib/metrics.mjs');
  const results = [
    { verdict: 'Supported', supporting: [{ id: 'a', passage: 'p', url: 'https://x.example' }], contradicting: [], unclassified: [], allEvidence: [{ id: 'a' }] },
    { verdict: 'Unverifiable', supporting: [], contradicting: [], unclassified: [], allEvidence: [] },
  ];
  assert.equal(verdictAccuracy([{ verdict: 'Supported' }], [['Supported']]), 1);
  assert.equal(verdictAccuracy(results, [['Supported'], ['Unverifiable']]), 1);
  assert.equal(citationValidity(results[0]), true);
  assert.equal(citationValidity({ verdict: 'Supported', supporting: [], contradicting: [], unclassified: [], allEvidence: [] }), false);
  const cov = evidenceCoverage(results[0]);
  assert.equal(cov.cited, 1);
});

// General reporting: fetch failures stay named per URL for any claim,
// while search outages propagate to live-failed (covered above).
test('researchStage names fetch failures per URL', async () => {
  const { researchStage: stage } = await import('../lib/stages.mjs');
  const search = async () => ({ queries: ['q'], sources: [{ title: 'A', url: 'https://a.example/x' }], citations: [] });
  const fetchText = async () => { throw new Error('boom-404'); };
  const out = await stage('Water boils at 100 degrees Celsius at sea level.', 'Scientific', { search, fetchText, cache: false });
  assert.equal(out.final?.verdict, 'Unverifiable');
  assert.ok((out.final?.limitations || []).some((l) => /a\.example/i.test(l)));
});
