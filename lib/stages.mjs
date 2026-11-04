import { CONFIG, ESCALATION_VERDICTS } from './config.mjs';
import { classifyClaim, isMediaDescription, topicKeyFor } from './claims.mjs';
import { callLiveJudge, getModels, defaultMetaClient } from './meta.mjs';
import { researchClaim, passageTouchesClaim, rankJudgeEvidence } from './evidence.mjs';
import { makeVerdict, validateCitations, applyGates, DECISIVE_VERDICTS } from './verdict.mjs';
import { investigateEvidenceChain } from './forensics.mjs';
import { JudgeError } from './errors.mjs';
import { assessUncertainty } from './uncertainty.mjs';
import { calibrationScore, shouldAbstain } from './calibration.mjs';
import { CHALLENGER_SYSTEM, challengerUser, PROMPT_VERSION } from './prompts.mjs';
import { classifyStances } from './nli.mjs';
import { summariseStability } from './stability.mjs';
import { auditVerdict } from './audit.mjs';

// Investigation stages: the single-Claim verification logic, split so the
// LangGraph workflow (lib/graph.mjs) orchestrates these exact functions as
// nodes. No stage decides anything the old pipeline did not decide.

export const emptyUncertainty = () => assessUncertainty({ cited: [], supporting: [], contradicting: [], unclassified: [] });

export function triageStage(text) {
  const type = classifyClaim(text);
  if (type === 'Not fact-checkable') {
    const explanation = isMediaDescription(text)
      ? 'This only describes what the media itself shows. No outside source can settle it, so it is not sent to web research.'
      : 'This reads as opinion or value judgement, so there is no factual claim to test against evidence.';
    return { type, final: { ...makeVerdict({ text, type, verdict: 'Not fact-checkable', explanation }), uncertainty: emptyUncertainty(), mode: 'live', research: { queries: [], sourcesFound: 0, fetched: 0 }, allEvidence: [] } };
  }
  return { type, final: null };
}

export async function researchStage(text, type, deps = {}) {
  const pooled = await researchClaim(text, { cacheKey: topicKeyFor(text), ...deps });
  // Relevance is lexical (stemmed overlap) or semantic (sidecar cosine
  // at the calibrated threshold): a synonym passage touches the claim
  // even when it shares no stemmed token with it.
  const research = { ...pooled, evidence: (pooled.evidence || []).filter((e) => passageTouchesClaim(e.passage, text) || (e.semanticScore ?? 0) >= CONFIG.SEMANTIC_RELEVANCE_THRESHOLD) };
  const stats = { queries: research.queries, sourcesFound: research.sourcesFound, fetched: research.evidence.length, fetchedSources: research.fetchedSources ?? null, stoppedEarly: !!research.stoppedEarly, failures: (research.failures || []).length, degraded: research.degraded || [] };
  if (!research.evidence.length) {
    return { research, stats, judgeEvidence: [], final: { ...makeVerdict({ text, type, verdict: 'Unverifiable', explanation: `Meta search found ${stats.sourcesFound} source(s), but none could be fetched with a passage that touches this claim. That is different from the claim being false.`, limitations: ['No fetched passage passed relevance and screening checks. Nothing was cited.', ...((research.degraded || []).includes('semantic') ? ['Semantic search was unavailable, so only keyword-matching passages could be found; a passage worded differently from the claim would have been missed.'] : []), ...(research.failures || []).slice(0, 3).map((f) => `Fetch failed for ${f.url}: ${f.reason}`)] }), uncertainty: emptyUncertainty(), mode: 'live', research: stats, allEvidence: [] } };
  }
  return { research, stats, judgeEvidence: rankJudgeEvidence(research.evidence, text), final: null };
}

const JUDGE_MODELS = { spark: () => getModels().spark, wonder: () => getModels().wonder };
export const judgeWith = (deps) => deps.judge || ((args) => callLiveJudge(args));

async function repeatJudgeVerdicts(judge, { firstVerdict, ...judgeArgs }, runsWanted) {
  const verdicts = [firstVerdict];
  while (verdicts.length < runsWanted) {
    // A failed repeat run is a missing measurement, not a failed
    // verdict: keep the verdict already reached and report only the
    // runs that actually completed.
    try {
      const again = await judge(judgeArgs);
      verdicts.push(again.verdict);
    } catch { break; }
  }
  return verdicts;
}

