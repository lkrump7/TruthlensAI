import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reciprocalRankFusion, dedupeNearDuplicates } from '../lib/rank.mjs';
import { researchClaim } from '../lib/research.mjs';

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
