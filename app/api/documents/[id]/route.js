import { getDocument, deleteDocument, documentTextPages, publicDocument } from '../../../../lib/documents.mjs';
import { canDelete, canView, requestUser } from '../../../../lib/auth.mjs';

export async function GET(req, { params }) {
  const doc = await getDocument(params.id);
  if (!doc || !canView(doc, requestUser(req)?.username)) return Response.json({ error: 'Document not found.' }, { status: 404 });
  return Response.json({ document: { ...publicDocument(doc), contentPages: documentTextPages(doc) } });
}

export async function DELETE(req, { params }) {
  const doc = await getDocument(params.id);
  if (!doc || !canDelete(doc, requestUser(req)?.username)) return Response.json({ error: 'Document not found.' }, { status: 404 });
  const removed = await deleteDocument(params.id);
  if (!removed) return Response.json({ error: 'Document not found.' }, { status: 404 });
  return Response.json({ deleted: removed.id });
}
