import { dismissDocumentClaim, getDocument, publicDocument } from '../../../../../../../lib/store.mjs';
import { authEnabled, canEdit, requestUser } from '../../../../../../../lib/auth.mjs';

export async function POST(req, { params }) {
  if (authEnabled() && !requestUser(req)) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const doc = await getDocument(params.id);
  if (!doc || !canEdit(doc, requestUser(req)?.username)) return Response.json({ error: 'Document or claim not found.' }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  const dismissed = body.dismissed !== false;
  let out;
  try {
    out = await dismissDocumentClaim(params.id, params.claimId, dismissed);
  } catch (e) {
    console.error(e);
    return Response.json({ error: 'Something went wrong. Try again.' }, { status: 500 });
  }
  if (!out) return Response.json({ error: 'Document or claim not found.' }, { status: 404 });
  return Response.json({ claim: out.claim, document: publicDocument(out.doc) });
}
