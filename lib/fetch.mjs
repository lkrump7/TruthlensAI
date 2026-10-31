// Guarded page fetching: SSRF checks, manual redirects, streamed size cap, one retry.
import { FetchError, isRetryableHttpStatus } from './errors.mjs';
export const BUDGET = { maxSources: 12, maxEvidence: 5, maxJudgeCalls: 2, maxDownloadBytes: 250000, maxRedirects: 3 };

function isPrivateV4(a, b) {
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
}

function isPrivateHost(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h.includes(':')) {
    if (h === '::' || h === '::1') return true;
    if (h.startsWith('::ffff:')) {
      const tail = h.slice('::ffff:'.length);
      const dotted = tail.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
      if (dotted) return isPrivateV4(Number(dotted[1]), Number(dotted[2]));
      const hex = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
      if (hex) {
        const hi = parseInt(hex[1], 16);
        return isPrivateV4(hi >> 8, hi & 0xff);
      }
      return false;
    }
    return h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd');
  }
  const v4 = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (v4) return isPrivateV4(Number(v4[1]), Number(v4[2]));
  return false;
}

export function assertPublicUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw new FetchError(`Blocked URL: unparseable ${url}`); }
  if (!/^https?:$/.test(u.protocol)) throw new FetchError(`Blocked URL: protocol ${u.protocol}`);
  if (isPrivateHost(u.hostname)) throw new FetchError(`Blocked private URL: ${u.hostname}`);
  return u.toString();
}

async function assertHostResolvesPublic(hostname) {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(':')) return;
  try {
    const { lookup } = await import('node:dns/promises');
    const addresses = await lookup(hostname, { all: true });
    if (addresses.some((a) => isPrivateHost(a.address))) throw new FetchError(`Blocked private URL: ${hostname} resolves to a private address`);
  } catch (e) {
    if (/Blocked private/.test(e.message)) throw e;
    // DNS lookup failed here; the fetch itself will fail and be recorded.
  }
}

async function readCapped(res, cap) {
  if (!res.body?.getReader) return (await res.text()).slice(0, cap);
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) { try { await reader.cancel(); } catch { /* already closing */ } break; }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c)))).slice(0, cap);
}

export async function fetchPageText(url) {
  let current = assertPublicUrl(url);
  for (let hop = 0; hop <= BUDGET.maxRedirects; hop++) {
    const host = new URL(current).hostname;
    await assertHostResolvesPublic(host);
    const res = await withRetry(async () => {
      const r = await fetch(current, {
        headers: { 'user-agent': 'TruthLensAI/0.1 (evidence fetcher)' },
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      });
      if (isRetryableHttpStatus(r.status)) throw new FetchError(`fetch ${r.status}`, { retryable: true });
      return r;
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc || hop === BUDGET.maxRedirects) throw new FetchError(`fetch redirect limit at ${current}`);
      current = assertPublicUrl(new URL(loc, current).toString());
      continue;
    }
    if (!res.ok) throw new FetchError(`fetch ${res.status}`);
    const type = res.headers.get('content-type') || '';
    if (!/text\/html|text\/plain|application\/xhtml/.test(type)) throw new FetchError(`unsupported content-type ${type}`);
    return readCapped(res, BUDGET.maxDownloadBytes);
  }
  throw new FetchError('fetch redirect limit');
}

const isRetryableError = (e) => e?.retryable === true || e?.name === 'TypeError' || e?.name === 'AbortError' || e?.name === 'TimeoutError';
export async function withRetry(fn, attempts = 2) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (!isRetryableError(e) || i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw last;
}
