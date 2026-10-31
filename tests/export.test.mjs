import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInvestigationReport } from '../lib/export.mjs';

const RECORD = {
  text: 'Humans only use 10% of their brains.',
  verdict: 'Contradicted',
  type: 'Scientific',
  judgedBy: 'Muse Wonder',
  mode: 'live',
  explanation: 'Fetched passages contradict it.',
  supporting: [],
  contradicting: [{ id: 'e1', title: 'Brain scans', source: 'a.example', date: '2020-01-01', url: 'https://a.example/brain', passage: 'Activity throughout the brain.' }],
  limitations: ['Verdict rests only on the fetched passages cited here.'],
  stability: { runs: 3, verdicts: ['Contradicted', 'Contradicted', 'Contradicted'], agreed: true, majority: 'Contradicted' },
  trajectory: ['triage', 'research', 'judge', 'gates', 'challenge', 'assemble'],
};

test('report names the claim, verdict, passage and its URL, and the limits', () => {
  const md = buildInvestigationReport(RECORD, { now: new Date('2026-10-31T00:00:00Z') });
  assert.match(md, /Humans only use 10% of their brains\./);
  assert.match(md, /Contradicted/);
  assert.match(md, /Activity throughout the brain\./);
  assert.match(md, /https:\/\/a\.example\/brain/);
  assert.match(md, /Verdict rests only on the fetched passages/);
  assert.match(md, /Muse Wonder/);
  assert.match(md, /2026-10-31/);
});

test('report shows stability runs and agreement when present', () => {
  const md = buildInvestigationReport(RECORD, { now: new Date('2026-10-31T00:00:00Z') });
  assert.match(md, /3 runs/);
  assert.match(md, /agreed/i);
});

test('report never invents a confidence percentage', () => {
  const md = buildInvestigationReport(RECORD, { now: new Date('2026-10-31T00:00:00Z') });
  assert.ok(!/\b\d{1,3}\s*%\s*confiden/i.test(md), 'no confidence percentage may appear');
  assert.ok(!/truth score/i.test(md), 'no truth score may appear');
});

test('unverifiable report exports with no passages and still states limits', () => {
  const md = buildInvestigationReport({ text: 'An obscure claim.', verdict: 'Unverifiable', type: 'Scientific', judgedBy: 'Muse Spark 1.3', mode: 'live', explanation: 'Nothing fetched touched it.', supporting: [], contradicting: [], limitations: ['No fetched passage passed relevance checks.'] }, { now: new Date('2026-10-31T00:00:00Z') });
  assert.match(md, /Unverifiable/);
  assert.match(md, /No fetched passage passed/);
});

test('report labels the export date and never stamps a prompt version the record lacks', () => {
  const md = buildInvestigationReport({ text: 'A claim.', verdict: 'Supported', judgedBy: 'Muse Spark 1.3', mode: 'demo', explanation: 'e', supporting: [], contradicting: [], limitations: ['l'] }, { now: new Date('2026-10-31T00:00:00Z') });
  assert.match(md, /Exported: 2026-10-31/);
  assert.ok(!/Run date/.test(md), 'export date must not be called the run date');
  assert.ok(!/Prompt version/.test(md), 'no prompt version may be printed for a record that does not carry one');
});

test('report prints the prompt version the record carries', () => {
  const md = buildInvestigationReport({ ...RECORD, promptVersion: '2026-10-31' }, { now: new Date('2026-10-31T00:00:00Z') });
  assert.match(md, /Prompt version: 2026-10-31/);
});

test('single-run stability never claims the runs disagreed', () => {
  const md = buildInvestigationReport({ ...RECORD, stability: { runs: 1, verdicts: ['Contradicted'], agreed: false, majority: 'Contradicted' } }, { now: new Date('2026-10-31T00:00:00Z') });
  assert.match(md, /No repeat run/);
  assert.ok(!/runs disagreed/.test(md), 'one run cannot disagree with itself');
});
