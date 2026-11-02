import { parseClaimBatch, verifyClaimBatch } from '../../../../lib/history.mjs';
import { authEnabled, requestUser } from '../../../../lib/auth.mjs';
import { liveStatus } from '../../../../lib/meta.mjs';

const mode = () => (liveStatus().configured ? 'live-ready' : 'demo');

export async function POST(req) {
  if (authEnabled() && !requestUser(req)) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const texts = parseClaimBatch(body.claims ?? body.text ?? '');
  if (!texts.length) return Response.json({ error: 'Enter at least one claim first. Put one claim per line.' }, { status: 400 });
  const owner = requestUser(req)?.username || 'demo';
  const results = await verifyClaimBatch(texts, { owner });
  return Response.json({ results, mode: mode() });
}
