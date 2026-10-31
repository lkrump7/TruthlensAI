import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rerankScores } from '../lib/rerank.mjs';
import { researchClaim } from '../lib/research.mjs';

test('rerankScores posts query and passages and returns aligned scores', async () => {
  let sent;
  const fetchImpl = async (url, opts) => { sent = { url, body: JSON.parse(opts.body) }; return { ok: true, status: 200, json: async () => ({ model: 'cross-encoder/ms-marco-MiniLM-L-6-v2', scores: [0.2, 0.9] }) }; };
  const out = await rerankScores('q', ['p1', 'p2'], { sidecarUrl: 'http://sidecar.test', fetchImpl });
  assert.deepEqual(out, [0.2, 0.9]);
  assert.equal(sent.url, 'http://sidecar.test/rerank');
  assert.deepEqual(sent.body.passages, ['p1', 'p2']);
});

test('rerankScores is null without a sidecar, on failure, or on misalignment', async () => {
  assert.equal(await rerankScores('q', ['p'], { sidecarUrl: '' }), null);
  assert.equal(await rerankScores('q', ['p'], { sidecarUrl: 'http://x', fetchImpl: async () => { throw new Error('down'); } }), null);
  assert.equal(await rerankScores('q', ['p1', 'p2'], { sidecarUrl: 'http://x', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ scores: [0.5] }) }) }), null);
});

test('research lets the cross-encoder rescue a passage the lexical ranking would cut', async () => {
  const pages = {
    'https://s0.example/x': 'Exercise improves memory in older adults, the study reports today.',
    'https://s1.example/x': 'Exercise and memory in older adults improved over the trial period.',
    'https://s2.example/x': 'Older adults who exercise show better memory, researchers found.',
    'https://s3.example/x': 'Memory training and exercise for older adults were compared in the study.',
    'https://s4.example/x': 'Exercise trials in older adults measured memory with word lists.',
    'https://s5.example/x': 'Aerobic training enhanced recall in ageing volunteers, improving memory over six months of follow-up sessions, interviews, questionnaires, scheduling notes, dietary logs, sleep diaries, activity records, and administrative paperwork for the regional programme office files.',
    'https://s6.example/x': 'Exercise benefits memory in older adults in every controlled trial published.',
    'https://s7.example/x': 'Controlled trials show exercise improves memory in older adults consistently.',
  };
  const sources = Object.keys(pages).map((url, i) => ({ title: 'S' + i, url }));
  const search = async () => ({ queries: ['q'], sources, citations: [] });
  const fetchText = async (url) => `<body><p>${pages[url]}</p></body>`;
  const claim = 'Exercise improves memory in older adults.';
  // Cross-encoder (fake) judges the synonym passage most relevant.
  const rerankTexts = async (q, texts) => texts.map((t) => (/Aerobic training/.test(t) ? 9.5 : 1.0));
  const withRerank = await researchClaim(claim, { search, fetchText, cache: false, embedTexts: async () => null, rerankTexts });
  const syn = withRerank.evidence.find((e) => /Aerobic training/.test(e.passage));
  assert.ok(syn, 'reranked synonym passage must survive the pool cut');
  assert.equal(syn.rerankScore, 9.5);
  const without = await researchClaim(claim, { search, fetchText, cache: false, embedTexts: async () => null, rerankTexts: async () => null });
  assert.ok(!without.evidence.some((e) => /Aerobic training/.test(e.passage)), 'control: without rerank scores it is cut');
});
