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
  assert.deepEqual(r.trajectory, ['triage', 'research', 'judge', 'gates', 'challenge', 'assemble']);
  assert.ok(r.uncertainty);
  assert.equal(r.mode, 'live');
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
  assert.deepEqual(r.trajectory, ['triage', 'research']);
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
