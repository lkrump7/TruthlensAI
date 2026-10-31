import { sourceTier } from './rank.mjs';

// FRANQ-style split (arXiv:2505.21072): faithfulness to the cited evidence is
// not factuality, and neither is evidence strength. Report them separately,
// deterministically, from the cited set — never as one user-facing score.
//   faithfulness: stance-classification coverage of the cited passages.
//     This is a completeness proxy, NOT an entailment check: a judge that
//     mislabels a contradicting passage as supporting still scores 1.0.
//     The gated verdict, not this number, is the correctness mechanism.
//   evidenceStrength: how strong is the cited base (domains, tier, count)?
const labelFor = (score) => (score >= 0.7 ? 'high' : score >= 0.4 ? 'moderate' : 'low');

export function assessUncertainty({ cited = [], supporting = [], contradicting = [], unclassified = [] } = {}) {
  const all = cited.length ? cited : [...supporting, ...contradicting, ...unclassified];
  const classified = all.length - (unclassified || []).length;
  const faithfulnessScore = all.length ? classified / all.length : 0;
  const domains = new Set(all.map((e) => e.source).filter(Boolean));
  const avgTier = all.length ? all.reduce((s, e) => s + sourceTier(e.source), 0) / all.length / 3 : 0;
  const strengthScore = all.length
    ? Math.min(domains.size, 3) / 3 * 0.4 + avgTier * 0.3 + Math.min(all.length, 4) / 4 * 0.3
    : 0;
  return {
    faithfulness: {
      score: Number(faithfulnessScore.toFixed(2)), label: labelFor(faithfulnessScore),
      detail: all.length ? `${classified} of ${all.length} cited passage(s) carry a judge-classified stance.` : 'Nothing was cited.',
    },
    evidenceStrength: {
      score: Number(strengthScore.toFixed(2)), label: labelFor(strengthScore),
      detail: all.length ? `${domains.size} independent domain(s), average source tier ${(avgTier * 3).toFixed(1)}/3, ${all.length} cited passage(s).` : 'No evidence base.',
    },
  };
}
