import { test } from 'node:test';
import assert from 'node:assert/strict';
import { challengeStage } from '../lib/stages.mjs';

const cited = [{ id: 'ev-1', passage: 'Water boils at 100C at sea level.', source: 'example.com' }];
const currentOf = () => ({
  cited: [...cited],
  gated: { verdict: 'Supported', supporting: [...cited], contradicting: [], unclassified: [], limitations: [] },
  result: { verdict: 'Supported', citedIds: ['ev-1'], explanation: 'ok' },
});

test('a throwing revision judge keeps the pre-challenge verdict instead of failing', async () => {
  const out = await challengeStage('Water boils at 100C.', currentOf(), cited, {
    challenge: async () => ({ material: true, points: ['check this'] }),
    judge: async () => { throw new Error('revision judge down'); },
    nli: null,
  });
  assert.equal(out.gated.verdict, 'Supported');
  assert.equal(out.challenge, undefined);
});

test('a successful revision still replaces the verdict', async () => {
  const out = await challengeStage('Water boils at 100C.', currentOf(), cited, {
    challenge: async () => ({ material: true, points: ['check this'] }),
    judge: async () => ({ verdict: 'Partially supported', citedIds: ['ev-1'], explanation: 'revised' }),
    nli: null,
  });
  assert.equal(out.gated.verdict, 'Partially supported');
  assert.equal(out.preChallengeVerdict, 'Supported');
});
