import { test } from 'node:test';
import assert from 'node:assert/strict';
import { semanticVectors } from '../lib/embed.mjs';
import { researchClaim } from '../lib/research.mjs';

test('semanticVectors posts texts to the sidecar and returns its vectors', async () => {
  let sent;
  const fetchImpl = async (url, opts) => { sent = { url, body: JSON.parse(opts.body) }; return { ok: true, status: 200, json: async () => ({ model: 'all-mpnet-base-v2', dim: 2, vectors: [[1, 0], [0, 1]] }) }; };
  const out = await semanticVectors(['a', 'b'], { sidecarUrl: 'http://sidecar.test', fetchImpl });
  assert.deepEqual(out, [[1, 0], [0, 1]]);
  assert.equal(sent.url, 'http://sidecar.test/embed');
  assert.deepEqual(sent.body.texts, ['a', 'b']);
});

test('semanticVectors is null when no sidecar is configured or it fails', async () => {
  assert.equal(await semanticVectors(['a'], { sidecarUrl: '' }), null);
  assert.equal(await semanticVectors(['a'], { sidecarUrl: 'http://x', fetchImpl: async () => { throw new Error('down'); } }), null);
  assert.equal(await semanticVectors(['a'], { sidecarUrl: 'http://x', fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) }), null);
  assert.equal(await semanticVectors(['a', 'b'], { sidecarUrl: 'http://x', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ vectors: [[1]] }) }) }), null, 'short vector list is malformed, not usable');
});

test('research ranks a synonym passage into the pool when semantic vectors are available', async () => {
  // Six sources: five share claim tokens, one says the same thing with
  // different words. TF-IDF alone scores the synonym passage near zero
  // and the top-5 cut drops it; semantic vectors must save it.
  const pages = {
    'https://s0.example/x': 'Exercise improves memory in older adults, the study reports today.',
    'https://s1.example/x': 'Exercise and memory in older adults improved over the trial period.',
    'https://s2.example/x': 'Older adults who exercise show better memory, researchers found.',
    'https://s3.example/x': 'Memory training and exercise for older adults were compared in the study.',
    'https://s4.example/x': 'Exercise trials in older adults measured memory with word lists.',
    'https://s5.example/x': 'Aerobic training enhanced recall in ageing volunteers over six months.',
  };
  const sources = Object.keys(pages).map((url, i) => ({ title: 'S' + i, url }));
  const search = async () => ({ queries: ['q'], sources, citations: [] });
  const fetchText = async (url) => `<body><p>${pages[url]}</p></body>`;
  // Fake semantic space: the synonym passage sits next to the claim,
  // token-sharing passages sit slightly further away.
  const embedTexts = async (texts) => texts.map((t) => {
    if (t.includes('Aerobic training')) return [0.99, 0.01];
    if (t.startsWith('Exercise improves memory')) return [1, 0];
    return [0.7, 0.3];
  });
  const claim = 'Exercise improves memory in older adults.';
  const withSem = await researchClaim(claim, { search, fetchText, cache: false, embedTexts });
  assert.ok(withSem.evidence.some((e) => /Aerobic training/.test(e.passage)), 'synonym passage must survive the pool cut');
  const without = await researchClaim(claim, { search, fetchText, cache: false, embedTexts: async () => null });
  assert.ok(!without.evidence.some((e) => /Aerobic training/.test(e.passage)), 'control: TF-IDF alone drops it');
});
