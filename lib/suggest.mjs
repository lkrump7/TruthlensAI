import { SUGGESTER_SYSTEM, suggesterUser } from './prompts.mjs';
import { getModels, defaultMetaClient } from './meta.mjs';
import { numbersIn } from './nlp.mjs';

// Follow-up suggestions for a finished verdict. Live mode asks Muse Spark
// to reason over the claim and its fetched passages. When Meta calls are
// unavailable, localSuggestions derives narrower questions from the same
// evidence details (dates, sources, figures, gaps) and is labelled 'local'
// by every caller. It never pretends to be the model.

const clean = (value, cap) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, cap);

function normalise(list) {
  const seen = new Set();
  const out = [];
  for (const item of list || []) {
    const question = clean(item?.question, 240);
    const why = clean(item?.why, 300);
    const investigateAs = clean(item?.investigateAs, 300);
    if (!question || !why || investigateAs.length <= 5) continue;
    const key = question.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ question: question.endsWith('?') ? question : `${question}?`, why, investigateAs });
    if (out.length >= 3) break;
  }
  return out;
}

const allEvidence = (r) => [...(r.supporting || []), ...(r.contradicting || []), ...(r.unclassified || [])];
const dated = (r) => allEvidence(r).filter((e) => e.date).sort((a, b) => String(a.date).localeCompare(String(b.date)));
const claimCore = (r) => String(r.text || '').replace(/\.$/, '');

export function localSuggestions(result) {
  const r = result || {};
  const sup = r.supporting?.length || 0;
  const con = r.contradicting?.length || 0;
  const evidence = dated(r);
  const newest = evidence[evidence.length - 1];
  const sources = [...new Set(allEvidence(r).map((e) => e.source).filter(Boolean))];
  const numbers = [...new Set(numbersIn(String(r.text || '')).map((n) => String(n)))];
  const out = [];
  const add = (question, why, investigateAs) => out.push({ question, why, investigateAs });

  if (!allEvidence(r).length) {
    add(`What primary source could actually settle "${claimCore(r)}"?`,
      'No fetched passage could test this claim, so the open question is what evidence would even count.',
      `A named primary source directly tests the claim that ${claimCore(r)}`);
    if (numbers.length) add(`Where does the ${numbers[0]} figure in this claim come from, and who measured it?`,
      `The claim commits to ${numbers[0]} but no passage was fetched to trace that number.`,
      `The ${numbers[0]} figure in this claim comes from a named measurement or study`);
  }
  if (newest) {
    const year = String(newest.date).slice(0, 4);
    add(`The newest passage is ${newest.source} from ${year}. Has evidence since then changed the picture?`,
      `Every fetched passage is from ${year} or earlier, so the verdict rests on evidence of that age.`,
      `Evidence published after ${year} overturns the current verdict on the claim that ${claimCore(r)}`);
  }
  if (numbers.length && allEvidence(r).length) {
    add(`Where does the ${numbers[0]} figure come from, and was it measured the way the claim uses it?`,
      `The claim commits to ${numbers[0]}; the fetched passages answer around it without tracing the number itself.`,
      `The ${numbers[0]} figure in this claim comes from a named measurement or study`);
  }
  if (sup === 0 && con > 0) {
    add(`Every fetched passage argues one way (${sources.join(', ') || 'the cited sources'}). Is there credible evidence for the other side?`,
      `${con} contradicting and no supporting passages were fetched, so the supporting case is untested.`,
      `Credible evidence supports the claim that ${claimCore(r)}`);
  } else if (con === 0 && sup > 0) {
    add(`Only supporting passages were fetched (${sources.join(', ') || 'the cited sources'}). What is the strongest case against this?`,
      `${sup} supporting and no contradicting passages were fetched, so the opposing case is untested.`,
      `Credible evidence contradicts the claim that ${claimCore(r)}`);
  }
  if (sources.length === 1 && allEvidence(r).length) {
    add(`Everything here leans on ${sources[0]}. Would an independent source reach the same answer?`,
      'One source is doing all the work in this verdict, however good it is.',
      `An independent source separate from ${sources[0]} reaches the same conclusion on the claim that ${claimCore(r)}`);
  }
  if (r.judges && !r.judges.agreed) {
    add(`The judges split (Spark: ${r.judges.spark}; Wonder: ${r.judges.wonder}). Which passage actually separates them?`,
      'Two judges read the same passages and disagreed, so one passage is likely being read two ways.',
      `One fetched passage, read closely, settles the disagreement over the claim that ${claimCore(r)}`);
  }
  // The guide always offers three probes. Thin or balanced evidence can
  // leave fewer from the branches above, so fill the rest with probes
  // built from the claim itself rather than returning a short list.
  const fillers = [
    [`Where did the claim that ${claimCore(r)} first come from, and who put it forward?`,
      'Nothing fetched traces where this claim started, so its first source is unchecked.',
      `The claim that ${claimCore(r)} was first put forward by a named source`],
    [`What would count as evidence against the claim that ${claimCore(r)}?`,
      'No fetched passage tests this claim from the other side, so the opposing case is open.',
      `Credible evidence contradicts the claim that ${claimCore(r)}`],
    [`Has the claim that ${claimCore(r)} been tested directly, or only repeated?`,
      'Nothing fetched shows a direct test of this claim, only the claim itself.',
      `A named study tested the claim that ${claimCore(r)} directly`],
  ];
  for (const [question, why, investigateAs] of fillers) {
    if (out.length >= 3) break;
    if (out.some((s) => s.question === question)) continue;
    add(question, why, investigateAs);
  }
  return normalise(out);
}

/** @param {Record<string, any>} result @param {{ completeJson?: Function, model?: string }} [deps] */
export async function suggestFollowups(result, deps = {}) {
  const completeJson = deps.completeJson || (async ({ system, user }) => defaultMetaClient().completeJson({ model: deps.model || getModels().spark, system, user }));
  const raw = await completeJson({ model: deps.model || getModels().spark, system: SUGGESTER_SYSTEM, user: suggesterUser(result) });
  const suggestions = normalise(raw?.suggestions);
  if (!suggestions.length) throw new Error('The suggester returned no usable suggestions.');
  return { source: 'ai', model: deps.model || getModels().spark, suggestions };
}
