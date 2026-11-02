import { recheckDocument, getDocument, publicDocument } from '../../../../../lib/store.mjs';
import { canView, requestUser } from '../../../../../lib/auth.mjs';

export async function POST(req, { params }) {
  const existing = await getDocument(params.id);
  if (!existing || !canView(existing, requestUser(req)?.username)) return Response.json({ error: 'Document not found.' }, { status: 404 });
  let doc;
  try { doc = await recheckDocument(params.id); } catch (e) { console.error(e); return Response.json({ error: 'Something went wrong. Try again.' }, { status: 500 }); }
  if (!doc) return Response.json({ error: 'Document not found.' }, { status: 404 });
  return Response.json({ document: publicDocument(doc) });
}
