import { readFileSync } from 'node:fs';

// Loads .env.local (Next does this for the server; the CLI must do it itself).
try {
  for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
    const i = line.indexOf('=');
    if (i > 0 && !process.env[line.slice(0, i)]) process.env[line.slice(0, i)] = line.slice(i + 1);
  }
} catch { /* no .env.local: live mode is not configured */ }

const { verifyResearchedClaim } = await import('../lib/research.mjs');
const { liveStatus } = await import('../lib/meta.mjs');

if (!liveStatus().configured) {
  console.log('Meta live mode not configured (META_MODEL_API_URL / META_MODEL_API_KEY). Live demo-arc gate needs a Meta key; exiting.');
  process.exit(1);
}

// The demo claims and their acceptable verdicts come from the demo test,
// so the live gate pins the same arc and cannot drift from it.
const testSource = readFileSync(new URL('../tests/demo-arc.test.mjs', import.meta.url), 'utf8');
const claims = [...testSource.matchAll(/text: '([^']+)'/g)].map((m) => m[1]);
const expected = [...testSource.matchAll(/assert\.equal\(r\.verdict, '([^']+)'\)/g)].map((m) => m[1]);
if (claims.length !== 3 || expected.length !== claims.length) {
  console.log('Could not read the three demo claims from tests/demo-arc.test.mjs. Live demo-arc gate cannot run; exiting.');
  process.exit(1);
}

let failed = 0;
for (let i = 0; i < claims.length; i++) {
  try {
    const r = await verifyResearchedClaim(claims[i]);
    const ok = r.verdict === expected[i];
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}: ${claims[i]} -> ${r.verdict} (expected ${expected[i]})`);
  } catch (e) {
    failed++;
    console.log(`FAIL: ${claims[i]} -> ERROR ${e.message} (expected ${expected[i]})`);
  }
}
console.log(`Live demo arc: ${claims.length - failed}/${claims.length} passed.`);
process.exit(failed ? 1 : 0);
