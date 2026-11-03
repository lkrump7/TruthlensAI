// Pure, offline-testable helpers for the eval gates. eval/run.mjs and
// eval/live-arc.mjs wire these to live runs; nothing here touches the network.

const CLAIM_PATTERN = /text: (?:'([^']+)'|"([^"]+)")/g;
const VERDICT_PATTERN = /assert\.equal\(r\.verdict, (?:'([^']+)'|"([^"]+)")\)/g;
const firstGroup = (m) => (m[1] ?? m[2]);

// Reads the three demo claims and their verdicts out of the demo test, so
// the live gate pins the same arc and cannot drift from it. Either quote
// style works per line, so a claim with an apostrophe survives in double
// quotes. Anything else fails closed with null.
export function extractDemoArc(testSource) {
  const source = String(testSource ?? '');
  const claims = [...source.matchAll(CLAIM_PATTERN)].map(firstGroup);
  const expected = [...source.matchAll(VERDICT_PATTERN)].map(firstGroup);
  if (claims.length === 3 && expected.length === claims.length) return { claims, expected };
  return null;
}

// Mirrors the eval runner: --trials=5, --trials 5, missing means 3, floor 1.
export function parseTrials(argv = process.argv) {
  const args = [...(argv || [])];
  const trialsArg = args.find((a) => typeof a === 'string' && a.startsWith('--trials'));
  return Math.max(1, Number(trialsArg?.split('=')[1] || args[args.indexOf('--trials') + 1]) || 3);
}
