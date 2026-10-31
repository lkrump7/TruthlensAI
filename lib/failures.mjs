// PING failure taxonomy (DeepHalluBench, arXiv:2601.22984): classify why an
// investigation failed by where in the plan-search-judge trajectory it broke,
// so evaluation fixes systemic causes instead of counting wrong verdicts.
export const PING_CATEGORIES = ['Propagation', 'Intent', 'Noise-induced', 'Grounding'];

// Fetch failures are Grounding failures: the evidence never arrived.
// (An earlier kind->category table classified events no caller emitted;
// pingForMiss below is the taxonomy in use, derived from result shape.)
export const FETCH_FAILURE_PING = 'Grounding';

export function pingForMiss(result) {
  if (!result) return 'Grounding';
  if (result.verdict === 'Not fact-checkable') return 'Intent';
  if ((result.subclaims || []).some((s) => s.verdict === 'Unverifiable')) return 'Propagation';
  if ((result.research?.fetched ?? 0) === 0) return 'Grounding';
  if (result.verdict === 'Unverifiable') return 'Noise-induced';
  // A decisive miss with evidence in hand: the shape alone cannot prove
  // whether the judge misread good evidence or the evidence misled.
  // Returning a category here would be a guess dressed as diagnosis.
  return null;
}
