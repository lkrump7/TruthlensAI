import { parseClaimBatch, verifyClaimBatch, MAX_BATCH_CLAIMS } from '../../../../lib/history.mjs';
import { authEnabled, requestUser } from '../../../../lib/auth.mjs';
import { liveStatus } from '../../../../lib/meta.mjs';

const mode = () => (liveStatus().configured ? 'live-ready' : 'demo');

const batchAttempts = new Map();
export function batchRateLimited(key) {
  const now = Date.now();
  const hits = (batchAttempts.get(key) || []).filter((t) => now - t < 60 * 1000);
  hits.push(now);
  batchAttempts.set(key, hits);
  return hits.length > 20;
}

export async function POST(req) {
  if (authEnabled() && !requestUser(req)) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  if (batchRateLimited(`batch:${ip}`)) return Response.json({ error: 'Too many checks. Wait a minute and try again.' }, { status: 429, headers: { 'Retry-After': '60' } });
  const body = await req.json().catch(() => ({}));
  const all = parseClaimBatch(body.claims ?? body.text ?? '', Number.MAX_SAFE_INTEGER);
  const texts = all.slice(0, MAX_BATCH_CLAIMS);
  if (!texts.length) return Response.json({ error: 'Enter at least one claim first. Put one claim per line.' }, { status: 400 });
  const owner = requestUser(req)?.username || 'demo';
  const results = await verifyClaimBatch(texts, { owner, signal: req.signal, timeoutMs: 60000 });
  return Response.json({ results, mode: mode(), limit: MAX_BATCH_CLAIMS, dropped: all.slice(MAX_BATCH_CLAIMS) });
}
