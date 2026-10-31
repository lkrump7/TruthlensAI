import { verifyDocumentClaim } from '../../../../../../../lib/store.mjs';

export async function POST(req, { params }) {
  let out;
  try {
    out = await verifyDocumentClaim(params.id, params.claimId, { idempotencyKey: req.headers.get('idempotency-key') || undefined });
  } catch (e) {
    if (e.code === 'idempotency-conflict' || e.code === 'idempotency-in-flight') return Response.json({ error: e.message }, { status: 409 });
    throw e;
  }
  if (!out) return Response.json({ error: 'Document or claim not found.' }, { status: 404 });
  const { chunks, ...pub } = out.doc;
  return Response.json({ claim: out.claim, document: { ...pub, chunkCount: chunks.length } });
}
