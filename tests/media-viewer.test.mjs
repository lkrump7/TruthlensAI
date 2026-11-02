import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'tl-media-viewer-'));
process.env.TRUTHLENS_STORE_FILE = join(dir, 'documents.json');
process.env.TRUTHLENS_USERS_FILE = join(dir, 'users.json');
delete process.env.META_MODEL_API_URL;
delete process.env.META_MODEL_API_KEY;

const { storeOriginal, readOriginal, mediaPath, removeOriginal, MAX_ORIGINAL_BYTES } = await import('../lib/media-store.mjs');
const { createDocument, getDocument, deleteDocument } = await import('../lib/documents.mjs');
const { POST: imagePost } = await import('../app/api/documents/image/route.js');
const { POST: pdfPost } = await import('../app/api/documents/pdf/route.js');
const { POST: docxPost } = await import('../app/api/documents/docx/route.js');
const { GET: mediaGet } = await import('../app/api/documents/[id]/media/route.js');

test('storeOriginal keeps bytes under a hash name and reads them back', async () => {
  const bytes = Buffer.from([137, 80, 78, 71, 1, 2, 3, 4]);
  const meta = await storeOriginal(bytes, 'image/png', 'sign photo.png');
  assert.ok(meta, 'supported mime is stored');
  assert.match(meta.storedName, /^[a-f0-9]{64}\.png$/, 'stored under its content hash, never the user filename');
  assert.equal(meta.mime, 'image/png');
  assert.equal(meta.bytes, bytes.length);
  assert.deepEqual(await readOriginal(meta.storedName), bytes);
  const again = await storeOriginal(bytes, 'image/png', 'sign photo.png');
  assert.equal(again.storedName, meta.storedName, 'same bytes store once');
  await removeOriginal(meta.storedName);
});

test('storeOriginal refuses an oversize original instead of filling the disk', async () => {
  assert.ok(MAX_ORIGINAL_BYTES > 0 && MAX_ORIGINAL_BYTES <= 100 * 1024 * 1024, 'a per-file cap exists at or below the video cap');
  assert.equal(await storeOriginal(Buffer.alloc(MAX_ORIGINAL_BYTES + 1), 'application/pdf', 'big.pdf'), null, 'oversize bytes are not stored');
});

test('media store fails closed on unknown types and traversal names', async () => {
  assert.equal(await storeOriginal(Buffer.from('<svg/>'), 'image/svg+xml', 'x.svg'), null, 'svg is never stored for inline serving');
  assert.equal(await storeOriginal(Buffer.from('x'), 'application/x-msdownload', 'x.exe'), null);
  assert.equal(await readOriginal('../documents.json'), null, 'traversal name reads nothing');
  assert.equal(await readOriginal(`${'a'.repeat(64)}.png`), null, 'missing file reads as null');
  assert.equal(mediaPath('../../etc/passwd'), null);
});

function uploadReq(url, name, bytes, type) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type }), name);
  return new Request(url, { method: 'POST', body: form });
}

async function withVisionFetch(fetchImpl, fn) {
  const savedFetch = globalThis.fetch;
  const saved = { u: process.env.META_MODEL_API_URL, k: process.env.META_MODEL_API_KEY };
  process.env.META_MODEL_API_URL = 'https://example.invalid/chat';
  process.env.META_MODEL_API_KEY = 'k';
  globalThis.fetch = fetchImpl;
  try { return await fn(); } finally {
    globalThis.fetch = savedFetch;
    if (saved.u === undefined) delete process.env.META_MODEL_API_URL; else process.env.META_MODEL_API_URL = saved.u;
    if (saved.k === undefined) delete process.env.META_MODEL_API_KEY; else process.env.META_MODEL_API_KEY = saved.k;
  }
}

test('image upload stores the original and the media route serves it back', async () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const captionFetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'A sign says water boils at 100 degrees Celsius at sea level.' } }] }) });
  const res = await withVisionFetch(captionFetch, () => imagePost(uploadReq('http://t/api/documents/image', 'sign.png', png, 'image/png')));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.document.kind, 'image');
  assert.ok(body.document.media.file, 'upload records the stored original');
  assert.equal(body.document.media.file.mime, 'image/png');

  const id = body.document.id;
  const got = await mediaGet(new Request(`http://t/api/documents/${id}/media`), { params: { id } });
  assert.equal(got.status, 200);
  assert.equal(got.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await got.arrayBuffer()), png, 'served bytes are the uploaded bytes');

  const ranged = await mediaGet(new Request(`http://t/api/documents/${id}/media`, { headers: { range: 'bytes=2-5' } }), { params: { id } });
  assert.equal(ranged.status, 206, 'range requests work, so video players can seek');
  assert.equal(ranged.headers.get('content-range'), `bytes 2-5/${png.length}`);
  assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), png.subarray(2, 6));

  const storedName = (await getDocument(id)).media.file.storedName;
  await deleteDocument(id);
  assert.equal(existsSync(mediaPath(storedName)), false, 'removing the document removes its stored original');
});

