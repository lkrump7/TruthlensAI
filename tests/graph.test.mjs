import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInvestigationGraph } from '../lib/graph.mjs';
import { parseSearchResponse } from '../lib/research.mjs';

const SAMPLE = {
  output: [
    { type: 'web_search_call', action: { query: 'brain myth evidence' }, results: [{ title: 'A', url: 'https://a.example/brain' }, { title: 'B', url: 'https://b.example/brain' }] },
    { type: 'message', content: [{ text: 'See [1]', annotations: [{ type: 'url_citation', url: 'https://a.example/brain', title: 'A', start_index: 0, end_index: 3 }] }] },
  ],
};
const search = async () => parseSearchResponse(SAMPLE);
const fetchText = async (url) => url.includes('b.example')
  ? '<body><p>Neuroscience mapping of brains shows activity across the whole brain daily; the ten percent myth about brains fails.</p></body>'
  : '<body><p>Brain scans show activity throughout the brain every day, contradicting the ten percent myth about brains.</p></body>';
const judge = async ({ evidence }) => ({ verdict: 'Contradicted', citedIds: evidence.map((e) => e.id), stances: Object.fromEntries(evidence.map((e) => [e.id, 'contradicts'])), explanation: 'Fetched passages contradict it.' });

test('investigation graph runs triage, research, judge, gates, challenge, assemble in order', async () => {
  const r = await runInvestigationGraph('Humans only use 10% of their brains.', { search, fetchText, judge, challenge: null, cache: false });
  assert.equal(r.verdict, 'Contradicted');
  assert.deepEqual(r.trajectory, ['triage', 'researchNode', 'judge', 'gates', 'challengeNode', 'assemble']);
  assert.ok(r.uncertainty);
  assert.equal(r.mode, 'live');
});

test('trajectory entries match the registered graph node names', async () => {
  const r = await runInvestigationGraph('Humans only use 10% of their brains.', { search, fetchText, judge, challenge: null, cache: false, _returnGraph: true });
  const nodeNames = Object.keys(r.graph.nodes).filter((n) => n !== '__start__');
  assert.deepEqual(r.trajectory, nodeNames);
});

test('graph short-circuits opinions at triage without researching', async () => {
  let searched = 0;
  const r = await runInvestigationGraph('I think this is the finest book ever written.', { search: async () => { searched++; return search(); }, fetchText, judge, challenge: null });
  assert.equal(r.verdict, 'Not fact-checkable');
  assert.deepEqual(r.trajectory, ['triage']);
  assert.equal(searched, 0);
});

test('graph abstains at the research node when nothing fetchable touches the claim', async () => {
  const emptySearch = async () => ({ queries: [], sources: [], citations: [] });
  const r = await runInvestigationGraph('Humans only use 10% of their brains.', { search: emptySearch, fetchText, judge, challenge: null, cache: false });
  assert.equal(r.verdict, 'Unverifiable');
  assert.deepEqual(r.trajectory, ['triage', 'researchNode']);
});

test('auto-generated threads do not leave checkpoints behind', async () => {
  const { graph, threadId } = await runInvestigationGraph('Humans only use 10% of their brains.', { search, fetchText, judge, challenge: null, cache: false, _returnGraph: true });
  const state = await graph.getState({ configurable: { thread_id: threadId } });
  assert.equal(state.values.verdict, undefined);
  assert.ok(state.checkpoint == null);
});

test('graph state is checkpointed under the caller thread id', async () => {
  const { graph } = await runInvestigationGraph('Humans only use 10% of their brains.', { search, fetchText, judge, challenge: null, cache: false, _returnGraph: true, threadId: 'test-thread-1' });
  const state = await graph.getState({ configurable: { thread_id: 'test-thread-1' } });
  assert.equal(state.values.verdict, 'Contradicted');
  assert.ok(state.values.trajectory.includes('assemble'));
});

