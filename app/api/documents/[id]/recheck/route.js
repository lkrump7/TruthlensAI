import { recheckDocument } from '../../../../../lib/store.mjs';

export async function POST(req, { params }) {
  const doc = await recheckDocument(params.id);
  if (!doc) return Response.json({ error: 'Document not found.' }, { status: 404 });
  const { chunks, ...pub } = doc;
  return Response.json({ document: { ...pub, chunkCount: chunks.length } });
}
