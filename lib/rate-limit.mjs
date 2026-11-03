export function createBoundedLimiter({ windowMs = 60000, maxHits = 30, maxKeys = 1000 } = {}) {
  const hits = new Map();
  let calls = 0;
  const PRUNE_EVERY = 32;
  function prune(now) {
    for (const [key, times] of hits) {
      const fresh = times.filter((t) => now - t < windowMs);
      if (!fresh.length) hits.delete(key);
      else if (fresh.length !== times.length) hits.set(key, fresh);
    }
    while (hits.size > maxKeys) {
      const oldest = hits.keys().next().value;
      hits.delete(oldest);
    }
  }
  function check(key) {
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
    list.push(now);
    if (list.length > maxHits + 1) list.splice(0, list.length - (maxHits + 1));
    // Refresh recency on every hit: eviction below removes the
    // least-recently-used key, so a flood of distinct keys displaces idle
    // buckets first and can never wash a hot bucket clean.
    hits.delete(key);
    hits.set(key, list);
    if (hits.size > maxKeys) {
      const oldest = hits.keys().next().value;
      if (oldest !== key) hits.delete(oldest);
      else {
        const second = [...hits.keys()][1];
        if (second) hits.delete(second);
      }
    }
    calls += 1;
    if (calls % PRUNE_EVERY === 0) prune(now);
    if (list.length > maxHits) return true;
    return false;
  }
  function size() {
    return hits.size;
  }
  function clear() {
    hits.clear();
  }
  return { check, size, clear };
}

export function clientIp(req, fallback = 'local') {
  const raw = req?.headers?.get?.('x-forwarded-for') || '';
  const first = String(raw).split(',')[0].trim().slice(0, 45);
  if (!first) return fallback;
  if (!/^[a-zA-Z0-9.:_%-]+$/.test(first)) return fallback;
  return first.toLowerCase();
}

export const MAX_JSON_BODY_BYTES = 1_000_000;

// Pre-check before req.json(): rejects declared-huge bodies without parsing.
export function bodyTooLarge(req, maxBytes = MAX_JSON_BODY_BYTES) {
  const len = Number(req?.headers?.get?.('content-length'));
  return Number.isFinite(len) && len > maxBytes;
}

// Same-origin check for state-changing POSTs. Requests without an Origin
// header (curl, server-to-server, same-origin navigations that omit it)
// pass; a present but unparsable or foreign Origin fails closed.
export function originCheckFailed(req) {
  const origin = req?.headers?.get?.('origin');
  if (!origin) return false;
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    return true;
  }
  const host = req?.headers?.get?.('host') || (() => {
    try {
      return new URL(req.url).host;
    } catch {
      return '';
    }
  })();
  return originHost !== host;
}
