import { CONFIG } from './config.mjs';
import { classifyClaim, splitAtomicClaims, topicKeyFor } from './claims.mjs';
export { topicKeyFor };
import { makeVerdict } from './verdict.mjs';
import { assessUncertainty } from './uncertainty.mjs';
import { runInvestigationGraph } from './graph.mjs';

// The shared verification pipeline, orchestrated as a LangGraph workflow
// (lib/graph.mjs): triage -> research -> judge -> gates -> challenge ->
// assemble. Only fetched, screened passages may be judged or cited.
// Compound claims decompose into atomic investigations, then roll up.

// Roll-up rule: decisive requires every element to agree, and no
// unverifiable or not fact-checkable element may hide inside a decisive
// compound verdict.
export function rollupCompound(text, subs) {
  const verdicts = subs.map((s) => s.verdict);
  const decisive = verdicts.filter((v) => v !== 'Unverifiable' && v !== 'Not fact-checkable');
  let verdict = 'Unverifiable';
  if (verdicts.includes('Unverifiable') || verdicts.includes('Not fact-checkable')) verdict = decisive.length ? 'Partially supported' : 'Unverifiable';
  else if (decisive.length && new Set(decisive).size === 1) verdict = decisive[0];
  else if (decisive.length) verdict = 'Partially supported';
  return {
    ...makeVerdict({
      text, type: classifyClaim(text), verdict,
      judgedBy: subs.some((s) => s.judgedBy === 'Muse Wonder') ? 'Muse Wonder' : 'Muse Spark 1.3',
      supporting: subs.flatMap((s) => s.supporting || []),
      contradicting: subs.flatMap((s) => s.contradicting || []),
      unclassified: subs.flatMap((s) => s.unclassified || []),
      explanation: `${verdicts.filter((v) => v === 'Supported').length} of ${subs.length} elements supported; ${verdicts.filter((v) => v === 'Contradicted').length} contradicted; ${verdicts.filter((v) => v === 'Unverifiable').length} unverifiable; ${verdicts.filter((v) => v === 'Not fact-checkable').length} not fact-checkable. Verdicts attach to the atomic claims below, then roll up.`,
      limitations: ['Compound claim: each atomic element was researched and judged separately.'],
    }),
    uncertainty: assessUncertainty({ cited: subs.flatMap((s) => [...(s.supporting || []), ...(s.contradicting || []), ...(s.unclassified || [])]), supporting: subs.flatMap((s) => s.supporting || []), contradicting: subs.flatMap((s) => s.contradicting || []), unclassified: subs.flatMap((s) => s.unclassified || []) }),
    mode: 'live',
    research: { queries: subs.flatMap((s) => s.research?.queries || []), sourcesFound: subs.reduce((n, s) => n + (s.research?.sourcesFound || 0), 0), fetched: subs.reduce((n, s) => n + (s.research?.fetched || 0), 0) },
    subclaims: subs.map((s) => ({ text: s.text, verdict: s.verdict, judgedBy: s.judgedBy })),
  };
}

export async function verifyResearchedClaim(text, deps = {}) {
  const atomics = deps._atomic ? [text] : splitAtomicClaims(text);
  if (atomics.length > 1 && atomics.length <= 4) {
    // At most DOCUMENT_CLAIM_CONCURRENCY investigations at once, results
    // kept in claim order so the roll-up reads as written.
    const subs = new Array(atomics.length);
    let next = 0;
    const worker = async () => {
      while (next < atomics.length) {
        const i = next++;
        try { subs[i] = await verifyResearchedClaim(atomics[i], { ...deps, _atomic: true }); }
        catch (err) {
          subs[i] = makeVerdict({ text: atomics[i], type: classifyClaim(atomics[i]), verdict: 'Unverifiable', judgedBy: 'Muse Spark 1.3', explanation: `This part could not be investigated (${err.message}). The rest of the claim was still judged.`, limitations: [`Element failed: ${err.message}`] });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONFIG.DOCUMENT_CLAIM_CONCURRENCY, atomics.length) }, worker));
    return rollupCompound(text, subs);
  }
  return runInvestigationGraph(text, deps);
}