test('media route 404s for unknown documents and documents without a stored original', async () => {
  const missing = await mediaGet(new Request('http://t/api/documents/doc-nope/media'), { params: { id: 'doc-nope' } });
  assert.equal(missing.status, 404);
  const book = await createDocument({ title: 'Pasted', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }] });
  const noFile = await mediaGet(new Request(`http://t/api/documents/${book.id}/media`), { params: { id: book.id } });
  assert.equal(noFile.status, 404);
  assert.match((await noFile.json()).error, /not stored/i);
});

function makePdf(text) {
  const content = `BT /F1 12 Tf (${text}) Tj ET`;
  const stream = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  return Buffer.from(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n2 0 obj\n${stream}\nendobj\ntrailer\n%%EOF\n`, 'latin1');
}

test('pdf and docx uploads store their originals for the viewer', async () => {
  const pdf = makePdf('Water boils at 100 degrees Celsius at sea level in kitchens today.');
  const pdfRes = await pdfPost(uploadReq('http://t/api/documents/pdf', 'notes.pdf', pdf, 'application/pdf'));
  assert.equal(pdfRes.status, 200);
  const pdfBody = await pdfRes.json();
  assert.equal(pdfBody.document.media.file.mime, 'application/pdf');
  const pdfGot = await mediaGet(new Request('http://t/media'), { params: { id: pdfBody.document.id } });
  assert.equal(pdfGot.headers.get('content-type'), 'application/pdf');
  assert.deepEqual(Buffer.from(await pdfGot.arrayBuffer()), pdf);

  const xml = '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>The sea level rose last year by a measurable amount.</w:t></w:r></w:p></w:body></w:document>';
  const nameBuf = Buffer.from('word/document.xml');
  const raw = Buffer.from(xml);
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt32LE(raw.length, 18); head.writeUInt32LE(raw.length, 22); head.writeUInt16LE(nameBuf.length, 26);
  const docx = Buffer.concat([head, nameBuf, raw]);
  const docxRes = await docxPost(uploadReq('http://t/api/documents/docx', 'notes.docx', docx, 'application/octet-stream'));
  assert.equal(docxRes.status, 200);
  const docxBody = await docxRes.json();
  assert.equal(docxBody.document.media.file.ext, 'docx');
  const docxGot = await mediaGet(new Request('http://t/media'), { params: { id: docxBody.document.id } });
  assert.deepEqual(Buffer.from(await docxGot.arrayBuffer()), docx);
});

test('media route 404s when the stored file cannot be opened', async () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const captionFetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'A sign says water boils at 100 degrees Celsius at sea level.' } }] }) });
  const res = await withVisionFetch(captionFetch, () => imagePost(uploadReq('http://t/api/documents/image', 'sign.png', png, 'image/png')));
  assert.equal(res.status, 200);
  const id = (await res.json()).document.id;
  const path = mediaPath((await getDocument(id)).media.file.storedName);
  chmodSync(path, 0o000);
  try {
    const got = await mediaGet(new Request(`http://t/api/documents/${id}/media`), { params: { id } });
    assert.equal(got.status, 404, 'an unreadable original reads as missing, not as a broken 200 stream');
  } finally {
    chmodSync(path, 0o644);
    await deleteDocument(id);
  }
});

test('upload warns when the original file could not be kept', async () => {
  const blocker = join(dir, 'not-a-directory');
  writeFileSync(blocker, 'x');
  const saved = process.env.TRUTHLENS_MEDIA_DIR;
  process.env.TRUTHLENS_MEDIA_DIR = blocker;
  try {
    const pdf = makePdf('Water boils at 100 degrees Celsius at sea level in kitchens today.');
    const res = await pdfPost(uploadReq('http://t/api/documents/pdf', 'notes.pdf', pdf, 'application/pdf'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.document.media?.file, undefined, 'no stored original is recorded');
    assert.match(body.warning || '', /was not kept/i, 'the response says the original is missing');
  } finally {
    if (saved === undefined) delete process.env.TRUTHLENS_MEDIA_DIR; else process.env.TRUTHLENS_MEDIA_DIR = saved;
  }
});
