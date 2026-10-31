import { verifyClaim, DEMO_EVIDENCE } from '../../../../lib/engine.mjs';
import { liveStatus, getModels } from '../../../../lib/meta.mjs';
import { verifyResearchedClaim } from '../../../../lib/research.mjs';
import { CONFIG } from '../../../../lib/config.mjs';



// Streaming twin of POST /api/verify. Progress events name only stages
// that have finished, with the counts that stage produced. The final
// verdict event carries the same record the blocking route returns.
// Nothing here judges anything the pipeline did not judge.
export async function POST(req) {
  const { claim } = await req.json().catch(() => ({}));
  if (!claim || !String(claim).trim()) return Response.json({ error: 'Enter a claim first.' }, { status: 400 });
  if (String(claim).length > CONFIG.MAX_CLAIM_CHARS) return Response.json({ error: `Claim is longer than ${CONFIG.MAX_CLAIM_CHARS} characters.` }, { status: 413 });
  const text = String(claim).trim();
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
          send({ kind: 'verdict', result: { ...base, mode: 'demo', models: getModels(), missing: status.missing } });
        } else {
          const live = await verifyResearchedClaim(text, {
            onProgress: (stage, detail) => send({ kind: 'progress', stage, detail: detail || {} }),
          });
          send({ kind: 'verdict', result: { ...live, models: getModels() } });
        }
      } catch (err) {
        send({ kind: 'error', error: err?.message || 'Verification failed.' });
      } finally {
        try { controller.close(); } catch { /* already closed */ }
      }
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' } });
}
