// Typed errors. Callers decide retry and reporting from the type and the
// retryable flag — never from matching words in a message string.
export class TruthLensError extends Error {
  constructor(message, { retryable = false, code = 'truthlens' } = {}) {
    super(message);
    this.name = new.target.name;
    this.retryable = retryable;
    this.code = code;
  }
}
export class FetchError extends TruthLensError {
  constructor(message, opts = {}) { super(message, { code: 'fetch', ...opts }); }
}
export class MetaApiError extends TruthLensError {
  constructor(message, opts = {}) { super(message, { code: 'meta-api', ...opts }); }
}
export class JudgeError extends TruthLensError {
  constructor(message, opts = {}) { super(message, { code: 'judge', ...opts }); }
}
export const isRetryableHttpStatus = (status) => status === 429 || status >= 500;

// The persisted shape of a live-research failure. Raw error text (tmp
// paths, provider bodies, errno strings) must never reach history rows,
// SSE events, or client JSON: call sites log err server-side and store
// only this generic wording. The "Live research failed" prefix is kept
// so readers still learn nothing was judged, rather than judged clean.
export function liveFailedResult(text, err, { type = 'Unclassified' } = {}) {
  if (err !== undefined) console.error('[truthlens] live research failed:', String(err?.message || err || 'unknown error').slice(0, 2000));
  return {
    text: String(text), type, verdict: 'Unverifiable', judgedBy: 'Muse Spark 1.3',
    supporting: [], contradicting: [], mode: 'live-failed',
    explanation: 'Live research failed, so no verdict was produced rather than falling back to a canned one.',
    limitations: ['Live research failed. Retry the claim.'],
  };
}
