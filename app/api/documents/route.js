import { createDocument, seedDemo } from '../../../lib/store.mjs';
import { liveStatus, getModels } from '../../../lib/meta.mjs';
import { requestUser } from '../../../lib/auth.mjs';
import { CONFIG } from '../../../lib/config.mjs';
const mode = () => (liveStatus().configured ? 'live-ready' : 'demo');

export async function GET(req) {
  const user = requestUser(req);
  const documents = await seedDemo(user?.username || 'demo');
  return Response.json({ documents, mode: mode(), models: getModels() });
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  const text = String(body.text || '');
  if (!text.trim()) return Response.json({ error: 'Paste document text first.' }, { status: 400 });
  if (text.length > CONFIG.MAX_DOCUMENT_CHARS) return Response.json({ error: `Document is longer than ${CONFIG.MAX_DOCUMENT_CHARS} characters.` }, { status: 413 });
  const pages = text.split(/\f|\n--- page ---\n/i).map((t, i) => ({ page: i + 1, text: t }));
  const doc = await createDocument({ title: body.title, pages, owner: requestUser(req)?.username || 'demo' });
  const { chunks, ...pub } = doc;
  return Response.json({ document: { ...pub, chunkCount: chunks.length }, mode: mode() });
}
