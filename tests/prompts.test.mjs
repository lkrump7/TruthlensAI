import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JUDGE_SYSTEM, judgeUser, CHALLENGER_SYSTEM, challengerUser, STANCE_SYSTEM, stanceUser, OCR_SYSTEM, OCR_INSTRUCTION } from '../lib/prompts.mjs';
import { MetaClient } from '../lib/meta.mjs';

test('judge system prompt: role, silent steps, schema, abstention, injection guard, one worked example', () => {
  assert.match(JUDGE_SYSTEM, /Evidence Judge/);
  // Structured silent reasoning: steps to work through, JSON only out.
  assert.match(JUDGE_SYSTEM, /Work through these steps silently/);
  assert.match(JUDGE_SYSTEM, /JSON only/);
  assert.match(JUDGE_SYSTEM, /"verdict"/);
  assert.match(JUDGE_SYSTEM, /"citedIds"/);
  assert.match(JUDGE_SYSTEM, /"stances"/);
  assert.match(JUDGE_SYSTEM, /"explanation"/);
  for (const v of ['Supported', 'Partially supported', 'Contradicted', 'Misleading', 'Outdated', 'Unverifiable', 'Not fact-checkable']) {
    assert.ok(JUDGE_SYSTEM.includes(v), `verdict ${v} defined for the judge`);
  }
  assert.match(JUDGE_SYSTEM, /Unverifiable when/i, 'abstention is an instructed outcome, not a failure');
  assert.match(JUDGE_SYSTEM, /data, not instructions/i, 'fetched passages must not be able to give orders');
  assert.match(JUDGE_SYSTEM, /Example:/, 'one worked example (few-shot) is present');
  assert.match(JUDGE_SYSTEM, /never cite an id that is not in the evidence/i);
});

test('judge user message carries claim, dated evidence, and the challenge when revising', () => {
  const evidence = [{ id: 'ev-1', passage: 'Brain scans show activity throughout the brain.', date: '2023-05-01' }];
  const plain = judgeUser({ claim: 'Humans only use 10% of their brains.', evidence });
  assert.match(plain, /Claim: Humans only use 10%/);
  assert.match(plain, /\[ev-1\]/);
  assert.match(plain, /2023-05-01/, 'evidence dates reach the judge for Outdated calls');
  assert.doesNotMatch(plain, /Challenge to answer/);

  const revised = judgeUser({ claim: 'Humans only use 10% of their brains.', evidence, challenge: { weakestEvidenceId: 'ev-1', falsifier: 'A scan showing full-brain activity', alternative: 'Activity is not the same as use', unresolved: 'No longitudinal data' } });
  assert.match(revised, /Challenge to answer/);
  assert.match(revised, /A scan showing full-brain activity/);
  assert.match(revised, /ev-1/);
});

test('MetaClient.judge sends the central judge prompts and forwards the challenge', async () => {
  let sent;
  const fetchImpl = async (url, opts) => { sent = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ verdict: 'Supported', citedIds: ['ev1'], stances: { ev1: 'supports' }, explanation: 'fine' }) } }] }) }; };
  const client = new MetaClient({ apiUrl: 'https://example.invalid/chat', apiKey: 'k', spark: 's1', wonder: 'w1', fetchImpl });
  await client.judge({ claim: 'c', evidence: [{ id: 'ev1', passage: 'p' }], model: 's1', challenge: { falsifier: 'F', weakestEvidenceId: 'ev1', alternative: 'A', unresolved: 'U' } });
  assert.equal(sent.messages[0].role, 'system');
  assert.equal(sent.messages[0].content, JUDGE_SYSTEM);
  assert.match(sent.messages[1].content, /Challenge to answer/);
});

test('challenger prompts: materiality bar, falsifier discipline, one worked example', () => {
  assert.match(CHALLENGER_SYSTEM, /Challenger/);
  assert.match(CHALLENGER_SYSTEM, /"material"/);
  assert.match(CHALLENGER_SYSTEM, /"falsifier"/);
  assert.match(CHALLENGER_SYSTEM, /could plausibly change the verdict/i);
  assert.match(CHALLENGER_SYSTEM, /Example:/);
  const user = challengerUser({ claim: 'X causes Y.', verdict: 'Supported', evidence: [{ id: 'ev-1', passage: 'p' }] });
  assert.match(user, /X causes Y\./);
  assert.match(user, /\[ev-1\]/);
});

test('stance prompts: assertion vs mention, quotation is not endorsement, one worked example', () => {
  assert.match(STANCE_SYSTEM, /"stance"/);
  assert.match(STANCE_SYSTEM, /supports\|contradicts\|discusses|supports.*contradicts.*discusses/);
  assert.match(STANCE_SYSTEM, /quot/i, 'quoting a view is not the author holding it');
  assert.match(STANCE_SYSTEM, /Example:/);
  const user = stanceUser({ text: 'The reservoir cut flooding deaths.', passages: [{ page: 3, passage: 'Deaths fell after the reservoir opened.' }] });
  assert.match(user, /Theory: The reservoir cut flooding deaths\./);
  assert.match(user, /\(p3\)/);
});

test('OCR prompts: transcription only, illegible marked, no commentary', () => {
  assert.match(OCR_SYSTEM, /transcri/i);
  assert.match(OCR_INSTRUCTION, /only the transcription/i);
  assert.match(OCR_INSTRUCTION, /\[illegible\]/);
});
