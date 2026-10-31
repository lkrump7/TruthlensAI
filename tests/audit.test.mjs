import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReport } from '../lib/report.mjs';
import { assembleStage } from '../lib/stages.mjs';

test('coverage counts every claim that received a verdict, including Unverifiable', () => {
  const claims = [
    { id: 'c1', text: 'A', verdict: 'Supported', status: 'verified' },
    { id: 'c2', text: 'B', verdict: 'Unverifiable', status: 'verified' },
    { id: 'c3', text: 'C', status: 'unverified' },
  ];
  const r = buildReport(claims);
  assert.equal(r.investigated, 2, 'an Unverifiable verdict is still an investigation (PRINCIPLES 12)');
  assert.equal(r.evidenceCoverage, 67);
});

const assembleWithEnv = (value) => {
  const prev = process.env.TRUTHLENS_CONFORMAL_Q;
  if (value === undefined) delete process.env.TRUTHLENS_CONFORMAL_Q; else process.env.TRUTHLENS_CONFORMAL_Q = value;
  try {
    return assembleStage('Water boils at 100 degrees Celsius at sea level.', {
      type: 'Scientific',
      gated: { verdict: 'Supported', supporting: [], contradicting: [], unclassified: [], limitations: [] },
      result: { explanation: 'x' }, judgedBy: 'Muse Spark 1.3', cited: [], stats: {},
    });
  } finally {
    if (prev === undefined) delete process.env.TRUTHLENS_CONFORMAL_Q; else process.env.TRUTHLENS_CONFORMAL_Q = prev;
  }
};

test('a garbage conformal threshold is no threshold: not set, no advice', () => {
  const out = assembleWithEnv('garbage');
  assert.equal(out.calibration.thresholdSet, false);
  assert.equal(out.calibration.abstainAdvised, false);
});

test('a fitted conformal threshold is reported as set', () => {
  const out = assembleWithEnv('0.5');
  assert.equal(out.calibration.thresholdSet, true);
});

test('no conformal env means no threshold and no advice', () => {
  const out = assembleWithEnv(undefined);
  assert.equal(out.calibration.thresholdSet, false);
  assert.equal(out.calibration.abstainAdvised, false);
});
