import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { getDocument } from '../../../../../lib/documents.mjs';
import { canView, requestUser } from '../../../../../lib/auth.mjs';
import { MIME_BY_EXT, statOriginal } from '../../../../../lib/media-store.mjs';

// Serves the stored original file behind a library document so the
// viewer can show the image, play the video, or embed the PDF.
// Visibility matches the document routes: a file is only as public
// as the document it belongs to.

// Resolves once the file is open, so a file that vanished or lost its
// read permission after the stat still gets a clean 404 instead of a
// 200 response whose body dies mid-stream.
function openOriginal(path, opts) {
  return new Promise((resolve, reject) => {
    const stream = createReadStream(path, opts);
    stream.once('open', () => resolve(stream));
    stream.once('error', reject);
  });
}

function parseRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(header || '').trim());
  if (!m || size === 0) return null;
  let start;
  let end;
  if (m[1] === '') {
    const suffix = Number(m[2]);
    if (!Number.isFinite(suffix) || suffix <= 0) return null;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Number(m[2]);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) return 'invalid';
  return { start, end: Math.min(end, size - 1) };
}

async function serve(req, params, headOnly) {
  const doc = await getDocument(params.id);
  if (!doc || !canView(doc, requestUser(req)?.username)) return Response.json({ error: 'Document not found.' }, { status: 404 });
  const file = doc.media?.file;
  const stored = file ? await statOriginal(file.storedName) : null;
  if (!file || !stored) return Response.json({ error: 'The original file was not stored for this document. It was added before originals were kept, or its file is missing.' }, { status: 404 });
  const mime = MIME_BY_EXT[file.ext] || null;
  if (!mime) return Response.json({ error: 'The original file was not stored for this document.' }, { status: 404 });

  const filename = String(file.originalName || `document.${file.ext}`).replace(/["\r\n]/g, '');
  const base = {
    'content-type': mime,
    'accept-ranges': 'bytes',
    'cache-control': 'private, no-cache',
    'x-content-type-options': 'nosniff',
    'content-disposition': `inline; filename="${filename}"`,
  };

  const notStored = () => Response.json({ error: 'The original file was not stored for this document. It was added before originals were kept, or its file is missing.' }, { status: 404 });
  if (headOnly) {
    try {
      (await openOriginal(stored.path)).destroy();
    } catch {
      return notStored();
    }
    return new Response(null, {
      status: 200,
      headers: { ...base, 'content-length': String(stored.size) },
    });
  }
  const range = parseRange(req.headers.get('range'), stored.size);
  if (range === 'invalid') {
    return new Response(null, { status: 416, headers: { ...base, 'content-range': `bytes */${stored.size}`, 'content-length': '0' } });
  }
  let stream;
  try {
    stream = await openOriginal(stored.path, range ? { start: range.start, end: range.end } : undefined);
  } catch {
    return notStored();
  }
  if (range) {
    const { start, end } = range;
    return new Response(Readable.toWeb(stream), {
      status: 206,
      headers: { ...base, 'content-range': `bytes ${start}-${end}/${stored.size}`, 'content-length': String(end - start + 1) },
    });
  }
  return new Response(Readable.toWeb(stream), {
    status: 200,
    headers: { ...base, 'content-length': String(stored.size) },
  });
}

export async function GET(req, { params }) { return serve(req, params, false); }
export async function HEAD(req, { params }) { return serve(req, params, true); }
