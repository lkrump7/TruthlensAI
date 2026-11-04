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

// Judge cites only the first fetched passage, like the live 10% run.
const citingJudge = async ({ evidence }) => ({
  verdict: 'Contradicted',
  citedIds: [evidence[0].id],
  stances: { [evidence[0].id]: 'contradicts' },
  explanation: 'First passage contradicts it.',
});

test('verdict keeps every fetched passage as comprehensive citations when the judge cites a subset', async () => {
  const r = await runInvestigationGraph('Humans only use 10% of their brains.', {
    search, fetchText, judge: citingJudge, challenge: null, cache: false, nli: null,
  });
  assert.equal(r.contradicting.length, 1, 'verdict still rests on the cited subset');
  assert.ok(Array.isArray(r.allEvidence), 'verdict carries comprehensive list');
  assert.equal(r.allEvidence.length, 2, 'comprehensive list keeps both fetched passages');
});
