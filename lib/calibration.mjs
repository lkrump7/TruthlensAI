// Split-conformal abstention (after Tayebati et al., arXiv:2502.06884):
// fit a nonconformity quantile on labelled correct verdicts, then advise
// abstention when a new verdict's nonconformity exceeds it. With n correct
// calibration samples and target miscoverage alpha, the rank is
// ceil((n+1)(1-alpha)) — a distribution-free coverage statement, unlike a
// hand-picked confidence cutoff. No fitted threshold ships by default:
// without a labelled calibration set the honest output is no advice.
// Scalar nonconformity input for calibration only. It is deliberately not
// a reported "confidence": the two signals stay separate everywhere a user
// or report sees them (PRINCIPLES §14).
export function calibrationScore(uncertainty) {
  if (!uncertainty) return 0;
  return Math.min(uncertainty.faithfulness?.score ?? 0, uncertainty.evidenceStrength?.score ?? 0);
}

export function fitConformalThreshold(samples, alpha = 0.1) {
  // alpha is a miscoverage rate: outside (0, 1) it names no quantile.
  // Non-finite confidences are dropped, never sorted into the quantile,
  // where NaN would silently poison the ordering.
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 1) return null;
  const scores = (samples || []).filter((s) => s.correct && Number.isFinite(s.confidence)).map((s) => 1 - s.confidence).sort((a, b) => a - b);
  if (!scores.length) return null;
  const rank = Math.ceil((scores.length + 1) * (1 - alpha));
  // rank > n means the finite-sample threshold is +infinity: no honest
  // finite threshold exists at this alpha with so few samples.
  if (rank > scores.length) return null;
  return scores[rank - 1];
}

export function shouldAbstain(confidence, threshold) {
  if (!Number.isFinite(threshold) || !Number.isFinite(confidence)) return false;
  return 1 - confidence > threshold;
}
