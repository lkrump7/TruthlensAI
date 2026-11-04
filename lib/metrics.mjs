// System-wide accuracy metrics: same scoring for any claim, any user.
// Verdict correctness, citation integrity, and evidence coverage stay separate
// so a retrieval miss never looks like a judging miss.
export function verdictAccuracy(results, expectedLists) {
  const list = results || [];
  if (!list.length) return 0;
  let hit = 0;
  for (let i = 0; i < list.length; i++) {
    const expected = (expectedLists || [])[i] || [];
    if (expected.includes(list[i]?.verdict)) hit++;
  }
  return hit / list.length;
}

const citedOf = (result) => [
  ...((result || {}).supporting || []),
  ...((result || {}).contradicting || []),
  ...((result || {}).unclassified || []),
];

export function citationValidity(result) {
  const cited = citedOf(result);
  if (['Supported', 'Contradicted', 'Partially supported', 'Misleading', 'Outdated'].includes(result?.verdict) && cited.length === 0) return false;
  if (!cited.length) return true;
  const known = new Set(((result || {}).allEvidence || []).map((e) => e.id));
  return cited.every((e) => e.id && e.passage && e.url && (known.size === 0 || known.has(e.id)));
}

export function evidenceCoverage(result) {
  const fetched = ((result || {}).allEvidence || []).length;
  const cited = citedOf(result).length;
  return { fetched, cited, coverage: fetched ? cited / fetched : 0 };
}
