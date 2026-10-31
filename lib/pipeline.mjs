import { ESCALATION_VERDICTS } from './config.mjs';
import { classifyClaim, splitAtomicClaims, topicKeyFor } from './claims.mjs';
export { topicKeyFor };
import { callLiveJudge, getModels, defaultMetaClient } from './meta.mjs';
import { researchClaim, passageTouchesClaim } from './evidence.mjs';
import { makeVerdict, validateCitations, applyGates } from './verdict.mjs';
import { investigateEvidenceChain } from './forensics.mjs';
import { JudgeError } from './errors.mjs';

// The shared verification pipeline: research -> fetch -> judge -> gates.
// Only fetched, screened passages may be judged or cited.
async function defaultChallenge({ claim, verdict, evidence }) {
  return defaultMetaClient().completeJson({
    model: getModels().spark,
    system: 'You are the TruthLens Challenger. Reply with JSON only: {"material": boolean, "weakestEvidenceId": string|null, "falsifier": string, "alternative": string, "unresolved": string}. material is true only when a specific weakness could plausibly change the verdict. If no material weakness exists, return {"material": false} and invent nothing.',
    user: `Claim: ${claim}\nVerdict reached: ${verdict}\nCited evidence:\n${evidence.map((e) => `[${e.id}] ${e.passage}`).join('\n')}\nWhat evidence would prove this conclusion wrong? Name the weakest cited evidence, a falsifying observation, an alternative interpretation, and what remains unresolved.`,
  });
}

const JUDGE_MODELS = { spark: () => getModels().spark, wonder: () => getModels().wonder };

// Roll-up rule: decisive requires every decisive element to agree, and no
// unverifiable element may hide inside a decisive compound verdict.
function rollupCompound(text, subs) {
  const verdicts = subs.map((s) => s.verdict);
  const decisive = verdicts.filter((v) => v !== 'Unverifiable' && v !== 'Not fact-checkable');
  let verdict = 'Unverifiable';
  if (verdicts.includes('Unverifiable')) verdict = decisive.length ? 'Partially supported' : 'Unverifiable';
  else if (decisive.length && new Set(decisive).size === 1) verdict = decisive[0];
  else if (decisive.length) verdict = 'Partially supported';
  return {
    ...makeVerdict({
      text, type: classifyClaim(text), verdict,
      judgedBy: subs.some((s) => s.judgedBy === 'Muse Wonder') ? 'Muse Wonder' : 'Muse Spark 1.3',
      supporting: subs.flatMap((s) => s.supporting || []),
      contradicting: subs.flatMap((s) => s.contradicting || []),
      unclassified: subs.flatMap((s) => s.unclassified || []),
      explanation: `${verdicts.filter((v) => v === 'Supported').length} of ${subs.length} elements supported; ${verdicts.filter((v) => v === 'Contradicted').length} contradicted; ${verdicts.filter((v) => v === 'Unverifiable').length} unverifiable. Verdicts attach to the atomic claims below, then roll up.`,
      limitations: ['Compound claim: each atomic element was researched and judged separately.'],
    }),
    mode: 'live',
    research: { queries: subs.flatMap((s) => s.research?.queries || []), sourcesFound: subs.reduce((n, s) => n + (s.research?.sourcesFound || 0), 0), fetched: subs.reduce((n, s) => n + (s.research?.fetched || 0), 0) },
    subclaims: subs.map((s) => ({ text: s.text, verdict: s.verdict, judgedBy: s.judgedBy })),
  };
}

function partitionEvidence(res, citedList) {
  const stanceOf = (e) => {
    const s = res.stances && res.stances[e.id];
    return ['supports', 'contradicts', 'misleading'].includes(s) ? s : 'unknown';
  };
  return {
    supporting: citedList.filter((e) => stanceOf(e) === 'supports'),
    contradicting: citedList.filter((e) => ['contradicts', 'misleading'].includes(stanceOf(e))),
    unclassified: citedList.filter((e) => stanceOf(e) === 'unknown'),
  };
}

