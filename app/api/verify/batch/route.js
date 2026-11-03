import { parseClaimBatch, verifyClaimBatch, MAX_BATCH_CLAIMS } from '../../../../lib/history.mjs';
import { authEnabled, requestUser } from '../../../../lib/auth.mjs';
import { liveStatus } from '../../../../lib/meta.mjs';
import { createBoundedLimiter, clientIp, bodyTooLarge, originCheckFailed } from '../../../../lib/rate-limit.mjs';

const mode = () => (liveStatus().configured ? 'live-ready' : 'demo');

const batchLimiter = createBoundedLimiter({ windowMs: 60 * 1000, maxHits: 20, maxKeys: 1000 });
export function batchRateLimited(key) {
  return batchLimiter.check(key);
}

export const MAX_BATCH_INPUT_CHARS = 100_000;

export async function POST(req) {
  if (bodyTooLarge(req)) return Response.json({ error: 'Request body is too large.' }, { status: 413 });
  if (originCheckFailed(req)) return Response.json({ error: 'Origin check failed.' }, { status: 403 });
  if (authEnabled() && !requestUser(req)) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const ip = clientIp(req);
  if (batchRateLimited(`batch:${ip}`)) return Response.json({ error: 'Too many checks. Wait a minute and try again.' }, { status: 429, headers: { 'Retry-After': '60' } });
  const body = await req.json().catch(() => ({}));
  const raw = body.claims ?? body.text ?? '';
  const isBatchInput = typeof raw === 'string' || (Array.isArray(raw) && raw.every((x) => typeof x === 'string'));
  if (!isBatchInput) return Response.json({ error: 'Claims must be a string or an array of strings.' }, { status: 400 });
  const totalChars = typeof raw === 'string' ? raw.length : raw.reduce((n, s) => n + s.length, 0);
  if (totalChars > MAX_BATCH_INPUT_CHARS) return Response.json({ error: 'Batch input is too large. Keep it under 100,000 characters.' }, { status: 413 });
  const all = parseClaimBatch(raw, Number.MAX_SAFE_INTEGER);
  const texts = all.slice(0, MAX_BATCH_CLAIMS);
  if (!texts.length) return Response.json({ error: 'Enter at least one claim first. Put one claim per line.' }, { status: 400 });
  const owner = requestUser(req)?.username || 'demo';
  const results = await verifyClaimBatch(texts, { owner, signal: req.signal, timeoutMs: 60000 });
  return Response.json({ results, mode: mode(), limit: MAX_BATCH_CLAIMS, dropped: all.slice(MAX_BATCH_CLAIMS) });
}
