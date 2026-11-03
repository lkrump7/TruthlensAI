import { getDocument, publicDocument } from '../../../../../lib/documents.mjs';
import { docEvents } from '../../../../../lib/events.mjs';
import { canView, requestUser } from '../../../../../lib/auth.mjs';

export const dynamic = 'force-dynamic';

// Minimum gap between full-document sends on one stream. Rapid changes
// share a single trailing send instead of bursting full payloads.
export const MIN_INTERVAL_MS = 500;

export async function GET(req, { params }) {
  const doc = await getDocument(params.id);
  if (!doc || !canView(doc, requestUser(req)?.username)) return Response.json({ error: 'Document not found.' }, { status: 404 });
  const encoder = new TextEncoder();
  let onChanged;
  let heartbeat;
  let pending = null;
  let lastSend = 0;
  let closed = false;
  const cleanup = () => { closed = true; if (onChanged) docEvents.off('changed', onChanged); clearInterval(heartbeat); if (pending) clearTimeout(pending); };
  const stream = new ReadableStream({
    async start(controller) {
      const send = async () => {
        if (closed) return;
        try {
          const fresh = await getDocument(params.id);
          if (!fresh || closed) return;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ document: publicDocument(fresh) })}\n\n`));
          lastSend = Date.now();
        } catch (e) { console.error(`[truthlens] events stream failed for ${params.id}:`, e); }
      };
      // Trailing-edge coalescing: rapid changes share one delayed send
      // that always reads the latest state, at most one send per interval.
      const schedule = () => {
        if (closed) return;
        const wait = MIN_INTERVAL_MS - (Date.now() - lastSend);
        if (wait <= 0) { send(); return; }
        if (pending) return;
        pending = setTimeout(() => { pending = null; send(); }, wait);
      };
      await send();
      if (closed) return;
      onChanged = (id) => { if (id === params.id) schedule(); };
      docEvents.on('changed', onChanged);
      heartbeat = setInterval(() => { try { controller.enqueue(encoder.encode(': ping\n\n')); } catch { /* closed */ } }, 25000);
      req.signal?.addEventListener('abort', () => { cleanup(); try { controller.close(); } catch { /* already closed */ } });
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' } });
}
