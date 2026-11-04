// Guarded page fetching: SSRF checks, manual redirects, streamed size cap, one retry.
import { FetchError, isRetryableHttpStatus } from './errors.mjs';
export const BUDGET = { maxSources: 12, maxEvidence: 5, maxDownloadBytes: 250000, maxRedirects: 3 };

function isPrivateV4(a, b) {
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
    || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0);
}

export function isPrivateHost(hostname) {
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
      return true;
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

const IPV4_LITERAL = /^\d+\.\d+\.\d+\.\d+$/;
const isIpLiteral = (hostname) => IPV4_LITERAL.test(hostname) || String(hostname).includes(':');

async function defaultLookup(hostname) {
  const { lookup } = await import('node:dns/promises');
  return lookup(hostname, { all: true });
}

function addressesOf(raw) {
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((a) => (typeof a === 'string' ? a : a?.address)).filter(Boolean);
}

// Resolve once, verify the answer is public, and return the address to
// pin the fetch to. Returns null only when there is nothing to pin (an
// IP literal, already checked public by the URL guard). A lookup error
// or an empty answer fails closed: fetching unpinned would reintroduce
// the DNS-rebinding window the pinning exists to close.
async function resolveAndPin(hostname, lookupFn) {
  if (isIpLiteral(hostname)) return null;
  let answers;
  try {
    answers = await (lookupFn || defaultLookup)(hostname);
  } catch {
    throw new FetchError(`DNS lookup failed for ${hostname}, refusing to fetch without a pinned address`);
  }
  const addresses = addressesOf(answers);
  if (!addresses.length) throw new FetchError(`DNS lookup for ${hostname} returned no addresses, refusing to fetch without a pinned address`);
  if (addresses.some((a) => isPrivateHost(a))) throw new FetchError(`Blocked private URL: ${hostname} resolves to a private address`);
  return addresses[0];
}

function pinnedTarget(urlString, pinnedAddress) {
  const u = new URL(urlString);
  if (!pinnedAddress || isIpLiteral(u.hostname)) return { url: u.toString(), hostHeader: null, servername: null };
  const ip = String(pinnedAddress).replace(/^\[|\]$/g, '');
  const literal = new URL(u.toString());
  try {
    literal.hostname = ip.includes(':') ? `[${ip}]` : ip;
  } catch {
    return { url: u.toString(), hostHeader: null, servername: null };
  }
  return { url: literal.toString(), hostHeader: u.host, servername: u.hostname };
}

let UndiciAgent = null;
let undiciRequestFn = null;
let undiciMissing = false;
async function dispatcherFor(servername, getDispatcher, injected) {
  if (!servername) return undefined;
  if (getDispatcher) return getDispatcher({ servername });
  if (injected) return injected;
  if (undiciMissing) return undefined;
  try {
    if (!UndiciAgent) ({ Agent: UndiciAgent } = await import('undici'));
    return new UndiciAgent({ connect: { servername } });
  } catch {
    undiciMissing = true;
    return undefined;
  }
}
// The Fetch spec forbids the Host header, so neither global fetch nor
// undici fetch can send the origin host over a pinned IP connection —
// and a dispatcher built by one undici copy cannot be handed to another
// copy's fetch anyway. The pinned default path therefore uses undici's
// request() (same copy that built the dispatcher), which honours an
// explicit Host header, adapted to the fetch-like shape below.
// Injected mock fetch implementations keep receiving the dispatcher
// unchanged. Exported as a test seam.
// Captured once: tests stub globalThis.fetch, which would otherwise make
// a stubbed default indistinguishable from the real default below.
const nativeFetch = fetch;
export async function fetchFor(dispatcher, fetchImpl) {
  if (!dispatcher || fetchImpl !== nativeFetch) return fetchImpl;
  if (!undiciRequestFn) ({ request: undiciRequestFn } = await import('undici'));
  const request = undiciRequestFn;
  return async (url, init = {}) => adaptRequestResponse(await request(String(url), {
    method: init.method || 'GET',
    headers: init.headers,
    signal: init.signal,
    dispatcher: init.dispatcher || dispatcher,
  }));
}

function adaptRequestResponse(r) {
  const headers = r.headers || {};
  const get = (name) => {
    const v = headers[String(name).toLowerCase()];
    return Array.isArray(v) ? v.join(', ') : (v ?? null);
  };
  const body = r.body;
  return {
    ok: r.statusCode >= 200 && r.statusCode < 300,
    status: r.statusCode,
    headers: { get },
    body: body ? {
      getReader() {
        const iter = body[Symbol.asyncIterator]();
        let finished = false;
        return {
          async read() {
            if (finished) return { done: true, value: undefined };
            const next = await iter.next();
            if (next.done) { finished = true; return { done: true, value: undefined }; }
            const v = next.value;
            return { done: false, value: Buffer.isBuffer(v) ? new Uint8Array(v.buffer, v.byteOffset, v.byteLength) : v };
          },
          async cancel() { finished = true; try { silenceStreamErrors(body); await body.destroy(); } catch { /* already closing */ } },
          releaseLock() {},
        };
      },
      async cancel() { try { silenceStreamErrors(body); await body.destroy(); } catch { /* already closing */ } },
    } : null,
  };
}

// A destroyed stream can emit its error after the destroying call has
// returned, past any try/catch around it. Undici does exactly this for
// an aborted body: with no 'error' listener the deferred emission is
// an uncaught exception and kills the process. A no-op listener keeps
// the emission from throwing. Plain (non-emitter) bodies skip quietly.
function silenceStreamErrors(stream) {
  try { stream?.once?.('error', () => {}); } catch { /* never block teardown */ }
}

function combinedSignal(outer) {
  const timeout = AbortSignal.timeout(10000);
  if (!outer) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([outer, timeout]);
  return outer.aborted ? outer : timeout;
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
  try { reader.releaseLock(); } catch { /* already released */ }
  return new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c)))).slice(0, cap);
}

