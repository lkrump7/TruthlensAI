// Evidence Forensics: compare what a claim says its evidence shows
// against what the fetched evidence actually says. Deterministic checks only.

const numbersOf = (t) => (String(t).match(/\d+(?:\.\d+)?/g) || []).map(Number);
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
    if (!matched) discrepancies.push({ type: 'effect-mismatch', label: 'Effect size does not match the evidence', detail: `Claim reports ${claimedNums.join(', ')}, fetched passages report ${[...new Set(passageNums)].slice(0, 5).join(', ')}.` });
  }
  checks.push({ name: 'effect-match', status: effectStatus, detail: effectStatus === 'unknown' ? 'No comparable numbers on both sides.' : `Claimed numbers: ${claimedNums.join(', ') || 'none'}.` });

  // Population: human claim, animal evidence.
  let popStatus = 'unknown';
  if (HUMAN.test(claim)) {
    const animal = cited.find((e) => ANIMAL.test(e.passage) && !HUMAN.test(e.passage));
    popStatus = animal ? 'fail' : 'pass';
    if (animal) discrepancies.push({ type: 'population-mismatch', label: 'Evidence is not from the claimed population', detail: `Claim concerns people; cited passage describes non-human evidence (${animal.source}).`, evidenceId: animal.id });
  }
  checks.push({ name: 'population-match', status: popStatus, detail: popStatus === 'unknown' ? 'Claim does not specify a population.' : 'Checked claim population against passages.' });

  // Primary vs secondary.
  const claimsStudy = /\b(study|studies|trial|research (shows|proves|found)|proved|proven)\b/i.test(claim);
  let primaryStatus = 'unknown';
  if (claimsStudy) {
    const hasPrimary = cited.some((e) => PRIMARY.test(e.passage) && !SECONDARY.test(e.title + ' ' + e.passage.slice(0, 80)));
    const allSecondary = cited.every((e) => SECONDARY.test(e.title + ' ' + e.passage));
    primaryStatus = hasPrimary ? 'pass' : allSecondary ? 'fail' : 'unknown';
    if (primaryStatus === 'fail') discrepancies.push({ type: 'secondary-as-primary', label: 'Commentary presented as a primary study', detail: 'The claim invokes a study, but every fetched source is review or commentary.' });
  }
  checks.push({ name: 'primary-source', status: primaryStatus, detail: 'Whether a primary study, not just commentary, was fetched.' });

  // Sample size presence.
  const sample = cited.map((e) => (e.passage.match(/\b(\d[\d,]*)\s*(participants|patients|subjects|adults|people)\b/i) || [])[1]).find(Boolean);
  checks.push({ name: 'sample-size', status: sample ? 'pass' : 'unknown', detail: sample ? `Sample mentioned: ${sample} participants.` : 'No sample size found in fetched passages.' });

  if (verdictInfo.verdict === 'Outdated') {
    discrepancies.push({ type: 'superseded', label: 'Result superseded by newer evidence', detail: 'Current evidence contradicts the originally supporting evidence; see historical/current assessments.' });
  }

  return {
    checks, discrepancies,
    claimed: { numbers: claimedNums, population: HUMAN.test(claim) ? 'humans' : null },
    found: { numbers: [...new Set(passageNums)].slice(0, 8), sampleSize: sample || null },
  };
}
