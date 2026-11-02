import { createDocument, seedDemo, publicDocument } from '../../../lib/store.mjs';
import { liveStatus, getModels } from '../../../lib/meta.mjs';
import { requestUser } from '../../../lib/auth.mjs';
import { CONFIG } from '../../../lib/config.mjs';
import { pagesFromPastedText } from '../../../lib/paste.mjs';
const mode = () => (liveStatus().configured ? 'live-ready' : 'demo');

export async function GET(req) {
  try {
    const user = requestUser(req);
    const documents = await seedDemo(user?.username || 'demo');
    return Response.json({ documents, mode: mode(), models: getModels() });
  } catch (e) { console.error(e); return Response.json({ error: 'Something went wrong. Try again.' }, { status: 500 }); }
}

export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}));
    const text = String(body.text || '');
    if (!text.trim()) return Response.json({ error: 'Paste document text first.' }, { status: 400 });
    if (text.length > CONFIG.MAX_DOCUMENT_CHARS) return Response.json({ error: `Document is longer than ${CONFIG.MAX_DOCUMENT_CHARS} characters.` }, { status: 413 });
    const pages = pagesFromPastedText(text);
    const doc = await createDocument({ title: body.title, pages, owner: requestUser(req)?.username || 'demo' });
    return Response.json({ document: publicDocument(doc), mode: mode() });
  } catch (e) { console.error(e); return Response.json({ error: 'Something went wrong. Try again.' }, { status: 500 }); }
}
