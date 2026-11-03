import { verifyClaim, DEMO_EVIDENCE } from '../../../../lib/engine.mjs';
import { liveStatus, getModels } from '../../../../lib/meta.mjs';
import { verifyResearchedClaim } from '../../../../lib/research.mjs';
import { CONFIG } from '../../../../lib/config.mjs';
import { recordInvestigation, findHistoryByKey, replayModeLabel } from '../../../../lib/history.mjs';
import { authEnabled, requestUser } from '../../../../lib/auth.mjs';
import { createBoundedLimiter, clientIp, bodyTooLarge, originCheckFailed } from '../../../../lib/rate-limit.mjs';



// Streaming twin of POST /api/verify. Progress events name only stages
// that have finished, with the counts that stage produced. The final
// verdict event carries the same record the blocking route returns.
// Nothing here judges anything the pipeline did not judge.
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

const streamLimiter = createBoundedLimiter({ windowMs: 60 * 1000, maxHits: 30, maxKeys: 1000 });
export function streamRateLimited(key) {
  return streamLimiter.check(key);
}

export async function POST(req) {
  if (bodyTooLarge(req)) return Response.json({ error: 'Request body is too large.' }, { status: 413 });
  if (originCheckFailed(req)) return Response.json({ error: 'Origin check failed.' }, { status: 403 });
  if (authEnabled() && !requestUser(req)) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const ip = clientIp(req);
  if (streamRateLimited(`stream:${ip}`)) return Response.json({ error: 'Too many checks. Wait a minute and try again.' }, { status: 429, headers: { 'Retry-After': '60' } });
  const { claim } = await req.json().catch(() => ({}));
  if (typeof claim !== 'string' || !claim.trim()) return Response.json({ error: 'Enter a claim first.' }, { status: 400 });
  const text = claim.trim();
  if (text.length > CONFIG.MAX_CLAIM_CHARS) return Response.json({ error: `Claim is longer than ${CONFIG.MAX_CLAIM_CHARS} characters.` }, { status: 413 });
  const idempotencyKey = req.headers.get('idempotency-key');
  if (idempotencyKey) {
    const replay = await findHistoryByKey(requestUser(req)?.username || 'demo', idempotencyKey).catch(() => null);
    if (replay && replay.claim.text === text) {
      const { mode: _m, models: _mo, missing: _mi, nliChecks: _n, history: _h, ...verdictOnly } = replay.claim;
      const result = { ...verdictOnly, history: replay.claim.history, mode: replayModeLabel(), models: getModels(), historyClaimId: replay.claim.id, historyDocId: replay.doc.id };
      const encoder = new TextEncoder();
      const replayStream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ kind: 'verdict', result })}\n\n`));
          controller.close();
        },
      });
      return new Response(replayStream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' } });
    }
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj) => { try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)); } catch { /* client left */ } };
      try {
        const status = liveStatus();
        if (!status.configured) {
          // Demo mode runs the curated demo engine, not the LangGraph
          // stages. It emits no progress stages and no trajectory,
          // because naming stages that never ran would be a false claim.
          const base = await verifyClaim({ text }, DEMO_EVIDENCE);
          send({ kind: 'verdict', result: await remember(req, { ...base, mode: 'demo', models: getModels(), missing: status.missing }, idempotencyKey) });
        } else {
          const live = await verifyResearchedClaim(text, {
            onProgress: (stage, detail) => send({ kind: 'progress', stage, detail: detail || {} }),
          });
          send({ kind: 'verdict', result: await remember(req, { ...live, models: getModels() }, idempotencyKey) });
        }
      } catch (err) {
        // Raw error text (paths, provider bodies) stays in the server log;
        // the SSE client gets a generic message that names no internals.
        console.error('[truthlens] verify stream failed:', String(err?.message || err || 'unknown error').slice(0, 2000));
        send({ kind: 'error', error: 'Verification failed. Try again.' });
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' } });
}
