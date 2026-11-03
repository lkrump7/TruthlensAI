import { CONFIG } from './config.mjs';
import { classifyClaim, splitAtomicClaims, topicKeyFor } from './claims.mjs';
export { topicKeyFor };
import { makeVerdict } from './verdict.mjs';
import { assessUncertainty } from './uncertainty.mjs';
import { runInvestigationGraph } from './graph.mjs';
import { fetchPageText } from './fetch.mjs';
import { metaSearch } from './search.mjs';

export const MAX_ATOMIC_INVESTIGATIONS = 8;

function withSignalForwarding(deps, signal) {
  if (!signal) return deps;
  const out = { ...deps, signal };
  if (typeof deps.search === 'function') {
    const orig = deps.search;
    out.search = (claim, opts) => orig(claim, { ...(opts || {}), signal });
  } else if (!deps.search) {
    out.search = (claim, opts) => metaSearch(claim, { ...(opts || {}), signal });
  }
  if (typeof deps.fetchText === 'function') {
    const orig = deps.fetchText;
    out.fetchText = (url, opts) => orig(url, { ...(opts || {}), signal });
  } else if (!deps.fetchText) {
    out.fetchText = (url, opts) => fetchPageText(url, { ...(opts || {}), signal });
  }
  if (typeof deps.judge === 'function') {
    const orig = deps.judge;
    out.judge = (args) => orig({ ...args, signal });
  }
  return out;
}

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
  const trajectory = subs.flatMap((s) => s.trajectory || []);
  return {
    trajectory,
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
    subclaims: subs.map((s) => ({ text: s.text, verdict: s.verdict, judgedBy: s.judgedBy, ...(s.trajectory ? { trajectory: s.trajectory } : {}) })),
  };
}

function overflowVerdict(atomics, index) {
  return {
    ...makeVerdict({
      text: atomics[index], type: classifyClaim(atomics[index]), verdict: 'Unverifiable', judgedBy: 'Muse Spark 1.3',
      explanation: `This part was not investigated: the claim has ${atomics.length} atomic elements and only the first ${MAX_ATOMIC_INVESTIGATIONS} are researched. Check this element separately for a verdict.`,
      limitations: [`Element ${index + 1} of ${atomics.length} skipped: compound exceeds the ${MAX_ATOMIC_INVESTIGATIONS}-investigation cap.`],
    }),
    trajectory: [],
  };
}

export async function verifyResearchedClaim(text, deps = {}) {
  const signal = deps?.signal;
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Investigation aborted before it started.');
  const effective = withSignalForwarding(deps, signal);
  const atomics = deps._atomic ? [text] : splitAtomicClaims(text);
  // Compound claims decompose, but each atom costs a full live
  // investigation. Cap the fan-out so a pasted paragraph cannot run
  // dozens of searches; atoms past the cap stay Unverifiable with an
  // explicit limitation so the roll-up stays honest.
  if (atomics.length > 1) {
    // At most DOCUMENT_CLAIM_CONCURRENCY investigations at once, results
    // kept in claim order so the roll-up reads as written.
    // A caller threadId must not leak into concurrent sub-investigations:
    // each subclaim gets its own MemorySaver thread.
    const { threadId: _callerThread, signal: _sig, ...childBase } = effective;
    const runnable = Math.min(atomics.length, MAX_ATOMIC_INVESTIGATIONS);
    const subs = new Array(atomics.length);
    for (let i = runnable; i < atomics.length; i++) subs[i] = overflowVerdict(atomics, i);
    let next = 0;
    const worker = async () => {
      while (next < runnable) {
        if (signal?.aborted) break;
        const i = next++;
        try { subs[i] = await verifyResearchedClaim(atomics[i], { ...childBase, signal, _atomic: true }); }
        catch (err) {
          if (signal?.aborted) {
            subs[i] = {
              ...makeVerdict({ text: atomics[i], type: classifyClaim(atomics[i]), verdict: 'Unverifiable', judgedBy: 'Muse Spark 1.3', explanation: 'Investigation aborted before this element ran.', limitations: ['Investigation aborted before this element ran.'] }),
              trajectory: [],
            };
          } else {
            subs[i] = makeVerdict({ text: atomics[i], type: classifyClaim(atomics[i]), verdict: 'Unverifiable', judgedBy: 'Muse Spark 1.3', explanation: `This part could not be investigated (${err.message}). The rest of the claim was still judged.`, limitations: [`Element failed: ${err.message}`] });
          }
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONFIG.DOCUMENT_CLAIM_CONCURRENCY, runnable) }, worker));
    for (let i = 0; i < runnable; i++) {
      if (!subs[i]) subs[i] = overflowVerdict(atomics, i);
    }
    const out = rollupCompound(text, subs);
    if (atomics.length > MAX_ATOMIC_INVESTIGATIONS) {
      out.limitations = [...(out.limitations || []), `Only the first ${MAX_ATOMIC_INVESTIGATIONS} of ${atomics.length} atomic elements were investigated; the rest are Unverifiable above.`];
    }
    return out;
  }
  return runInvestigationGraph(text, effective);
}
