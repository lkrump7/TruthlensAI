// Verdict construction and the deterministic gate policies.
// Gates are pure functions over a verdict context; the pipeline applies them in order.
import { VERDICTS } from './config.mjs';
import { JudgeError } from './errors.mjs';

export function makeVerdict(fields = {}) {
  const verdict = fields.verdict ?? 'Unverifiable';
  if (!VERDICTS.includes(verdict)) throw new JudgeError(`Unknown verdict: ${verdict}`);
  return {
    text: '', type: 'Scientific', judgedBy: 'Muse Spark 1.3',
    supporting: [], contradicting: [], unclassified: [], explanation: '', limitations: [], forensics: null, uncertainty: null,
    ...fields,
    verdict,
  };
}

export function validateCitations(ids, evidence) {
  const known = new Set((evidence || []).map((e) => e.id));
  const bad = (ids || []).filter((id) => !known.has(id));
  return { ok: bad.length === 0, bad };
}

export const newestEvidenceDate = (list) => (list || []).map((e) => e.date || '').sort().at(-1) || '';
const newest = newestEvidenceDate;

export function applyOutdatedGate(ctx) {
  if (ctx.verdict !== 'Partially supported') return ctx;
  if (ctx.supporting?.length && ctx.contradicting?.length && newest(ctx.contradicting) && newest(ctx.supporting) && newest(ctx.contradicting) > newest(ctx.supporting)) {
    return {
      ...ctx, verdict: 'Outdated',
      historicalAssessment: `Supported by the evidence available at the time (${newest(ctx.supporting)}).`,
      currentAssessment: `Contradicted by more recent evidence (${newest(ctx.contradicting)}).`,
    };
  }
  return ctx;
}

export function applyCorroborationGate(ctx) {
  const domains = new Set((ctx.cited || []).map((e) => e.source));
  if ((ctx.verdict === 'Supported' || ctx.verdict === 'Contradicted') && domains.size < 2) {
    return {
      ...ctx, verdict: 'Partially supported',
      limitations: [...(ctx.limitations || []), 'Single independent source: only one domain backs this verdict, so it is downgraded until a second independent source corroborates it.'],
    };
  }
  return ctx;
}

export function applyCitationGate(ctx) {
  if (!(ctx.cited || []).length && ctx.verdict !== 'Unverifiable' && ctx.verdict !== 'Not fact-checkable') {
    return {
      ...ctx, verdict: 'Unverifiable', supporting: [], contradicting: [], unclassified: [],
      limitations: [...(ctx.limitations || []), 'The judge cited no evidence, so no verdict was accepted.'],
    };
  }
  return ctx;
}

// Specification-style gates: each gate names when it applies and what it does.
// Order matters — citation first, then outdated, then corroboration downgrade.
// Add a gate by adding an entry here, not by editing applyGates.
export const GATES = [
  { name: 'citation', applies: (ctx) => !(ctx.cited || []).length && ctx.verdict !== 'Unverifiable' && ctx.verdict !== 'Not fact-checkable', apply: applyCitationGate },
  { name: 'outdated', applies: (ctx) => ctx.verdict === 'Partially supported', apply: applyOutdatedGate },
  { name: 'corroboration', applies: (ctx) => ctx.verdict === 'Supported' || ctx.verdict === 'Contradicted', apply: applyCorroborationGate },
];

export function applyGates(ctx, gates = GATES) {
  return gates.reduce((c, gate) => (gate.applies(c) ? gate.apply(c) : c), ctx);
}
