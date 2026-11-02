import { createDocument, publicDocument } from '../../../../lib/store.mjs';
import { fetchWebsitePages, WebsiteError } from '../../../../lib/website.mjs';
import { FetchError } from '../../../../lib/errors.mjs';
import { liveStatus, getModels } from '../../../../lib/meta.mjs';
import { authEnabled, requestUser } from '../../../../lib/auth.mjs';
import { CONFIG } from '../../../../lib/config.mjs';

const mode = () => (liveStatus().configured ? 'live-ready' : 'demo');

export async function POST(req) {
  if (authEnabled() && !requestUser(req)) return Response.json({ error: 'Sign in first.' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const url = String(body.url || '').trim();
  if (!url) return Response.json({ error: 'Paste a website address first.' }, { status: 400 });
  let site;
  try {
    site = await fetchWebsitePages(url);
  } catch (e) {
    if (e instanceof WebsiteError) return Response.json({ error: e.message }, { status: 422 });
    if (e instanceof FetchError) {
      const status = /Blocked/.test(e.message) ? 400 : 422;
      return Response.json({ error: status === 400 ? e.message : `That page could not be fetched. ${e.message}` }, { status });
    }
    return Response.json({ error: `That page could not be fetched. ${e.message}` }, { status: 422 });
  }
  const text = site.pages.map((p) => p.text).join('\n');
  if (text.length > CONFIG.MAX_DOCUMENT_CHARS) {
    return Response.json({ error: `That page is longer than ${CONFIG.MAX_DOCUMENT_CHARS} characters. Paste the part you want checked as a document instead.` }, { status: 413 });
  }
  const doc = await createDocument({
    title: String(body.title || '').trim() || site.title || site.url,
    pages: site.pages,
    kind: 'website',
    sourceUrl: site.url,
    owner: requestUser(req)?.username || 'demo',
  });
  return Response.json({ document: publicDocument(doc), mode: mode(), models: getModels() });
}
