// Cross-run agreement for one claim judged on the same fetched evidence.
// A single judge run is a sample. Agreement is only claimed when more
// than one run produced the same verdict.
export function summariseStability(verdicts = []) {
  const list = [...verdicts];
  const counts = new Map();
  for (const v of list) counts.set(v, (counts.get(v) || 0) + 1);
  let majority = list[0];
  let best = 0;
  for (const [v, n] of counts) if (n > best) { best = n; majority = v; }
  return {
    runs: list.length,
    verdicts: list,
    agreed: list.length > 1 && best === list.length,
    majority,
  };
}
