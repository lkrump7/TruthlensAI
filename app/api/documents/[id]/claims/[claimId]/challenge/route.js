import { challengeDocumentClaim, getDocument, CHALLENGE_KINDS } from '../../../../../../../lib/store.mjs';
import { authEnabled, canView, requestUser } from '../../../../../../../lib/auth.mjs';

export async function POST(req, { params }) {
  if (authEnabled() && !requestUser(req)) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const kind = String(body.kind || '');
  if (!Object.hasOwn(CHALLENGE_KINDS, kind)) return Response.json({ error: 'Unknown challenge kind.' }, { status: 400 });
  if (kind === 'custom' && !String(body.text || '').trim()) return Response.json({ error: 'Describe what to investigate.' }, { status: 400 });
  const doc = await getDocument(params.id);
  if (!doc || !canView(doc, requestUser(req)?.username)) return Response.json({ error: 'Document or claim not found.' }, { status: 404 });
  let out;
  try { out = await challengeDocumentClaim(params.id, params.claimId, { kind, text: body.text }); } catch (e) { console.error(e); return Response.json({ error: 'Something went wrong. Try again.' }, { status: 500 }); }
  if (!out) return Response.json({ error: 'Document or claim not found.' }, { status: 404 });
  return Response.json({ claim: out.claim, followup: out.followup });
}