export async function judgeStage(text, judgeEvidence, deps = {}) {
  const judge = judgeWith(deps);
  let result = await judge({ claim: text, evidence: judgeEvidence, model: JUDGE_MODELS.spark() });
  let judgedBy = 'Muse Spark 1.3';
  let judges;
  if (ESCALATION_VERDICTS.includes(result.verdict)) {
    const wonderResult = await judge({ claim: text, evidence: judgeEvidence, model: JUDGE_MODELS.wonder() });
    judges = { spark: result.verdict, wonder: wonderResult.verdict, agreed: result.verdict === wonderResult.verdict };
    result = wonderResult;
    judgedBy = 'Muse Wonder';
  }
  // Stability check. Only final-model runs count here. Spark and Wonder
  // disagreeing is escalation, already recorded in judges above. This
  // list asks a narrower question: does the deciding model give the
  // same verdict again on the same fetched evidence. The first final
  // result stays the record. Later runs only measure agreement, and
  // the stability gate decides what disagreement costs.
  // Repeat runs only pay off when the stability gate can act on the
  // verdict: it downgrades Supported and Contradicted, nothing else.
  const runsWanted = DECISIVE_VERDICTS.includes(result.verdict) ? Math.max(1, deps.stabilityRuns ?? CONFIG.STABILITY_RUNS) : 1;
  const finalModel = judgedBy === 'Muse Wonder' ? JUDGE_MODELS.wonder() : JUDGE_MODELS.spark();
  const verdicts = await repeatJudgeVerdicts(judge, { firstVerdict: result.verdict, claim: text, evidence: judgeEvidence, model: finalModel }, runsWanted);
  return { result, judgedBy, judges, stability: summariseStability(verdicts, runsWanted) };
}

const judgeStanceOf = (stances, e) => {
  const s = stances && stances[e.id];
  return ['supports', 'contradicts', 'misleading'].includes(s) ? s : 'unknown';
};

function partitionEvidence(res, citedList) {
  const out = { supporting: [], contradicting: [], unclassified: [] };
  for (const e of citedList || []) {
    const stamped = { ...e, stance: judgeStanceOf(res.stances, e) };
    if (stamped.stance === 'supports') out.supporting.push(stamped);
    else if (stamped.stance === 'unknown') out.unclassified.push(stamped);
    else out.contradicting.push(stamped);
  }
  return out;
}

export function gateStage(result, judgeEvidence, stability) {
  // Validate against what the judge actually saw, not the wider pool:
  // citing an unseen passage is exactly the hallucination this prevents.
  const check = validateCitations(result.citedIds || [], judgeEvidence);
  if (!check.ok) throw new JudgeError(`Judge cited unknown evidence: ${check.bad.join(',')}`);
  const byId = new Map(judgeEvidence.map((e) => [e.id, e]));
  const cited = (result.citedIds || []).map((id) => byId.get(id)).filter(Boolean).map((e) => ({ ...e, stance: judgeStanceOf(result.stances, e) }));
  return { cited, gated: applyGates({ verdict: result.verdict, cited, stability, ...partitionEvidence(result, cited), limitations: ['Verdict rests only on the fetched passages cited here, retrieved ' + new Date().toISOString().slice(0, 10) + '.'] }) };
}

async function defaultChallenge({ claim, verdict, evidence }) {
  return defaultMetaClient().completeJson({
    model: getModels().spark,
    system: CHALLENGER_SYSTEM,
    user: challengerUser({ claim, verdict, evidence }),
  });
}

