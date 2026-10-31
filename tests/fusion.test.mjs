import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reciprocalRankFusion, dedupeNearDuplicates } from '../lib/rank.mjs';
import { researchClaim, verifyResearchedClaim, parseSearchResponse } from '../lib/research.mjs';
import { rollupCompound } from '../lib/pipeline.mjs';

test('reciprocal rank fusion rewards items ranked well by several lists', () => {
  const scores = reciprocalRankFusion([
    ['a', 'b', 'c'],
    ['b', 'a', 'd'],
  ]);
  // a and b swap 1st/2nd across lists: equal fused scores. c and d
  // each appear once at rank 3: also equal, and below a/b.
  assert.equal(scores.get('a'), scores.get('b'));
  assert.equal(scores.get('c'), scores.get('d'));
  assert.ok(scores.get('a') > scores.get('d'));
});

const sub = (verdict) => ({ text: verdict, verdict, judgedBy: 'Muse Spark 1.3', supporting: [], contradicting: [], unclassified: [] });

test('roll-up: a supported element plus a not fact-checkable element is Partially, never decisive (TL-004)', () => {
  assert.equal(rollupCompound('compound', [sub('Supported'), sub('Not fact-checkable')]).verdict, 'Partially supported');
});

test('roll-up: not fact-checkable alone is Unverifiable (TL-004)', () => {
  assert.equal(rollupCompound('compound', [sub('Not fact-checkable')]).verdict, 'Unverifiable');
});

test('roll-up: agreeing supported elements stay Supported (TL-004)', () => {
  assert.equal(rollupCompound('compound', [sub('Supported'), sub('Supported')]).verdict, 'Supported');
});

test('roll-up: supported plus contradicted is Partially supported (TL-004)', () => {
  assert.equal(rollupCompound('compound', [sub('Supported'), sub('Contradicted')]).verdict, 'Partially supported');
});

test('roll-up: explanation counts unverifiable and not fact-checkable apart (TL-004)', () => {
  const r = rollupCompound('compound', [sub('Supported'), sub('Unverifiable'), sub('Not fact-checkable')]);
  assert.equal(r.verdict, 'Partially supported');
  assert.match(r.explanation, /1 unverifiable/);
  assert.match(r.explanation, /1 not fact-checkable/);
});

test('compound claim with an opinion element does not roll up decisive (TL-004)', async () => {
  const sample = { output: [{ type: 'web_search_call', action: { type: 'search', query: 'brain myth' }, results: [{ type: 'text_result', title: 'A', url: 'https://a.example/brain', snippet: '' }, { type: 'text_result', title: 'B', url: 'https://b.example/x', snippet: '' }] }, { type: 'message', content: [{ type: 'output_text', text: 'x', annotations: [] }] }] };
  const search = async () => parseSearchResponse(sample);
  const fetchText = async (url) => url.includes('b.example')
    ? '<body><p>Neuroscience mapping of brains shows activity across the whole brain daily; the ten percent myth about brains fails.</p></body>'
    : '<body><p>Brain scans show activity throughout the brain every day, contradicting the ten percent myth about brains.</p></body>';
  const judge = async ({ evidence }) => ({ verdict: 'Supported', citedIds: evidence.map((e) => e.id), stances: Object.fromEntries(evidence.map((e) => [e.id, 'supports'])), explanation: 'Yes.' });
  const r = await verifyResearchedClaim('Humans only use 10% of their brains; I think this is the best ever written.', { search, fetchText, judge, cache: false });
  assert.deepEqual(r.subclaims.map((s) => s.verdict), ['Supported', 'Not fact-checkable']);
  assert.equal(r.verdict, 'Partially supported');
});

test('dedupeNearDuplicates keeps the first of two near-identical passages', () => {
  const items = [
    { id: 'e1', passage: 'Brain scans show activity throughout the brain every day.' },
    { id: 'e2', passage: 'Brain scans show activity throughout the brain every single day.' },
    { id: 'e3', passage: 'The reservoir reduced flooding deaths across the valley.' },
  ];
  const kept = dedupeNearDuplicates(items);
  assert.deepEqual(kept.map((e) => e.id), ['e1', 'e3']);
});

test('research drops near-duplicate passages repeated across sources', async () => {
  const dup = 'Brain scans show activity throughout the brain every day, contradicting the ten percent myth about brains.';
  const pages = {
    'https://a.example/x': dup,
    'https://b.example/x': dup.replace('every day', 'every single day'),
    'https://c.example/x': 'Neuroscientists call the ten percent brain story a myth with no basis in scanning studies of brains.',
  };
  const sources = Object.keys(pages).map((url, i) => ({ title: 'S' + i, url }));
  const search = async () => ({ queries: ['q'], sources, citations: [] });
  const fetchText = async (url) => `<body><p>${pages[url]}</p></body>`;
  const r = await researchClaim('Humans only use 10% of their brains.', { search, fetchText, cache: false, embedTexts: async () => null, rerankTexts: async () => null });
  const scans = r.evidence.filter((e) => /Brain scans show activity/.test(e.passage));
  assert.equal(scans.length, 1, 'the same finding from two pages is one piece of evidence, not two');
});
