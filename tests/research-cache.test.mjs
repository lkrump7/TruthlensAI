import { test } from 'node:test';
import assert from 'node:assert/strict';
import { researchClaim, clearResearchCache } from '../lib/evidence.mjs';

const fakeScreen = async (texts) => texts.map(() => ({ action: 'allow', category: null, matched: null }));

function makeDeps(counter) {
  const search = async () => {
    counter.calls++;
    return { queries: ['q'], sources: [{ url: 'https://example.com/a', title: 'A' }], citations: [] };
  };
  const fetchText = async () => `Water boils at 100 degrees Celsius at sea level. ${'extra sentence. '.repeat(20)}`;
  return {
    search, fetchText, maxSources: 1, maxEvidence: 5,
    embedTexts: null, rerankTexts: null, screenTexts: fakeScreen,
    cacheKey: 'research-cache-poison-probe',
  };
}

test('mutating a cached result does not poison later cache hits', async () => {
  clearResearchCache();
  const counter = { calls: 0 };
  const opts = makeDeps(counter);
  const r1 = await researchClaim('Water boils at 100 C', opts);
  assert.ok(r1.evidence.length >= 1);
  r1.evidence.push({ id: 'ev-injected', passage: 'INJECTED', source: 'evil.com', url: 'https://evil.com', title: 'evil' });
  const r2 = await researchClaim('Water boils at 100 C', opts);
  assert.equal(counter.calls, 1, 'second call must be a cache hit with no new search');
  assert.ok(!r2.evidence.some((e) => e.id === 'ev-injected'), 'injected item leaked from cache');
});

test('mutating a nested cached item does not poison later cache hits', async () => {
  clearResearchCache();
  const counter = { calls: 0 };
  const opts = makeDeps(counter);
  const r1 = await researchClaim('Water boils at 100 C', opts);
  const original = r1.evidence[0].passage;
  r1.evidence[0].passage = 'MUTATED';
  const r2 = await researchClaim('Water boils at 100 C', opts);
  assert.equal(counter.calls, 1, 'second call must be a cache hit with no new search');
  assert.equal(r2.evidence[0].passage, original, 'nested mutation leaked from cache');
});

test('each cache hit returns an independent reference', async () => {
  clearResearchCache();
  const counter = { calls: 0 };
  const opts = makeDeps(counter);
  const r1 = await researchClaim('Water boils at 100 C', opts);
  const r2 = await researchClaim('Water boils at 100 C', opts);
  assert.notEqual(r1, r2);
  assert.notEqual(r1.evidence, r2.evidence);
});
