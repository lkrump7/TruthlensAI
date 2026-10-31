import { scoreClaimPriority } from './claims.mjs';

// Evidence Intelligence Report: distributions and significance first.
// Deliberately no single truth score — a consequential false claim
// must never be averaged away by many correct trivial ones.
const DISPUTED = ['Contradicted', 'Partially supported', 'Misleading', 'Outdated'];

export function buildReport(claims = []) {
  const distribution = {};
  for (const c of claims) distribution[c.verdict] = (distribution[c.verdict] || 0) + 1;
  const investigated = claims.filter((c) => c.verdict !== 'Unverifiable' && c.verdict !== 'Not fact-checkable').length;
  const highImpactDisputed = claims
    .filter((c) => DISPUTED.includes(c.verdict))
    .map((c) => ({ id: c.id, text: c.text, page: c.page, verdict: c.verdict, score: scoreClaimPriority(c) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  return {
    totalClaims: claims.length,
    investigated,
    distribution,
    evidenceCoverage: claims.length ? Math.round((investigated / claims.length) * 100) : 0,
    highImpactDisputed,
    internalContradictions: claims.filter((c) => c.internalContradiction).map((c) => ({ id: c.id, text: c.text, page: c.page })),
  };
}
