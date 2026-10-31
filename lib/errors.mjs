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
