

// Builds the downloadable investigation report from a verdict record.
// Pure function. It reads only fields the record holds and invents
// nothing: no confidence figure, no source-quality claim, no score.
function passageLines(items) {
  if (!items?.length) return ['None fetched.'];
  return items.flatMap((e) => [
    `- ${e.title || 'Untitled source'} (${e.source || 'unknown source'}${e.date ? `, ${e.date}` : ''})`,
    `  "${e.passage}"`,
    ...(e.url ? [`  ${e.url}`] : []),
  ]);
}

export function buildInvestigationReport(record, { now = new Date() } = {}) {
  const r = record || {};
  const lines = [
    '# TruthLens investigation report',
    '',
    `Claim: ${r.text || ''}`,
    `Verdict: ${r.verdict || 'Unverifiable'}`,
    `Judged by: ${r.judgedBy || 'not recorded'}`,
    `Mode: ${r.mode || 'not recorded'}`,
    `Exported: ${now.toISOString().slice(0, 10)}`,
    ...(r.promptVersion ? [`Prompt version: ${r.promptVersion}`] : []),
  ];
  if (r.trajectory?.length) lines.push(`Investigation stages: ${r.trajectory.join(', ')}`);
  if (r.stability) {
    const runs = r.stability.runs || 0;
    const verdicts = (r.stability.verdicts || []).join(', ');
    if (runs < 2) lines.push('Stability: judged once. No repeat run, so no agreement was measured. One run is a sample, not a measurement.');
    else lines.push(`Stability: ${runs} runs, verdicts ${verdicts}, ${r.stability.agreed ? 'all runs agreed' : 'runs disagreed'}. One run is a sample. Agreement across runs is the reliability signal shown here.`);
  }
  if (r.judges && !r.judges.agreed) lines.push(`Judge disagreement: Muse Spark said ${r.judges.spark}. Muse Wonder said ${r.judges.wonder}. The Wonder verdict is the one shown.`);
  lines.push('', '## Why this verdict', '', r.explanation || 'No explanation recorded.');
  lines.push('', '## Supporting evidence', '', ...passageLines(r.supporting));
  lines.push('', '## Contradicting evidence', '', ...passageLines(r.contradicting));
  if (r.unclassified?.length) lines.push('', '## Cited evidence with no stance classified', '', ...passageLines(r.unclassified));
  if (r.challenge) lines.push('', '## Challenge on record', '', `Weakest evidence: ${r.challenge.weakestEvidenceId || 'not named'}. What would prove this wrong: ${r.challenge.falsifier || 'not stated'}. Alternative reading: ${r.challenge.alternative || 'not stated'}. Unresolved: ${r.challenge.unresolved || 'not stated'}.`);
  if (r.preChallengeVerdict) lines.push('', `Verdict before challenge: ${r.preChallengeVerdict}. Verdict after challenge: ${r.verdict}. Both stay on record.`);
  lines.push('', '## Limits', '');
  if (r.limitations?.length) lines.push(...r.limitations.map((l) => `- ${l}`));
  else lines.push('- No limits recorded.');
  lines.push('', 'A verdict can change when the claim is rechecked later. New evidence and a different judge run can move it. That change is reported here, not hidden.');
  return lines.join('\n');
}