export async function verifyResearchedClaim(text, deps = {}) {
  const atomics = deps._atomic ? [text] : splitAtomicClaims(text);
  if (atomics.length > 1 && atomics.length <= 4) {
    const subs = [];
    for (const a of atomics) subs.push(await verifyResearchedClaim(a, { ...deps, _atomic: true }));
    return rollupCompound(text, subs);
  }
  const type = classifyClaim(text);
  if (type === 'Not fact-checkable') {
    return { ...makeVerdict({ text, type, verdict: 'Not fact-checkable', explanation: 'This reads as opinion or value judgement, so there is no factual claim to test against evidence.' }), mode: 'live', research: { queries: [], sourcesFound: 0, fetched: 0 } };
  }
  const pooled = await researchClaim(text, { cacheKey: topicKeyFor(text), ...deps });
  const research = { ...pooled, evidence: (pooled.evidence || []).filter((e) => passageTouchesClaim(e.passage, text)) };
  const stats = { queries: research.queries, sourcesFound: research.sourcesFound, fetched: research.evidence.length, failures: (research.failures || []).length };
  if (!research.evidence.length) {
    return { ...makeVerdict({ text, type, verdict: 'Unverifiable', explanation: `Meta search found ${stats.sourcesFound} source(s), but none could be fetched with a passage that touches this claim. That is different from the claim being false.`, limitations: ['No fetched passage passed relevance and screening checks. Nothing was cited.', ...(research.failures || []).slice(0, 3).map((f) => `Fetch failed for ${f.url}: ${f.reason}`)] }), mode: 'live', research: stats };
  }
  const judge = deps.judge || (({ claim, evidence, model }) => callLiveJudge({ claim, evidence, model }));
  let result = await judge({ claim: text, evidence: research.evidence, model: JUDGE_MODELS.spark() });
  let judgedBy = 'Muse Spark 1.3';
  let judges;
  if (ESCALATION_VERDICTS.includes(result.verdict)) {
    const wonderResult = await judge({ claim: text, evidence: research.evidence, model: JUDGE_MODELS.wonder() });
    judges = { spark: result.verdict, wonder: wonderResult.verdict, agreed: result.verdict === wonderResult.verdict };
    result = wonderResult;
    judgedBy = 'Muse Wonder';
  }
  const gateFor = (res) => {
    const check2 = validateCitations(res.citedIds || [], research.evidence);
    if (!check2.ok) throw new JudgeError(`Judge cited unknown evidence: ${check2.bad.join(',')}`);
    const byId2 = new Map(research.evidence.map((e) => [e.id, e]));
    const cited2 = (res.citedIds || []).map((id) => byId2.get(id)).filter(Boolean);
    return { cited2, gated: applyGates({ verdict: res.verdict, cited: cited2, ...partitionEvidence(res, cited2), limitations: ['Verdict rests only on the fetched passages cited here, retrieved ' + new Date().toISOString().slice(0, 10) + '.'] }) };
  };
  let { cited2: cited, gated } = gateFor(result);
  let preChallengeVerdict;
  let challenge = null;
  const challengeEnabled = deps.challenge !== null && process.env.TRUTHLENS_NO_CHALLENGE !== '1';
  if (challengeEnabled && ['Supported', 'Contradicted'].includes(gated.verdict) && cited.length) {
    const challenger = deps.challenge || defaultChallenge;
    try { challenge = await challenger({ claim: text, verdict: gated.verdict, evidence: cited }); } catch { challenge = null; }
    if (challenge?.material) {
      preChallengeVerdict = gated.verdict;
      const revision = await judge({ claim: text, evidence: research.evidence, model: JUDGE_MODELS.wonder(), challenge });
      result = revision;
      ({ cited2: cited, gated } = gateFor(revision));
      gated = { ...gated, explanation: revision.explanation || gated.explanation };
    } else {
      challenge = challenge && challenge.material ? challenge : null;
    }
  }
  return {
    ...makeVerdict({
      text, type, verdict: gated.verdict, judgedBy,
      supporting: gated.supporting, contradicting: gated.contradicting, unclassified: gated.unclassified,
      explanation: result.explanation || '',
      historicalAssessment: gated.historicalAssessment, currentAssessment: gated.currentAssessment,
      limitations: gated.limitations,
    }),
    forensics: investigateEvidenceChain(text, cited, { verdict: gated.verdict }),
    preChallengeVerdict, challenge: challenge?.material ? challenge : undefined,
    mode: 'live', research: stats, judges,
  };
}
