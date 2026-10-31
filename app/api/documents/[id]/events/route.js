import { getDocument } from '../../../../../lib/documents.mjs';
import { docEvents } from '../../../../../lib/events.mjs';

export async function GET(req, { params }) {
  const doc = await getDocument(params.id);
  if (!doc) return Response.json({ error: 'Document not found.' }, { status: 404 });
  const encoder = new TextEncoder();
  let onChanged;
  let heartbeat;
  let closed = false;
  const cleanup = () => { closed = true; if (onChanged) docEvents.off('changed', onChanged); clearInterval(heartbeat); };
  const stream = new ReadableStream({
    async start(controller) {
      const send = async () => {
        const fresh = await getDocument(params.id);
        if (!fresh || closed) return;
        const { chunks, ...rest } = fresh;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ document: { ...rest, chunkCount: chunks.length } })}\n\n`));
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
