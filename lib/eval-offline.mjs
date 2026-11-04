// Offline diverse eval: runs the real pipeline with injected collaborators,
// zero live credits. Search, fetch, and judge are all stubbed per case;
// relevance, gates, and rollup all execute for real.
import { verifyResearchedClaim } from './pipeline.mjs';
import { verdictAccuracy, citationValidity, evidenceCoverage } from './metrics.mjs';

const allowAll = async (texts) => (texts || []).map(() => ({ action: 'allow' }));

function stubSearch(pages, fail) {
  if (fail) return async () => { throw new Error('offline stub search outage'); };
  return async () => ({
    queries: ['stub'],
    sources: (pages || []).map((p) => ({ title: p.title, url: p.url })),
    citations: [],
  });
}

function stubFetch(pages) {
  const byUrl = new Map((pages || []).map((p) => [p.url, p.body]));
  return async (url) => {
    if (!byUrl.has(url)) throw new Error(`stub 404 for ${url}`);
    return byUrl.get(url);
  };
}

function stubJudge(spec) {
  if (!spec) return async () => { throw new Error('judge must not run without evidence'); };
  return async ({ evidence }) => {
    const ids = spec.citeAll ? (evidence || []).map((e) => e.id) : [];
    const stances = Object.fromEntries(ids.map((id) => [id, spec.stance || 'supports']));
    return { verdict: spec.verdict, citedIds: ids, stances, explanation: spec.explanation || 'stub' };
  };
}

export async function scoreOfflineEval(cases) {
  const results = [];
  let citationHits = 0;
  let citedTotal = 0;
  let fetchedTotal = 0;
  for (const c of cases) {
    const deps = {
      search: stubSearch(c.pages, c.failSearch),
      fetchText: stubFetch(c.pages),
      judge: stubJudge(c.judge),
      screenTexts: allowAll,
      embedTexts: null,
      rerankTexts: null,
      nli: null,
      challenge: null,
      cache: false,
      stabilityRuns: 1,
    };
    let r;
    try {
      r = await verifyResearchedClaim(c.claim, deps);
    } catch {
      r = {
        verdict: 'Unverifiable', mode: 'live-failed', supporting: [], contradicting: [], unclassified: [],
        allEvidence: [], limitations: ['Live research failed. Retry the claim.'],
      };
    }
    results.push(r);
    if (citationValidity(r)) citationHits++;
    const cov = evidenceCoverage(r);
    citedTotal += cov.cited;
    fetchedTotal += cov.fetched;
  }
  const expected = (cases || []).map((c) => c.expected);
  return {
    total: results.length,
    accuracy: verdictAccuracy(results, expected),
    citationRate: results.length ? citationHits / results.length : 0,
    coverage: fetchedTotal ? citedTotal / fetchedTotal : 0,
    results: results.map((r, i) => ({ label: cases[i].label, verdict: r.verdict, mode: r.mode || 'live' })),
  };
}
