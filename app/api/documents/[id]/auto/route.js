import { setAutoPaused } from '../../../../../lib/store.mjs';

export async function POST(req, { params }) {
  const body = await req.json().catch(() => ({}));
  const doc = await setAutoPaused(params.id, !!body.paused);
  if (!doc) return Response.json({ error: 'Document not found.' }, { status: 404 });
  const { chunks, ...pub } = doc;
  return Response.json({ document: { ...pub, chunkCount: chunks.length } });
}
