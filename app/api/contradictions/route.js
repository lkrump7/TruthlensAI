import { listDocuments } from '../../../lib/store.mjs';
import { buildContradictionMap } from '../../../lib/contradictions.mjs';
import { canView, requestUser } from '../../../lib/auth.mjs';

export async function GET(req) {
  try {
    const user = requestUser(req);
    const username = user?.username || 'demo';
    const docs = await listDocuments(username);
    const visible = docs.filter((d) => canView(d, username));
    return Response.json({ entries: buildContradictionMap(visible) });
  } catch (e) { console.error(e); return Response.json({ error: 'Something went wrong. Try again.' }, { status: 500 }); }
}
