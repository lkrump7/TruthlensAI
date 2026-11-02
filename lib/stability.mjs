// Cross-run agreement for one claim judged on the same fetched evidence.
// A single judge run is a sample. Agreement is only claimed when more
// than one run produced the same verdict. Failed runs are missing
// measurements, counted in attempted/errors so a shortened sample is
// visible instead of silently reporting fewer runs.
export function summariseStability(verdicts = [], attempted = verdicts.length) {
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
    attempted,
    errors: Math.max(0, attempted - list.length),
  };
}
