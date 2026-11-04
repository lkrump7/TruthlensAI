

// Builds the downloadable investigation report from a verdict record.
// Pure function. It reads only fields the record holds and invents
// nothing: no confidence figure, no source-quality claim, no score.
// Claim and passage text is untrusted: line breaks in it are flattened
// wherever it is interpolated, so a passage cannot forge a report
// field or heading on its own line.
const oneLine = (value) => String(value ?? '').replace(/\s*[\r\n]+\s*/g, ' ').trim();

function passageLines(items) {
  if (!items?.length) return ['None found.'];
  return items.flatMap((e) => [
    `- ${oneLine(e.title) || 'Untitled source'} (${oneLine(e.source) || 'unknown source'}${e.date ? `, ${oneLine(e.date)}` : ''})`,
    `  "${oneLine(e.passage)}"`,
    ...(e.url ? [`  ${oneLine(e.url)}`] : []),
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
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    // A YYYY-MM-DD-shaped prefix is only citable when it is a real
    // calendar date; otherwise '2024-13-99' would print as the run date.
    const y = Number(iso[1]), mo = Number(iso[2]), d = Number(iso[3]);
    const roundTrip = new Date(Date.UTC(y, mo - 1, d));
    if (roundTrip.getUTCFullYear() === y && roundTrip.getUTCMonth() === mo - 1 && roundTrip.getUTCDate() === d) {
      return raw.slice(0, 10);
    }
    return 'not recorded';
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString().slice(0, 10);
}

export function buildInvestigationReport(record, { now = new Date() } = {}) {
  const r = record || {};
  const models = modelNames(r);
  const lines = [
    '# TruthLens check report',
    '',
    `Claim: ${oneLine(r.text)}`,
    `Verdict: ${r.verdict || 'Unverifiable'}`,
    `Checked by: ${oneLine(r.judgedBy) || 'not recorded'}`,
    `Models: ${models.length ? models.map(oneLine).join(', ') : 'not recorded'}`,
    `Mode: ${oneLine(r.mode) || 'not recorded'}`,
    `Run: ${runDate(r)}`,
    `Exported: ${now.toISOString().slice(0, 10)}`,
    ...(r.promptVersion ? [`Prompt version: ${oneLine(r.promptVersion)}`] : []),
  ];
  if (r.trajectory?.length) lines.push(`Steps: ${r.trajectory.join(', ')}`);
  if (r.stability) {
    const runs = r.stability.runs || 0;
    const verdicts = (r.stability.verdicts || []).join(', ');
    if (runs < 2) lines.push('Checked once. No repeat run, so no agreement was measured.');
    else lines.push(`Checked ${runs} times. Answers: ${verdicts}. ${r.stability.agreed ? 'All runs agreed.' : 'Runs disagreed.'}`);
  }
  if (r.judges && !Array.isArray(r.judges) && !r.judges.agreed && r.judges.spark && r.judges.wonder) lines.push(`The checkers disagreed. Muse Spark said ${r.judges.spark}. Muse Wonder said ${r.judges.wonder}. We show the Wonder answer.`);
  lines.push('', '## Why we gave this answer', '', oneLine(r.explanation) || 'No reason was saved.');
  lines.push('', '## Evidence for the claim', '', ...passageLines(r.supporting));
  lines.push('', '## Evidence against the claim', '', ...passageLines(r.contradicting));
  if (r.unclassified?.length) lines.push('', '## Used, but the side is not clear', '', ...passageLines(r.unclassified));
  if (r.allEvidence?.length) lines.push('', `## All fetched passages (${r.allEvidence.length})`, '', 'Every passage that passed fetching and screening, including ones the judge did not cite.', '', ...passageLines(r.allEvidence));
  if (r.challenge) lines.push('', '## Follow-up check', '', `Weakest proof: ${oneLine(r.challenge.weakestEvidenceId) || 'not named'}. What would prove it wrong: ${oneLine(r.challenge.falsifier) || 'not stated'}. Other idea: ${oneLine(r.challenge.alternative) || 'not stated'}. Still not clear: ${oneLine(r.challenge.unresolved) || 'not stated'}.`);
  if (r.preChallengeVerdict) lines.push('', `First answer: ${r.preChallengeVerdict}. Answer after the follow-up check: ${r.verdict}. We keep both.`);
  if (r.followups?.length) {
    lines.push('', '## Follow-up checks', '');
    for (const f of r.followups) {
      lines.push(`- ${f.kind || 'custom'}: ${oneLine(f.instruction)} New answer: ${f.verdict || 'not recorded'}. ${oneLine(f.explanation)}`.trim());
      if (f.falsifier) lines.push(`  What would prove it wrong: ${oneLine(f.falsifier)} Found: ${f.falsifierFound ? 'yes' : 'no'}.`);
      if (f.confirmer) lines.push(`  What would prove it right: ${oneLine(f.confirmer)} Found: ${f.confirmerFound ? 'yes' : 'no'}.`);
    }
  }
  lines.push('', '## Limits', '');
  if (r.limitations?.length) lines.push(...r.limitations.map((l) => `- ${oneLine(l)}`));
  else lines.push('- No limits were saved.');
  lines.push('', 'An answer can change if you check the claim again later. New proof can change it. We will show that change, not hide it.');
  return lines.join('\n');
}
