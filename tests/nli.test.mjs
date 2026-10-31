import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyStances } from '../lib/nli.mjs';
import { verifyResearchedClaim, parseSearchResponse } from '../lib/research.mjs';

test('classifyStances posts pairs and returns aligned labels', async () => {
  let sent;
  const fetchImpl = async (url, opts) => { sent = { url, body: JSON.parse(opts.body) }; return { ok: true, status: 200, json: async () => ({ model: 'nli-test', results: [{ label: 'entailment', score: 0.91 }, { label: 'contradiction', score: 0.87 }] }) }; };
  const out = await classifyStances([['passage one', 'claim one'], ['passage two', 'claim two']], { sidecarUrl: 'http://sidecar.test', fetchImpl });
  assert.equal(out[0].label, 'entailment');
  assert.equal(out[1].label, 'contradiction');
  assert.equal(sent.url, 'http://sidecar.test/nli');
  assert.deepEqual(sent.body.pairs, [['passage one', 'claim one'], ['passage two', 'claim two']]);
});

test('classifyStances is null without a sidecar, on failure, or on misalignment', async () => {
  assert.equal(await classifyStances([['p', 'h']], { sidecarUrl: '' }), null);
  assert.equal(await classifyStances([['p', 'h']], { sidecarUrl: 'http://x', fetchImpl: async () => { throw new Error('down'); } }), null);
  assert.equal(await classifyStances([['p', 'h'], ['p2', 'h2']], { sidecarUrl: 'http://x', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ results: [{ label: 'entailment', score: 1 }] }) }) }), null);
  assert.equal(await classifyStances([['p', 'h']], { sidecarUrl: 'http://x', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ results: [{ label: 'maybe', score: 1 }] }) }) }), null, 'unknown labels are not usable');
});

test('pipeline attaches NLI labels to cited evidence and counts judge agreement', async () => {
  const SAMPLE = { output: [{ type: 'web_search_call', action: { query: 'q' }, results: [
    { title: 'A', url: 'https://a.example/brain' }, { title: 'B', url: 'https://b.example/brain' },
  ] }] };
  const search = async () => parseSearchResponse(SAMPLE);
  const fetchText = async (url) => `<body><p>Brain scans show activity throughout the brain every day ${url}, contradicting the ten percent myth about brains and brains imaging.</p></body>`;
  const judge = async ({ evidence }) => ({ verdict: 'Contradicted', citedIds: evidence.map((e) => e.id), stances: Object.fromEntries(evidence.map((e) => [e.id, 'contradicts'])), explanation: 'x' });
  const nli = async (pairs) => pairs.map(() => ({ label: 'contradiction', score: 0.9 }));
  const r = await verifyResearchedClaim('Humans only use 10% of their brains.', { search, fetchText, judge, challenge: null, cache: false, embedTexts: async () => null, rerankTexts: async () => null, nli });
  assert.ok(r.contradicting.length >= 1);
  assert.equal(r.contradicting[0].nli.label, 'contradiction');
  assert.equal(r.nliChecks.checked, r.contradicting.length + r.supporting.length);
  assert.equal(r.nliChecks.agree, r.nliChecks.checked, 'NLI contradiction agrees with the judge contradicting stance');
});
