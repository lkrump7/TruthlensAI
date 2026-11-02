import { listHistory } from '../../../lib/history.mjs';
import { requestUser } from '../../../lib/auth.mjs';
import { liveStatus } from '../../../lib/meta.mjs';

const mode = () => (liveStatus().configured ? 'live-ready' : 'demo');

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const owner = requestUser(req)?.username || 'demo';
    const entries = await listHistory(owner, {
      query: url.searchParams.get('q') || url.searchParams.get('query') || '',
      verdict: url.searchParams.get('verdict') || '',
      workflow: url.searchParams.get('workflow') || '',
      limit: Number(url.searchParams.get('limit')) || 100,
    });
    return Response.json({ entries, mode: mode() });
  } catch (e) { console.error(e); return Response.json({ error: 'Something went wrong. Try again.' }, { status: 500 }); }
}