test('graph downgrades a decisive verdict when repeated judging flips', async () => {
  let calls = 0;
  const flipping = async ({ evidence }) => {
    calls++;
    const verdict = calls % 2 === 1 ? 'Contradicted' : 'Supported';
    return { verdict, citedIds: evidence.map((e) => e.id), stances: Object.fromEntries(evidence.map((e) => [e.id, verdict === 'Contradicted' ? 'contradicts' : 'supports'])), explanation: 'Flip.' };
  };
  const r = await runInvestigationGraph('Humans only use 10% of their brains.', { search, fetchText, judge: flipping, challenge: null, cache: false });
  assert.ok(r.stability, 'result carries stability');
  assert.equal(r.stability.agreed, false);
  assert.ok(r.stability.runs >= 2, 'judge ran more than once');
  assert.ok(!['Supported', 'Contradicted'].includes(r.verdict), `unstable verdict must not stay decisive, got ${r.verdict}`);
});

test('graph reports progress once per finished node in trajectory order', async () => {
  const seen = [];
  const r = await runInvestigationGraph('Humans only use 10% of their brains.', { search, fetchText, judge, challenge: null, cache: false, onProgress: (stage, detail) => seen.push({ stage, detail }) });
  assert.equal(seen.length, r.trajectory.length);
  assert.deepEqual(seen.map((s) => s.stage), ['triage', 'research', 'judge', 'gates', 'challenge', 'assemble']);
  const research = seen.find((s) => s.stage === 'research');
  assert.ok(research.detail && typeof research.detail.fetched === 'number', 'research progress carries fetched count');
});

test('progress events carry model on every stage and counts on research', async () => {
  const { getModels } = await import('../lib/meta.mjs');
  const models = getModels();
  const seen = [];
  await runInvestigationGraph('Humans only use 10% of their brains.', { search, fetchText, judge, challenge: null, cache: false, onProgress: (stage, detail) => seen.push({ stage, detail }) });
  assert.deepEqual(seen.map((s) => s.stage), ['triage', 'research', 'judge', 'gates', 'challenge', 'assemble']);
  for (const { stage, detail } of seen) {
    assert.equal(typeof detail?.model, 'string', `${stage} progress carries a model`);
    assert.ok(detail.model.length > 0, `${stage} progress model is not empty`);
  }
  const byStage = Object.fromEntries(seen.map((s) => [s.stage, s.detail]));
  assert.equal(byStage.triage.model, models.spark, 'triage sends the spark model name');
  assert.equal(byStage.research.model, models.spark, 'research sends the spark model name');
  assert.ok(byStage.research.counts, 'research progress carries counts');
  assert.equal(typeof byStage.research.counts.fetched, 'number', 'research counts hold fetched');
  assert.equal(typeof byStage.research.counts.sourcesFound, 'number', 'research counts hold sourcesFound');
  assert.equal(byStage.research.counts.fetched, byStage.research.fetched, 'counts match the research stats');
  assert.equal(byStage.judge.judgedBy, 'Muse Wonder', 'judge keeps judgedBy');
  assert.equal(byStage.judge.model, models.wonder, 'judge adds the deciding model');
  assert.equal(byStage.gates.model, models.wonder, 'gates sends the deciding model');
  assert.equal(byStage.challenge.model, models.spark, 'challenge sends the spark model name');
  assert.equal(byStage.assemble.model, models.wonder, 'assemble sends the deciding model');
});

test('a material challenge revision gets its own stability check', async () => {
  const judge = async ({ evidence, model }) => {
    if (model === 'muse-wonder-1.0') return { verdict: 'Contradicted', citedIds: evidence.map((e) => e.id), stances: Object.fromEntries(evidence.map((e) => [e.id, 'contradicts'])), explanation: 'Revised.' };
    return { verdict: 'Supported', citedIds: evidence.map((e) => e.id), stances: Object.fromEntries(evidence.map((e) => [e.id, 'supports'])), explanation: 'First pass.' };
  };
  const challenge = async () => ({ material: true, weakestEvidenceId: 'x', falsifier: 'f', alternative: 'a', unresolved: 'u' });
  const r = await runInvestigationGraph('Humans only use 10% of their brains.', { search, fetchText, judge, challenge, cache: false });
  assert.equal(r.preChallengeVerdict, 'Supported');
  assert.equal(r.verdict, 'Contradicted');
  assert.ok(r.stability, 'revised verdict carries stability');
  assert.deepEqual(r.stability.verdicts, ['Contradicted', 'Contradicted', 'Contradicted'], 'stability describes the revised verdict, not the discarded one');
  assert.equal(r.stability.agreed, true);
});
