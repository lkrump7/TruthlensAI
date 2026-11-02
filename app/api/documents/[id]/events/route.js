import { getDocument, publicDocument } from '../../../../../lib/documents.mjs';
import { docEvents } from '../../../../../lib/events.mjs';
import { canView, requestUser } from '../../../../../lib/auth.mjs';

export async function GET(req, { params }) {
  const doc = await getDocument(params.id);
  if (!doc || !canView(doc, requestUser(req)?.username)) return Response.json({ error: 'Document not found.' }, { status: 404 });
  const encoder = new TextEncoder();
  let onChanged;
  let heartbeat;
  let closed = false;
  const cleanup = () => { closed = true; if (onChanged) docEvents.off('changed', onChanged); clearInterval(heartbeat); };
  const stream = new ReadableStream({
    async start(controller) {
      const send = async () => {
        if (closed) return;
        try {
          const fresh = await getDocument(params.id);
          if (!fresh || closed) return;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ document: publicDocument(fresh) })}\n\n`));
        } catch (e) { console.error(`[truthlens] events stream failed for ${params.id}:`, e); }
      };
      await send();
      if (closed) return;
      let chain = Promise.resolve();
      onChanged = (id) => { if (id === params.id) chain = chain.then(send, send); };
      docEvents.on('changed', onChanged);
      heartbeat = setInterval(() => { try { controller.enqueue(encoder.encode(': ping\n\n')); } catch { /* closed */ } }, 25000);
      req.signal?.addEventListener('abort', () => { cleanup(); try { controller.close(); } catch { /* already closed */ } });
    },
    cancel() { cleanup(); },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' } });
}
