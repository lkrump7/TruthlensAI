import { challengeDocumentClaim, CHALLENGE_KINDS } from '../../../../../../../lib/store.mjs';

export async function POST(req, { params }) {
  const body = await req.json().catch(() => ({}));
  const kind = String(body.kind || '');
  if (!Object.hasOwn(CHALLENGE_KINDS, kind)) return Response.json({ error: 'Unknown challenge kind.' }, { status: 400 });
  if (kind === 'custom' && !String(body.text || '').trim()) return Response.json({ error: 'Describe what to investigate.' }, { status: 400 });
  const out = await challengeDocumentClaim(params.id, params.claimId, { kind, text: body.text });
  if (!out) return Response.json({ error: 'Document or claim not found.' }, { status: 404 });
  return Response.json({ claim: out.claim, followup: out.followup });
}
