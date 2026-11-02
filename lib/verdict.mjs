// Verdict construction and the deterministic gate policies.
// Gates are pure functions over a verdict context; the pipeline applies them in order.
import { VERDICTS } from './config.mjs';
import { JudgeError } from './errors.mjs';

export const DECISIVE_VERDICTS = ['Supported', 'Contradicted'];

export function makeVerdict(fields = {}) {
  const verdict = fields.verdict ?? 'Unverifiable';
  if (!VERDICTS.includes(verdict)) throw new JudgeError(`Unknown verdict: ${verdict}`);
  return {
    text: '', type: 'Unclassified', judgedBy: 'Muse Spark 1.3',
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
  if (DECISIVE_VERDICTS.includes(ctx.verdict) && domains.size < 2) {
    return {
      ...ctx, verdict: 'Partially supported',
      limitations: [...(ctx.limitations || []), 'Single independent source: only one domain backs this verdict, so it is downgraded until a second independent source corroborates it.'],
    };
  }
  return ctx;
}

export const citationMissing = (ctx) => !(ctx.cited || []).length && ctx.verdict !== 'Unverifiable' && ctx.verdict !== 'Not fact-checkable';

export function applyCitationGate(ctx) {
  if (citationMissing(ctx)) {
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
export function applyStabilityGate(ctx) {
  if (DECISIVE_VERDICTS.includes(ctx.verdict) && ctx.stability && ctx.stability.runs >= 2 && !ctx.stability.agreed) {
    const cited = ctx.cited ?? [...(ctx.supporting || []), ...(ctx.contradicting || []), ...(ctx.unclassified || [])];
    if (!cited.length) {
      return {
        ...ctx, verdict: 'Unverifiable',
        limitations: [...(ctx.limitations || []), `Judge runs disagreed across ${ctx.stability.runs} runs (${ctx.stability.verdicts.join(', ')}) and no cited evidence stands, so no verdict was accepted until repeated judging settles.`],
      };
    }
    return {
      ...ctx, verdict: 'Partially supported',
      limitations: [...(ctx.limitations || []), `Judge runs disagreed across ${ctx.stability.runs} runs (${ctx.stability.verdicts.join(', ')}), so this verdict is downgraded until repeated judging settles.`],
    };
  }
  return ctx;
}

export const GATES = [
  { name: 'citation', applies: citationMissing, apply: applyCitationGate },
  { name: 'outdated', applies: (ctx) => ctx.verdict === 'Partially supported', apply: applyOutdatedGate },
  { name: 'corroboration', applies: (ctx) => DECISIVE_VERDICTS.includes(ctx.verdict), apply: applyCorroborationGate },
  { name: 'stability', applies: (ctx) => DECISIVE_VERDICTS.includes(ctx.verdict) && !!ctx.stability && ctx.stability.runs >= 2 && !ctx.stability.agreed, apply: applyStabilityGate },
];

export function applyGates(ctx, gates = GATES) {
  const initialDecisive = DECISIVE_VERDICTS.includes(ctx.verdict);
  const unstable = !!ctx.stability && ctx.stability.runs >= 2 && !ctx.stability.agreed;
  const out = gates.reduce((c, gate) => (gate.applies(c) ? gate.apply(c) : c), ctx);
  let finalOut = out;
  if (gates === GATES && out.verdict === 'Partially supported') finalOut = applyOutdatedGate(out);
  if (gates === GATES && initialDecisive && unstable) {
    const hasStabilityNote = (finalOut.limitations || []).some((l) => /judge runs disagreed/i.test(l));
    if (!hasStabilityNote) {
      const cited = finalOut.cited ?? [...(finalOut.supporting || []), ...(finalOut.contradicting || []), ...(finalOut.unclassified || [])];
      const note = cited.length
        ? `Judge runs disagreed across ${ctx.stability.runs} runs (${ctx.stability.verdicts.join(', ')}), so this verdict is downgraded until repeated judging settles.`
        : `Judge runs disagreed across ${ctx.stability.runs} runs (${ctx.stability.verdicts.join(', ')}) and no cited evidence stands, so no verdict was accepted until repeated judging settles.`;
      if (DECISIVE_VERDICTS.includes(finalOut.verdict)) {
        finalOut = applyStabilityGate({ ...finalOut, verdict: ctx.verdict });
        if (!(finalOut.limitations || []).some((l) => /judge runs disagreed/i.test(l))) {
          finalOut = { ...finalOut, limitations: [...(finalOut.limitations || []), note] };
        }
      } else {
        finalOut = { ...finalOut, limitations: [...(finalOut.limitations || []), note] };
      }
    }
  }
  return finalOut;
}
