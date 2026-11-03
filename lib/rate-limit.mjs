export function createBoundedLimiter({ windowMs = 60000, maxHits = 30, maxKeys = 1000 } = {}) {
  const hits = new Map();
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
    hits.set(key, list);
    if (hits.size > maxKeys) {
      const oldest = hits.keys().next().value;
      if (oldest !== key) hits.delete(oldest);
      else {
        const second = [...hits.keys()][1];
        if (second) hits.delete(second);
      }
    }
    if (list.length > maxHits) {
      if (now % 32 === 0) prune(now);
      return true;
    }
    if (hits.size % 32 === 0) prune(now);
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
