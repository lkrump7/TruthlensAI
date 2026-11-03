import { verifyClaim, DEMO_EVIDENCE } from '../../../lib/engine.mjs';
import { liveStatus, getModels } from '../../../lib/meta.mjs';
import { verifyResearchedClaim } from '../../../lib/research.mjs';
import { CONFIG } from '../../../lib/config.mjs';
import { recordInvestigation, findHistoryByKey, replayModeLabel } from '../../../lib/history.mjs';
import { authEnabled, requestUser } from '../../../lib/auth.mjs';
import { createBoundedLimiter, clientIp, bodyTooLarge, originCheckFailed } from '../../../lib/rate-limit.mjs';
import { liveFailedResult } from '../../../lib/errors.mjs';

async function remember(req, result, idempotencyKey) {
  try {
    const saved = await recordInvestigation({ owner: requestUser(req)?.username || 'demo', workflow: 'claim', result, idempotencyKey });
    return { ...result, historyClaimId: saved.claim.id, historyDocId: saved.doc.id };
  } catch (err) {
    if (err?.code === 'idempotency-conflict') throw err;
    console.error('[truthlens] history record failed:', err);
    return result;
  }
}

const verifyLimiter = createBoundedLimiter({ windowMs: 60 * 1000, maxHits: 30, maxKeys: 1000 });
export function verifyRateLimited(key) {
  return verifyLimiter.check(key);
}

export async function POST(req) {
  if (bodyTooLarge(req)) return Response.json({ error: 'Request body is too large.' }, { status: 413 });
  if (originCheckFailed(req)) return Response.json({ error: 'Origin check failed.' }, { status: 403 });
  if (authEnabled() && !requestUser(req)) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const ip = clientIp(req);
  if (verifyRateLimited(`verify:${ip}`)) return Response.json({ error: 'Too many checks. Wait a minute and try again.' }, { status: 429, headers: { 'Retry-After': '60' } });
  const { claim } = await req.json().catch(() => ({}));
  if (typeof claim !== 'string' || !claim.trim()) return Response.json({ error: 'Enter a claim first.' }, { status: 400 });
  const text = claim.trim();
  if (text.length > CONFIG.MAX_CLAIM_CHARS) return Response.json({ error: `Claim is longer than ${CONFIG.MAX_CLAIM_CHARS} characters.` }, { status: 413 });
  const idempotencyKey = req.headers.get('idempotency-key');
  if (idempotencyKey) {
    const replay = await findHistoryByKey(requestUser(req)?.username || 'demo', idempotencyKey).catch(() => null);
    if (replay && replay.claim.text === text) {
      const { mode: _m, models: _mo, missing: _mi, nliChecks: _n, history: _h, ...verdictOnly } = replay.claim;
      return Response.json({ ...verdictOnly, history: replay.claim.history, mode: replayModeLabel(), models: getModels(), historyClaimId: replay.claim.id, historyDocId: replay.doc.id });
    }
  }
  const status = liveStatus();
  if (!status.configured) {
    const base = await verifyClaim({ text }, DEMO_EVIDENCE);
    try {
      return Response.json(await remember(req, { ...base, mode: 'demo', models: getModels(), missing: status.missing }, idempotencyKey));
    } catch (err) {
      if (err?.code === 'idempotency-conflict') return Response.json({ error: err.message }, { status: 409 });
      throw err;
    }
  }
  try {
    const live = await verifyResearchedClaim(text);
    try {
      return Response.json(await remember(req, { ...live, models: getModels() }, idempotencyKey));
    } catch (err) {
      if (err?.code === 'idempotency-conflict') return Response.json({ error: err.message }, { status: 409 });
      throw err;
    }
  } catch (err) {
    if (err?.code === 'idempotency-conflict') return Response.json({ error: err.message }, { status: 409 });
    return Response.json(await remember(req, { ...liveFailedResult(text, err, { type: 'Scientific' }), models: getModels() }, idempotencyKey));
  }
}
