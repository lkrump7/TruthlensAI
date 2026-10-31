import { test } from 'node:test';
import assert from 'node:assert/strict';
import { investigateEvidenceChain } from '../lib/forensics.mjs';

const ev = (over) => [{ id: 'e1', title: 'Study', source: 'example.org', url: 'https://example.org/s', date: '2020-01-01', passage: '', stance: 'supports', ...over }];

test('flags an inflated effect when the passage reports a smaller number', () => {
  const r = investigateEvidenceChain('A study proved Supplement X increases intelligence by 40%.', ev({ passage: 'In the trial, Supplement X increased test scores by 4% compared with placebo in 60 adults.' }));
  assert.ok(r.discrepancies.some((d) => d.type === 'effect-mismatch'));
});

test('flags animal evidence behind a human claim', () => {
  const r = investigateEvidenceChain('A study proved Supplement X increases intelligence in adults.', ev({ passage: 'In mice, Supplement X improved maze performance after four weeks of treatment.' }));
  assert.ok(r.discrepancies.some((d) => d.type === 'population-mismatch'));
});

test('flags commentary presented as a primary study', () => {
  const r = investigateEvidenceChain('A scientific study proved that coffee prevents dementia in adults.', ev({ title: 'A review of coffee research', passage: 'This review discusses observational findings on coffee and dementia risk in adults.' }));
  assert.ok(r.discrepancies.some((d) => d.type === 'secondary-as-primary'));
});

test('flags negation inside cited evidence and reports hedging, as annotations only', () => {
  const r = investigateEvidenceChain('Exercise improves memory in older adults.', ev({ passage: 'The trial found no significant improvement in memory; exercise did not improve recall in this cohort of 80 adults.' }));
  assert.ok(r.discrepancies.some((d) => d.type === 'negated-evidence'));
  const hedged = investigateEvidenceChain('Exercise improves memory in older adults.', ev({ passage: 'The results suggest exercise may improve memory in some older adults, though effects were modest.' }));
  assert.equal(hedged.checks.find((c) => c.name === 'hedging').status, 'present');
  const clean = investigateEvidenceChain('Exercise improves memory in older adults.', ev({ passage: 'Exercise improved memory in older adults in the trial.' }));
  assert.equal(clean.checks.find((c) => c.name === 'hedging').status, 'absent');
  assert.ok(!clean.discrepancies.some((d) => d.type === 'negated-evidence'));
});

test('a clean claim with matching evidence yields no discrepancies', () => {
  const r = investigateEvidenceChain('Water boils at 100 degrees Celsius at sea level.', ev({ passage: 'At sea level, water boils at 100 degrees Celsius at standard pressure.' }));
  assert.deepEqual(r.discrepancies, []);
  assert.equal(r.checks.find((c) => c.name === 'source-exists').status, 'pass');
});
