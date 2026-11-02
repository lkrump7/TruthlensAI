// Evidence Forensics: compare what a claim says its evidence shows
// against what the fetched evidence actually says. Deterministic checks only.

import { numbersIn, hasNegation, hasHedging } from './nlp.mjs';

// Numbers as digits or words, so "eighty percent" in a passage can
// match "80 percent" in the claim.
const numbersOf = (t) => numbersIn(t);
const HUMAN = /\b(adults?|humans?|people|patients|men|women|participants)\b/i;
const ANIMAL = /\b(mice|rats|rodents|monkeys|animals|in vitro|cell culture|zebrafish)\b/i;
const SECONDARY = /\b(review|meta-analysis|commentary|editorial|overview|according to reports)\b/i;
const PRIMARY = /\b(trial|randomi[sz]ed|participants|patients were|subjects|cohort of \d|n\s*=\s*\d)/i;

export function investigateEvidenceChain(claimText, evidence = [], verdictInfo = {}) {
  const claim = String(claimText || '');
  const cited = evidence || [];
  const discrepancies = [];
  const checks = [];

  checks.push({ name: 'source-exists', status: cited.length ? 'pass' : 'fail', detail: cited.length ? `${cited.length} fetched source(s) behind this claim.` : 'No fetched source backs this claim.' });
  if (!cited.length) return { checks, discrepancies, claimed: {}, found: {} };

  // Effect size: numbers claimed vs numbers in passages.
  const claimedNums = numbersOf(claim);
  const passageNums = cited.flatMap((e) => numbersOf(e.passage));
  let effectStatus = 'unknown';
  if (claimedNums.length && passageNums.length) {
    const matched = claimedNums.some((n) => passageNums.some((p) => Math.abs(p - n) < 0.51 || (n !== 0 && Math.abs(p / n - 1) < 0.05)));
    effectStatus = matched ? 'pass' : 'fail';
    if (!matched) discrepancies.push({ type: 'effect-mismatch', label: 'The numbers do not match', detail: `The claim says ${claimedNums.join(', ')}, but the sources say ${[...new Set(passageNums)].slice(0, 5).join(', ')}.` });
  }
  checks.push({ name: 'effect-match', status: effectStatus, detail: effectStatus === 'unknown' ? 'No comparable numbers on both sides.' : `Claimed numbers: ${claimedNums.join(', ') || 'none'}.` });

  // Population: human claim, animal evidence.
  let popStatus = 'unknown';
  if (HUMAN.test(claim)) {
    const animal = cited.find((e) => ANIMAL.test(e.passage) && !HUMAN.test(e.passage));
    popStatus = animal ? 'fail' : 'pass';
    if (animal) discrepancies.push({ type: 'population-mismatch', label: 'The proof is not about the same group', detail: `The claim is about people. This source is not about people (${animal.source}).`, evidenceId: animal.id });
  }
  checks.push({ name: 'population-match', status: popStatus, detail: popStatus === 'unknown' ? 'Claim does not specify a population.' : 'Checked claim population against passages.' });

  // Primary vs secondary.
  const claimsStudy = /\b(study|studies|trial|research (shows|proves|found)|proved|proven)\b/i.test(claim);
  let primaryStatus = 'unknown';
  if (claimsStudy) {
    const hasPrimary = cited.some((e) => PRIMARY.test(e.passage) && !SECONDARY.test(e.title + ' ' + e.passage.slice(0, 80)));
    const allSecondary = cited.every((e) => SECONDARY.test(e.title + ' ' + e.passage));
    primaryStatus = hasPrimary ? 'pass' : allSecondary ? 'fail' : 'unknown';
    if (primaryStatus === 'fail') discrepancies.push({ type: 'secondary-as-primary', label: 'Opinion shown as a study', detail: 'The claim talks about a study. But all the sources are reviews or opinion, not a study.' });
  }
  checks.push({ name: 'primary-source', status: primaryStatus, detail: 'Whether a primary study, not just commentary, was fetched.' });

  // Sample size presence.
  const sample = cited.map((e) => (e.passage.match(/\b(\d[\d,]*)\s*(participants|patients|subjects|adults|people)\b/i) || [])[1]).find(Boolean);
  checks.push({ name: 'sample-size', status: sample ? 'pass' : 'unknown', detail: sample ? `Sample mentioned: ${sample} participants.` : 'No sample size found in fetched passages.' });

  // Negation and hedging inside cited evidence. Annotations only
  // (PRINCIPLES 7): the judge's stance labels decide what the wording
  // means; these flags stop negation from passing as plain support and
  // record hedged evidence as hedged.
  const negated = cited.find((e) => hasNegation(e.passage));
  if (negated) discrepancies.push({ type: 'negated-evidence', label: 'A source says the opposite in its words', detail: `A cited passage (${negated.source}) uses negation wording ("no significant", "did not", "no evidence"). Read it against the judge's stance label for that passage.`, evidenceId: negated.id });
  checks.push({ name: 'negation', status: negated ? 'fail' : 'pass', detail: negated ? 'At least one cited passage negates or null-reports.' : 'No negation wording in cited passages.' });
  const hedged = cited.some((e) => hasHedging(e.passage));
  checks.push({ name: 'hedging', status: hedged ? 'present' : 'absent', detail: hedged ? 'At least one cited passage hedges (may, suggests, modest, preliminary).' : 'No hedging wording in cited passages.' });

  if (verdictInfo.verdict === 'Outdated') {
    discrepancies.push({ type: 'superseded', label: 'Newer proof has replaced this', detail: 'New proof goes against the old proof. See the past and current answers.' });
  }

  return {
    checks, discrepancies,
    claimed: { numbers: claimedNums, population: HUMAN.test(claim) ? 'humans' : null },
    found: { numbers: [...new Set(passageNums)].slice(0, 8), sampleSize: sample || null },
  };
}
