import { scoreClaimPriority } from './claims.mjs';
import { ESCALATION_VERDICTS } from './config.mjs';

// Evidence Intelligence Report: distributions and significance first.
// Deliberately no single truth score — a consequential false claim
// must never be averaged away by many correct trivial ones.
// Only verified claims count toward verdicts and coverage; pending and
// not-yet-verified claims are reported as exactly that.
const DISPUTED = ESCALATION_VERDICTS;
const isVerified = (c) => !c.status || c.status === 'verified';
const isReader = (c) => c.source === 'reader-pick' || c.source === 'reader-submitted';
const isActive = (c) => !c?.dismissed;

export function buildReport(claims = []) {
  const active = (claims || []).filter(isActive);
  const verified = active.filter(isVerified);
  const distribution = {};
  for (const c of verified) if (c.verdict) distribution[c.verdict] = (distribution[c.verdict] || 0) + 1;
  // Investigated means a verdict was reached — Unverifiable included.
  // It is the honest outcome of an investigation, not a missing one
  // (PRINCIPLES 12: coverage counts only investigated claims, and every
  // verdict-bearing claim was investigated).
  const investigated = verified.filter((c) => c.verdict).length;
  const resolved = verified.filter((c) => c.verdict && c.verdict !== 'Unverifiable' && c.verdict !== 'Not fact-checkable').length;
  const highImpactDisputed = verified
    .filter((c) => DISPUTED.includes(c.verdict))
    .map((c) => ({ id: c.id, text: c.text, page: c.page, verdict: c.verdict, score: scoreClaimPriority(c) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  return {
    totalClaims: active.length,
    investigated,
    resolved,
    distribution,
    evidenceCoverage: active.length ? Math.round((investigated / active.length) * 100) : 0,
    highImpactDisputed,
    internalContradictions: active.filter((c) => c.internalContradiction).map((c) => ({ id: c.id, text: c.text, page: c.page })),
    pendingClaims: active.filter((c) => c.status === 'pending').length,
    notYetVerified: active.filter((c) => c.status === 'unverified' || c.status === 'pending').length,
    autoVerified: verified.filter((c) => !isReader(c)).length,
    readerInvestigated: verified.filter(isReader).length,
    dismissed: (claims || []).length - active.length,
  };
}
