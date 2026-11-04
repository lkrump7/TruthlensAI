import { listHistory, deleteHistoryEntries } from '../../../lib/history.mjs';
import { requestUser, canEdit } from '../../../lib/auth.mjs';
import { repository } from '../../../lib/repositories.mjs';
import { liveStatus } from '../../../lib/meta.mjs';

const mode = () => (liveStatus().configured ? 'live-ready' : 'demo');

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const owner = requestUser(req)?.username || 'demo';
    const rawLimit = url.searchParams.get('limit');
    const rawOffset = url.searchParams.get('offset');
    const parsedLimit = Number(rawLimit);
    const entries = await listHistory(owner, {
      query: url.searchParams.get('q') || url.searchParams.get('query') || '',
      verdict: url.searchParams.get('verdict') || '',
      workflow: url.searchParams.get('workflow') || '',
      limit: rawLimit === null || rawLimit === '' ? 100 : (!Number.isFinite(parsedLimit) ? 100 : Math.min(200, Math.max(1, Math.trunc(parsedLimit)))),
      offset: rawOffset === null || rawOffset === '' ? 0 : Number(rawOffset),
    });
    return Response.json({ entries, mode: mode() });
  } catch (e) { console.error(e); return Response.json({ error: 'Something went wrong. Try again.' }, { status: 500 }); }
}

export async function DELETE(req) {
  try {
    const owner = requestUser(req)?.username || 'demo';
    const username = requestUser(req)?.username ?? null;
    const url = new URL(req.url);
    let bodyIds = [];
    let singleBody = null;
    try {
      const body = await req.json();
      if (Array.isArray(body?.claimIds)) bodyIds = body.claimIds;
      else if (body?.claimIds) bodyIds = [body.claimIds];
      if (body?.claimId) singleBody = body.claimId;
    } catch { /* ids may travel on the query string instead */ }
    const queryIds = [
      ...url.searchParams.getAll('claimId'),
      ...url.searchParams.getAll('claimIds').flatMap((v) => String(v).split(',')),
    ];
    const ids = [...new Set(
      [...bodyIds, ...(singleBody ? [singleBody] : []), ...queryIds]
        .map((x) => String(x ?? '').trim())
        .filter(Boolean),
    )];
    if (!ids.length) return Response.json({ error: 'Pick a check to delete.' }, { status: 400 });
    const wanted = new Set(ids);
    const all = await repository().loadAll();
    let foundAny = false;
    for (const doc of all) {
      if (!doc || doc.kind === 'tombstone' || doc.kind === 'seed-marker') continue;
      if (!(doc.claims || []).some((c) => wanted.has(c.id))) continue;
      foundAny = true;
      const docOwner = doc.owner || 'demo';
      if (!(docOwner === owner || docOwner === 'demo')) return Response.json({ error: 'Check not found.' }, { status: 404 });
      if (!canEdit(doc, username)) return Response.json({ error: 'Check not found.' }, { status: 404 });
    }
    if (!foundAny) return Response.json({ error: 'Check not found.' }, { status: 404 });
    const out = await deleteHistoryEntries(owner, ids);
    if (!out.deleted.length) return Response.json({ error: 'Check not found.' }, { status: 404 });
    return Response.json({
      deleted: out.deleted.length === 1 ? out.deleted[0] : out.deleted,
      deletedIds: out.deleted,
      docIds: out.docIds,
    });
  } catch (e) { console.error(e); return Response.json({ error: 'Something went wrong. Try again.' }, { status: 500 }); }
}
