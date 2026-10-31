import { listDocuments } from '../../../lib/store.mjs';
import { buildContradictionMap } from '../../../lib/contradictions.mjs';
import { currentUser } from '../../../lib/auth.mjs';

export async function GET(req) {
  const user = currentUser(req);
  const docs = await listDocuments(user?.username || 'demo');
  return Response.json({ entries: buildContradictionMap(docs) });
}
