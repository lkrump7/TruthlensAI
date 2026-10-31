import { MetaApiError } from './errors.mjs';

// Circuit breaker: after `threshold` consecutive retryable failures the
// circuit opens and calls fail fast; after `cooldownMs` one probe call
// decides whether it closes again. Non-retryable failures never count.
const RETRYABLE_NAMES = new Set(['TypeError', 'AbortError', 'TimeoutError']);
const isRetryableFailure = (e) => e?.retryable === true || RETRYABLE_NAMES.has(e?.name);

export function createBreaker({ threshold = 3, cooldownMs = 30000 } = {}) {
  let failures = 0;
  let openedAt = 0;
  let probing = false;
  const openError = () => new MetaApiError('Meta provider circuit open: failing fast until the cooldown probe.', { retryable: false, code: 'circuit-open' });
  return {
    async exec(fn) {
      if (openedAt && Date.now() - openedAt < cooldownMs) throw openError();
      if (openedAt && probing) throw openError();
      const isProbe = !!openedAt;
      if (isProbe) probing = true;
      try {
        const out = await fn();
        failures = 0; openedAt = 0; probing = false;
        return out;
      } catch (e) {
        probing = false;
        if (isRetryableFailure(e)) {
          failures++;
          if (failures >= threshold || isProbe) openedAt = Date.now();
        }
        throw e;
      }
    },
    get open() { return !!openedAt && Date.now() - openedAt < cooldownMs; },
  };
}
