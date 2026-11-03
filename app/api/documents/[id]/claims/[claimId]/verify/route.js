import { verifyDocumentClaim, getDocument, publicDocument } from '../../../../../../../lib/store.mjs';
import { authEnabled, canEdit, requestUser } from '../../../../../../../lib/auth.mjs';

export async function POST(req, { params }) {
  if (authEnabled() && !requestUser(req)) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const doc = await getDocument(params.id);
  if (!doc || !canEdit(doc, requestUser(req)?.username)) return Response.json({ error: 'Document or claim not found.' }, { status: 404 });
  let out;
  try {
    out = await verifyDocumentClaim(params.id, params.claimId, { idempotencyKey: req.headers.get('idempotency-key') || undefined });
  } catch (e) {
    if (e.code === 'idempotency-conflict' || e.code === 'idempotency-in-flight') return Response.json({ error: e.message }, { status: 409 });
    console.error(e);
    return Response.json({ error: 'Something went wrong. Try again.' }, { status: 500 });
  }
  if (!out) return Response.json({ error: 'Document or claim not found.' }, { status: 404 });
  return Response.json({ claim: out.claim, document: publicDocument(out.doc) });
}
