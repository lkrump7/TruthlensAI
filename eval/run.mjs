import { readFileSync } from 'node:fs';

// Loads .env.local (Next does this for the server; the CLI must do it itself).
try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0 && !process.env[line.slice(0, i)]) process.env[line.slice(0, i)] = line.slice(i + 1);
  }
} catch { /* demo mode: every claim will report mode demo */ }

if (process.argv.includes('--no-challenge')) process.env.TRUTHLENS_NO_CHALLENGE = '1';
const { verifyResearchedClaim } = await import('../lib/pipeline.mjs');
const { pingForMiss } = await import('../lib/failures.mjs');
const { fitConformalThreshold, shouldAbstain, calibrationScore } = await import('../lib/calibration.mjs');
const { liveStatus } = await import('../lib/meta.mjs');
const claims = JSON.parse(readFileSync('eval/claims.json', 'utf8'));

if (!liveStatus().configured) {
  console.log('Meta live mode not configured (META_MODEL_API_URL / META_MODEL_API_KEY). Evaluation needs live research; exiting.');
  process.exit(2);
}

let agreed = 0, abstained = 0, disagreements = 0;
const rows = [];
for (const c of claims) {
  const t0 = Date.now();
  try {
    const r = await verifyResearchedClaim(c.claim);
    const ok = c.expected.includes(r.verdict);
    if (ok) agreed++;
    if (r.verdict === 'Unverifiable') abstained++;
    if (r.judges && !r.judges.agreed) disagreements++;
    const cited = [...(r.supporting || []), ...(r.contradicting || [])];
    rows.push({ label: c.label, verdict: r.verdict, ok, calibrationScore: r.uncertainty ? calibrationScore(r.uncertainty) : null, ping: ok ? null : pingForMiss(r), ms: Date.now() - t0, sources: r.research?.sourcesFound ?? 0, fetched: r.research?.fetched ?? 0, citedDomains: new Set(cited.map((e) => e.source)).size });
    console.log(`${ok ? 'PASS' : 'MISS'} [${c.label}] -> ${r.verdict} (${((Date.now() - t0) / 1000).toFixed(0)}s, ${r.research?.fetched ?? 0} fetched)${ok ? '' : ' PING: ' + pingForMiss(r)}`);
  } catch (e) {
    rows.push({ label: c.label, verdict: 'ERROR', ok: false, ping: pingForMiss(null), error: e.message });
    console.log(`ERROR [${c.label}] ${e.message} PING: Grounding`);
  }
}
const pingCounts = {};
for (const r of rows) if (r.ping) pingCounts[r.ping] = (pingCounts[r.ping] || 0) + 1;
console.log(`\nAgreement: ${agreed}/${claims.length}  Abstentions: ${abstained}  Judge disagreements: ${disagreements}`);
console.log(`Failure taxonomy (PING): ${JSON.stringify(pingCounts)}`);
const labelled = rows.filter((r) => r.calibrationScore !== null && r.calibrationScore !== undefined);
const q = fitConformalThreshold(labelled.map((r) => ({ confidence: r.calibrationScore, correct: r.ok })), 0.1);
if (q !== null) {
  const missesCaught = labelled.filter((r) => !r.ok && shouldAbstain(r.calibrationScore, q)).length;
  const misses = labelled.filter((r) => !r.ok).length;
  const correctKept = labelled.filter((r) => r.ok && !shouldAbstain(r.calibrationScore, q)).length;
  const correct = labelled.filter((r) => r.ok).length;
  console.log(`Conformal (alpha=0.1, IN-SAMPLE fit on n=${labelled.length}, not a held-out guarantee): q=${q.toFixed(3)} — would abstain on ${missesCaught}/${misses} misses, keep ${correctKept}/${correct} correct. Do not enable TRUTHLENS_CONFORMAL_Q from this fit; refit on a held-out labelled set first.`);
}
console.log(JSON.stringify(rows, null, 1));
