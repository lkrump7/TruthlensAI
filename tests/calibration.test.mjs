import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitConformalThreshold, shouldAbstain, calibrationScore } from '../lib/calibration.mjs';
import { assessUncertainty } from '../lib/uncertainty.mjs';

test('calibrationScore is the conservative minimum of the two signals (internal only)', () => {
  const u = assessUncertainty({ cited: [{ id: 'a', source: 'blog.example', stance: 'supports' }], supporting: [{ id: 'a', source: 'blog.example', stance: 'supports' }], contradicting: [], unclassified: [] });
  assert.equal(calibrationScore(u), Math.min(u.faithfulness.score, u.evidenceStrength.score));
});

test('conformal threshold abstains on most wrong verdicts while keeping most correct ones', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const correct = Array.from({ length: 200 }, () => 0.55 + rnd() * 0.45);
  const wrong = Array.from({ length: 200 }, () => rnd() * 0.6);
  const q = fitConformalThreshold(correct.map((confidence) => ({ confidence, correct: true })), 0.1);
  assert.ok(q > 0 && q < 1);
  const keptCorrect = correct.filter((c) => !shouldAbstain(c, q)).length / correct.length;
  const caughtWrong = wrong.filter((c) => shouldAbstain(c, q)).length / wrong.length;
  assert.ok(keptCorrect >= 0.85, `kept ${keptCorrect}`);
  assert.ok(caughtWrong >= 0.7, `caught ${caughtWrong}`);
});

test('conformal keep-rate meets its coverage target under Monte Carlo (seeded, deterministic)', () => {
  // docs/MATHEMATICS.md section 6: under exchangeability, thresholds
  // fitted at alpha must keep fresh correct verdicts at >= 1-alpha.
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (const [n, alpha, floor] of [[50, 0.1, 0.86], [50, 0.05, 0.92]]) {
    let kept = 0;
    const trials = 600;
    for (let t = 0; t < trials; t++) {
      const cal = Array.from({ length: n }, () => ({ confidence: 0.3 + rnd() * 0.7, correct: true }));
      const q = fitConformalThreshold(cal, alpha);
      assert.notEqual(q, null);
      if (!shouldAbstain(0.3 + rnd() * 0.7, q)) kept++;
    }
    assert.ok(kept / trials >= floor, `n=${n} alpha=${alpha}: keep-rate ${kept / trials} below ${floor}`);
  }
});

test('conformal fit rejects out-of-range alpha and non-finite samples instead of inventing a threshold', () => {
  const finite = Array.from({ length: 20 }, (_, i) => ({ confidence: 0.55 + i * 0.02, correct: true }));
  const clean = fitConformalThreshold(finite, 0.1);
  assert.ok(typeof clean === 'number' && Number.isFinite(clean));
  for (const alpha of [1.5, 1, -0.5, NaN]) {
    assert.equal(fitConformalThreshold(finite, alpha), null, `alpha ${alpha} must yield no threshold`);
  }
  const dirty = [{ confidence: NaN, correct: true }, { confidence: Infinity, correct: true }, ...finite];
  assert.equal(fitConformalThreshold(dirty, 0.1), clean, 'non-finite samples are dropped, never sorted into the quantile');
  assert.equal(fitConformalThreshold([{ confidence: NaN, correct: true }], 0.1), null);
});

test('conformal fit handles tiny and empty calibration sets honestly', () => {
  assert.equal(fitConformalThreshold([], 0.1), null);
  assert.equal(shouldAbstain(0.1, null), false);
  // n=1, alpha=0.1: rank ceil(2*0.9)=2 > n, so no finite threshold exists.
  // Returning the single score would fabricate a coverage guarantee.
  assert.equal(fitConformalThreshold([{ confidence: 0.9, correct: true }], 0.1), null);
});
