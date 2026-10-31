import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summariseStability } from '../lib/stability.mjs';
import { judgeStage, challengeStage } from '../lib/stages.mjs';

test('summariseStability reports agreement when every run matches', () => {
  const s = summariseStability(['Supported', 'Supported', 'Supported']);
  assert.equal(s.runs, 3);
  assert.equal(s.agreed, true);
  assert.equal(s.majority, 'Supported');
});

test('summariseStability reports disagreement and the majority on a split', () => {
  const s = summariseStability(['Contradicted', 'Supported', 'Contradicted']);
  assert.equal(s.runs, 3);
  assert.equal(s.agreed, false);
  assert.equal(s.majority, 'Contradicted');
  assert.deepEqual(s.verdicts, ['Contradicted', 'Supported', 'Contradicted']);
});

test('summariseStability handles a single run without claiming agreement', () => {
  const s = summariseStability(['Supported']);
  assert.equal(s.runs, 1);
  assert.equal(s.agreed, false);
  assert.equal(s.majority, 'Supported');
});

test('judgeStage does not repeat judging for an Unverifiable first verdict (TL-006)', async () => {
  let calls = 0;
  const judge = async () => { calls++; return { verdict: 'Unverifiable', citedIds: [], stances: {}, explanation: 'No call.' }; };
  const out = await judgeStage('Some claim.', [], { judge });
  assert.equal(calls, 1);
  assert.equal(out.result.verdict, 'Unverifiable');
  assert.equal(out.stability.runs, 1);
});

test('judgeStage still repeats judging for a decisive first verdict (TL-006)', async () => {
  let calls = 0;
  const judge = async () => { calls++; return { verdict: 'Supported', citedIds: [], stances: {}, explanation: 'Yes.' }; };
  const out = await judgeStage('Some claim.', [], { judge });
  assert.equal(calls, 3);
  assert.equal(out.stability.runs, 3);
});

test('revision repeats receive the same challenge as the revision (TL-006)', async () => {
  const challenge = { material: true, weakestEvidenceId: 'a', falsifier: 'f', alternative: 'alt', unresolved: 'u' };
  const seen = [];
  const judge = async (args) => {
    seen.push(args);
    return { verdict: 'Contradicted', citedIds: args.evidence.map((e) => e.id), stances: Object.fromEntries(args.evidence.map((e) => [e.id, 'contradicts'])), explanation: 'Revised.' };
  };
  const evidence = [
    { id: 'a', source: 'x.com', passage: 'Passage a.' },
    { id: 'b', source: 'y.edu', passage: 'Passage b.' },
  ];
  const current = {
    cited: [evidence[0]],
    gated: { verdict: 'Supported', supporting: [evidence[0]], contradicting: [], unclassified: [], cited: [evidence[0]], limitations: [] },
    result: { verdict: 'Supported', citedIds: ['a'], explanation: 'First.' },
    judges: undefined,
  };
  const out = await challengeStage('Some claim.', current, evidence, { judge, challenge: async () => challenge, nli: null });
  assert.equal(out.gated.verdict, 'Contradicted');
  assert.equal(seen.length, 3);
  for (const args of seen) assert.deepEqual(args.challenge, challenge);
});