export async function challengeStage(text, current, judgeEvidence, deps = {}) {
  let { cited, gated, result } = current;
  let preChallengeVerdict;
  let judgedBy;
  let judges = current.judges;
  let challenge = null;
  let revisionStability;
  const enabled = deps.challenge !== null && process.env.TRUTHLENS_NO_CHALLENGE !== '1';
  if (enabled && DECISIVE_VERDICTS.includes(gated.verdict) && cited.length) {
    const challenger = deps.challenge || defaultChallenge;
    try { challenge = await challenger({ claim: text, verdict: gated.verdict, evidence: cited }); } catch { challenge = null; }
    if (challenge?.material) {
      const judge = judgeWith(deps);
      // A failed revision is a missing second opinion, not a failed
      // investigation: keep the pre-challenge verdict, like a failed
      // challenger call above keeps it too.
      let revision = null;
      try {
        revision = await judge({ claim: text, evidence: judgeEvidence, model: JUDGE_MODELS.wonder(), challenge });
      } catch { revision = null; }
      if (!revision) { challenge = null; }
      else {
      preChallengeVerdict = gated.verdict;
      result = revision;
      judgedBy = 'Muse Wonder';
      judges = { ...(judges || {}), revision: 'Muse Wonder' };
      // The revision replaces the verdict, so it gets its own stability
      // check with the revising model. The pre-challenge stability record
      // describes a verdict that no longer stands and must not ride along.
      const runsWanted = DECISIVE_VERDICTS.includes(revision.verdict) ? Math.max(1, deps.stabilityRuns ?? CONFIG.STABILITY_RUNS) : 1;
      const revVerdicts = await repeatJudgeVerdicts(judge, { firstVerdict: revision.verdict, claim: text, evidence: judgeEvidence, model: JUDGE_MODELS.wonder(), challenge }, runsWanted);
      revisionStability = summariseStability(revVerdicts, runsWanted);
      ({ cited, gated } = gateStage(revision, judgeEvidence, revisionStability));
      gated = { ...gated, explanation: revision.explanation || gated.explanation };
      }
    } else {
      challenge = challenge && challenge.material ? challenge : null;
    }
  }
  // NLI second opinion, attached after any revision so the labels
  // describe the final cited set, not the superseded one. Agreement is
  // counted in assembleStage and reported, never gated on. A failed
  // check still changes no verdict, but it is flagged so the verdict
  // can say the second opinion is missing.
  let nliDegraded = false;
  if (deps.nli !== null && cited.length && process.env.TRUTHLENS_NO_NLI !== '1') {
    try {
      const labels = await (deps.nli || classifyStances)(cited.map((e) => [e.passage, text]));
      if (labels) {
        cited = cited.map((e, i) => ({ ...e, nli: labels[i] }));
        const nliById = new Map(cited.map((e) => [e.id, e.nli]));
        const enrich = (list) => (list || []).map((e) => (nliById.has(e.id) ? { ...e, nli: nliById.get(e.id) } : e));
        gated = { ...gated, supporting: enrich(gated.supporting), contradicting: enrich(gated.contradicting), unclassified: enrich(gated.unclassified) };
      } else {
        nliDegraded = true;
      }
    } catch { nliDegraded = true; }
  }
  return { cited, gated, result, nliDegraded, ...(judgedBy ? { judgedBy, judges } : {}), ...(revisionStability ? { stability: revisionStability } : {}), preChallengeVerdict, challenge: challenge?.material ? challenge : undefined };
}

export function assembleStage(text, { type, gated, result, judgedBy, judges, cited, judgeEvidence, stats, preChallengeVerdict, challenge, stability, nliDegraded }) {
  const degradedNotes = [];
  for (const pass of stats?.degraded || []) {
    if (pass === 'semantic') degradedNotes.push('Semantic search was unavailable, so ranking used keyword matching only.');
    if (pass === 'rerank') degradedNotes.push('Relevance reranking was unavailable, so the first ranking stood.');
  }
  if (nliDegraded) degradedNotes.push('The second-opinion stance check was unavailable.');
  const limitations = [...new Set([...(gated.limitations || []), ...degradedNotes, ...auditVerdict({ text, verdict: gated.verdict, explanation: result?.explanation, cited, supporting: gated.supporting, contradicting: gated.contradicting })])];
  const uncertainty = assessUncertainty({ cited, supporting: gated.supporting, contradicting: gated.contradicting, unclassified: gated.unclassified });
  // Judge-vs-NLI agreement over cited passages: supporting passages
  // should entail, contradicting passages should contradict. Reported
  // as a check on the judge's stance labels, never as a gate.
  const nliById = new Map((cited || []).filter((e) => e.nli).map((e) => [e.id, e.nli.label]));
  const supIds = new Set((gated.supporting || []).map((e) => e.id));
  const conIds = new Set((gated.contradicting || []).map((e) => e.id));
  let nliAgree = 0;
  for (const [id, label] of nliById) {
    if (supIds.has(id) && label === 'entailment') nliAgree++;
    else if (conIds.has(id) && label === 'contradiction') nliAgree++;
  }
  const nliChecks = nliById.size ? { checked: nliById.size, agree: nliAgree } : null;
  // A threshold exists only when the env value parses to a finite number:
  // garbage must mean "no fitted threshold", never "set but silent".
  const parsedQ = Number(process.env.TRUTHLENS_CONFORMAL_Q);
  const conformalQ = process.env.TRUTHLENS_CONFORMAL_Q && Number.isFinite(parsedQ) ? parsedQ : null;
  return {
    ...makeVerdict({
      text, type, verdict: gated.verdict, judgedBy,
      supporting: gated.supporting, contradicting: gated.contradicting, unclassified: gated.unclassified,
      explanation: result.explanation || '',
      historicalAssessment: gated.historicalAssessment, currentAssessment: gated.currentAssessment,
      limitations,
    }),
    uncertainty,
    nliChecks,
    calibration: { abstainAdvised: shouldAbstain(calibrationScore(uncertainty), conformalQ), thresholdSet: conformalQ !== null },
    forensics: investigateEvidenceChain(text, cited, { verdict: gated.verdict }),
    preChallengeVerdict, challenge, stability, promptVersion: PROMPT_VERSION,
    mode: 'live', research: stats, judges,
    allEvidence: [...(judgeEvidence || [])],
  };
}
