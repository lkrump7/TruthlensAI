

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

const MODEL_BY_JUDGE_KEY = { spark: 'Muse Spark 1.3', wonder: 'Muse Wonder' };

function modelNames(r) {
  const models = [];
  const add = (name) => {
    if (typeof name === 'string' && name.trim() && !models.includes(name.trim())) models.push(name.trim());
  };
  const fromJudgeValue = (key, value) => {
    if (value === undefined || value === null || value === '') return;
    if (typeof value === 'string' && /muse/i.test(value)) add(value);
    else add(MODEL_BY_JUDGE_KEY[key]);
  };
  if (Array.isArray(r.judges)) {
    for (const entry of r.judges) {
      if (typeof entry === 'string') add(entry);
      else if (entry && typeof entry === 'object') add(entry.model || entry.judgedBy || entry.name);
    }
  } else if (r.judges && typeof r.judges === 'object') {
    for (const [key, value] of Object.entries(r.judges)) {
      if (key === 'agreed') continue;
      if (key === 'revision') { add(value); continue; }
      fromJudgeValue(key, value);
    }
  }
  add(r.judgedBy);
  return models;
}

function runDate(r) {
  if (!r.history?.length) return 'not recorded';
  const last = r.history[r.history.length - 1];
  const raw = typeof last === 'string' ? last : (last?.at || last?.date || last?.runAt || last?.createdAt);
  if (typeof raw !== 'string' || !raw.trim()) return 'not recorded';
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString().slice(0, 10);
}

export function buildInvestigationReport(record, { now = new Date() } = {}) {
  const r = record || {};
  const models = modelNames(r);
  const lines = [
    '# TruthLens investigation report',
    '',
    `Claim: ${r.text || ''}`,
    `Verdict: ${r.verdict || 'Unverifiable'}`,
    `Judged by: ${r.judgedBy || 'not recorded'}`,
    `Models: ${models.length ? models.join(', ') : 'not recorded'}`,
    `Mode: ${r.mode || 'not recorded'}`,
    `Run: ${runDate(r)}`,
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
