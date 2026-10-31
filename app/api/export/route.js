import { getDocument } from '../../../lib/documents.mjs';
import { buildInvestigationReport } from '../../../lib/export.mjs';
import { canView, requestUser } from '../../../lib/auth.mjs';

// Returns the investigation report for a stored verdict as a Markdown
// download. The client names a document and a claim. The report renders
// the claim held on that document, never a record the client posts.
export async function POST(req) {
  const { docId, claimId } = await req.json().catch(() => ({}));
  if (!docId || !claimId) return Response.json({ error: 'No investigation to export.' }, { status: 400 });
  const doc = await getDocument(docId);
  if (!doc || !canView(doc, requestUser(req)?.username)) return Response.json({ error: 'Document not found.' }, { status: 404 });
  const claim = (doc.claims || []).find((c) => c.id === claimId);
  if (!claim) return Response.json({ error: 'Claim not found.' }, { status: 404 });
  if (!claim.verdict) return Response.json({ error: 'This claim has no verdict yet.' }, { status: 422 });
  const md = buildInvestigationReport(claim);
  return new Response(md, {
    headers: {
      'content-type': 'text/markdown; charset=utf-8',
      'content-disposition': 'attachment; filename="truthlens-investigation.md"',
    },
  });
}
