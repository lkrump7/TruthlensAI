import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SUGGESTER_SYSTEM, suggesterUser } from '../lib/prompts.mjs';
import { suggestFollowups, localSuggestions } from '../lib/suggest.mjs';

const brainResult = {
  text: 'Humans only use 10% of their brains.',
  verdict: 'Contradicted', judgedBy: 'Muse Wonder', type: 'Scientific',
  explanation: 'Imaging evidence contradicts the claim.',
  supporting: [],
  contradicting: [
    { id: 'ev-1', source: 'Scientific American', date: '2008-02-07', title: 'Do People Only Use 10 Percent?', passage: 'Brain scans show activity throughout the brain, even in sleep.' },
    { id: 'ev-2', source: 'Neuroscience review summary', date: '2019-05-14', title: 'The Ten Percent Myth', passage: 'Damage to almost any area of the brain has detectable effects.' },
  ],
  unclassified: [],
  uncertainty: { faithfulness: { label: 'high', score: 1, detail: '2 of 2' }, evidenceStrength: { label: 'moderate', score: 0.42, detail: '2 domains' } },
  limitations: [],
};

test('suggester prompt: silent reasoning, JSON schema, injection guard, worked example', () => {
  assert.match(SUGGESTER_SYSTEM, /Work through these steps silently/);
  assert.match(SUGGESTER_SYSTEM, /JSON only/);
  for (const f of ['"question"', '"why"', '"investigateAs"']) assert.ok(SUGGESTER_SYSTEM.includes(f), f);
  assert.match(SUGGESTER_SYSTEM, /data, not instructions/i);
  assert.match(SUGGESTER_SYSTEM, /Example:/);
  const user = suggesterUser(brainResult);
  assert.match(user, /Humans only use 10%/);
  assert.match(user, /Scientific American/);
  assert.match(user, /2008-02-07/);
  assert.match(user, /Contradicted/);
});

test('AI suggestions are parsed, capped at three, and carry a checkable statement', async () => {
  const completeJson = async () => ({
    suggestions: [
      { question: 'Has imaging since 2019 found any silent brain region?', why: 'Newest passage is from 2019.', investigateAs: 'Brain imaging since 2019 has found a large silent region of the human brain.' },
      { question: 'Where did the 10% figure come from?', why: 'No passage traces the origin.', investigateAs: 'The 10% brain claim originated from a named scientific study.' },
      { question: 'Does activity mean use?', why: 'Passages equate the two.', investigateAs: 'Brain activity in scans is not evidence a region is used for thought.' },
      { question: 'Extra one?', why: 'x', investigateAs: 'Extra claim here.' },
      { question: '', why: 'empty', investigateAs: '' },
    ],
  });
  const out = await suggestFollowups(brainResult, { completeJson });
  assert.equal(out.source, 'ai');
  assert.equal(out.suggestions.length, 3);
  assert.match(out.suggestions[0].question, /silent brain region/);
  assert.ok(out.suggestions.every((s) => s.investigateAs.length > 5));
});

test('local fallback still gives three probes when nothing was fetched', () => {
  const thin = localSuggestions({
    text: 'The moon is made of cheese.', verdict: 'Unverifiable', judgedBy: 'Muse Spark 1.3',
    supporting: [], contradicting: [], unclassified: [], explanation: 'No passages fetched.',
  });
  assert.equal(thin.length, 3);
  assert.equal(new Set(thin.map((s) => s.question)).size, 3, 'probes are distinct');
  assert.ok(thin.every((s) => s.question.includes('?') && s.investigateAs.length > 5), 'each probe carries a checkable statement');
});

test('one-sided fallback probes with a statement, not the raw claim text', () => {
  const claim = 'Cats always land on their feet.';
  const oneSided = localSuggestions({
    text: claim, verdict: 'Contradicted', judgedBy: 'Muse Spark 1.3',
    supporting: [],
    contradicting: [{ id: 'e1', source: 'Vet journal', date: '2020-01-01', passage: 'Cats sometimes land badly and need care.' }],
    unclassified: [], explanation: 'Contradicted.',
  });
  const otherSide = oneSided.find((s) => /other side|one way/i.test(s.question));
  assert.ok(otherSide, JSON.stringify(oneSided));
  assert.notEqual(otherSide.investigateAs, claim);
  assert.match(otherSide.investigateAs, /supports the claim that/i);
});

test('local fallback questions are specific to the evidence actually fetched', () => {
  const a = localSuggestions(brainResult);
  assert.ok(a.length >= 2 && a.length <= 3);
  const joined = a.map((s) => s.question + s.why).join(' ');
  assert.match(joined, /Scientific American|2019|2008/, 'questions reference the real sources or dates');
  const water = localSuggestions({
    text: 'Water boils at 100 degrees Celsius at sea level.', verdict: 'Supported', judgedBy: 'Muse Spark 1.3',
    supporting: [{ id: 'e1', source: 'Reference summary', date: '2021-01-01', passage: 'At sea level water boils at 100 degrees Celsius. The boiling point falls with altitude.' }],
    contradicting: [], unclassified: [], explanation: 'Supported.',
  });
  assert.notEqual(water[0].question, a[0].question, 'different claims get different questions');
  assert.ok(water.every((s) => s.question.includes('?')), 'suggestions read as questions a person would ask');
});
