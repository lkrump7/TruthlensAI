import { summariseStability } from './stability.mjs';

// Repeated-trial summary for one eval claim. A single run is a sample,
// so eval reports the majority verdict and how often trials flipped
// away from it, instead of one pass or fail.
export function summariseTrials(verdicts = []) {
  const base = summariseStability(verdicts);
  const majorityCount = base.verdicts.filter((v) => v === base.majority).length;
  return {
    ...base,
    flipRate: base.runs ? 1 - majorityCount / base.runs : 0,
  };
}
