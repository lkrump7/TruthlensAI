import { assessDocumentClaim } from '../../../../../lib/store.mjs';
import { CONFIG } from '../../../../../lib/config.mjs';

export async function POST(req, { params }) {
  const body = await req.json().catch(() => ({}));
  const text = String(body.text || '').trim();
  if (!text) return Response.json({ error: 'Enter a claim or theory to investigate.' }, { status: 400 });
  if (text.length > CONFIG.MAX_CLAIM_CHARS) return Response.json({ error: `Submission is longer than ${CONFIG.MAX_CLAIM_CHARS} characters.` }, { status: 413 });
  let out;
  try {
    out = await assessDocumentClaim(params.id, text, { idempotencyKey: req.headers.get('idempotency-key') || undefined });
  } catch (e) {
    if (e.code === 'idempotency-conflict' || e.code === 'idempotency-in-flight') return Response.json({ error: e.message }, { status: 409 });
    throw e;
  }
  if (!out) return Response.json({ error: 'Document not found.' }, { status: 404 });
  const { chunks, ...pub } = out.doc;
  return Response.json({ claim: out.claim, document: { ...pub, chunkCount: chunks.length } });
}