// A failed or rejected response still holds its socket until the body
// is consumed or cancelled. Cancel before every throw so one bad hop
// cannot leak a connection per attempt.
// Exported as a test seam, like fetchFor above.
export async function dropBody(res) {
  try { silenceStreamErrors(res?.body); await res?.body?.cancel?.(); } catch { /* already closing */ }
}

export async function fetchPageText(url, opts = {}) {
  const { lookup, fetchImpl = fetch, dispatcher: injectedDispatcher, getDispatcher, signal: outerSignal } = opts || {};
  let current = assertPublicUrl(url);
  // A stubbed fetch is a test double, not network: pinning would run a
  // real DNS lookup the stub was meant to replace. Prod uses the native
  // fetch, so pinning stays on there. An explicit lookup always pins.
  const stubbedFetch = fetchImpl !== nativeFetch && !lookup;
  for (let hop = 0; hop <= BUDGET.maxRedirects; hop++) {
    const pinned = stubbedFetch ? null : await resolveAndPin(new URL(current).hostname, lookup);
    const target = pinnedTarget(current, pinned);
    const dispatcher = await dispatcherFor(target.servername, getDispatcher, injectedDispatcher);
    const headers = { 'user-agent': 'TruthLensAI/0.1 (evidence fetcher)' };
    if (target.hostHeader) headers.host = target.hostHeader;
    const fetchFn = await fetchFor(dispatcher, fetchImpl);
    const res = await withRetry(async () => {
      const r = await fetchFn(target.url, {
        headers,
        redirect: 'manual',
        signal: combinedSignal(outerSignal),
        ...(dispatcher ? { dispatcher } : {}),
      });
      if (isRetryableHttpStatus(r.status)) {
        await dropBody(r);
        throw new FetchError(`fetch ${r.status}`, { retryable: true });
      }
      return r;
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc || hop === BUDGET.maxRedirects) {
        await dropBody(res);
        throw new FetchError(`fetch redirect limit at ${current}`);
      }
      await dropBody(res);
      current = assertPublicUrl(new URL(loc, current).toString());
      continue;
    }
    if (!res.ok) {
      await dropBody(res);
      throw new FetchError(`fetch ${res.status}`);
    }
    const type = res.headers.get('content-type') || '';
    if (!/text\/html|text\/plain|application\/xhtml/.test(type)) {
      await dropBody(res);
      throw new FetchError(`unsupported content-type ${type}`);
    }
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
