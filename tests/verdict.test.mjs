import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCorroborationGate, applyOutdatedGate } from '../lib/verdict.mjs';

test('corroboration gate downgrades a decisive verdict backed by one domain', () => {
  const ctx = { verdict: 'Contradicted', supporting: [], contradicting: [{ id: 'a', source: 'x.com' }], cited: [{ id: 'a', source: 'x.com' }], limitations: [] };
  const out = applyCorroborationGate(ctx);
  assert.equal(out.verdict, 'Partially supported');
  assert.ok(out.limitations.some((l) => /single independent source/i.test(l)));
});

test('corroboration gate leaves a two-domain decisive verdict alone', () => {
  const ctx = { verdict: 'Supported', supporting: [{ id: 'a', source: 'x.com' }, { id: 'b', source: 'y.edu' }], contradicting: [], cited: [{ id: 'a', source: 'x.com' }, { id: 'b', source: 'y.edu' }], limitations: [] };
  assert.equal(applyCorroborationGate(ctx).verdict, 'Supported');
});

test('outdated gate fires when newer evidence contradicts older support', () => {
  const ctx = { verdict: 'Partially supported', supporting: [{ id: 'a', date: '2004-01-01' }], contradicting: [{ id: 'b', date: '2006-08-24' }], cited: [], limitations: [] };
  const out = applyOutdatedGate(ctx);
  assert.equal(out.verdict, 'Outdated');
  assert.match(out.historicalAssessment, /Supported/);
  assert.match(out.currentAssessment, /Contradicted/);
});

test('outdated gate never overrides a decisive Contradicted verdict', () => {
  const ctx = { verdict: 'Contradicted', supporting: [{ id: 'a', date: '1969-07-20' }], contradicting: [{ id: 'b', date: '2019-01-01' }], cited: [], limitations: [] };
  assert.equal(applyOutdatedGate(ctx).verdict, 'Contradicted');
});

test('outdated gate does not fire without dates on both sides', () => {
  const ctx = { verdict: 'Partially supported', supporting: [{ id: 'a', date: null }], contradicting: [{ id: 'b', date: '2020-01-01' }], cited: [], limitations: [] };
  assert.equal(applyOutdatedGate(ctx).verdict, 'Partially supported');
});
