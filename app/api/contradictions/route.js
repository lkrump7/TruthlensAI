import { listDocuments } from '../../../lib/store.mjs';
import { buildContradictionMap } from '../../../lib/contradictions.mjs';
import { requestUser } from '../../../lib/auth.mjs';

export async function GET(req) {
  try {
    const user = requestUser(req);
    const docs = await listDocuments(user?.username || 'demo');
    return Response.json({ entries: buildContradictionMap(docs) });
  } catch (e) { console.error(e); return Response.json({ error: 'Something went wrong. Try again.' }, { status: 500 }); }
}
