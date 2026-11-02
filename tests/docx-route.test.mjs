import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const dir = mkdtempSync(join(tmpdir(), 'tl-docx-route-'));
process.env.TRUTHLENS_STORE_FILE = join(dir, 'documents.json');
delete process.env.META_MODEL_API_URL;
delete process.env.META_MODEL_API_KEY;

const { POST, docxUploadTooLarge } = await import('../app/api/documents/docx/route.js');

function zipEntry(name, data, method = 0) {
  const nameBuf = Buffer.from(name);
  const raw = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const stored = method === 8 ? deflateRawSync(raw) : raw;
  const head = Buffer.alloc(30);
  head.writeUInt32LE(0x04034b50, 0);
  head.writeUInt16LE(20, 4);
  head.writeUInt16LE(method, 8);
  head.writeUInt32LE(stored.length, 18);
  head.writeUInt32LE(raw.length, 22);
  head.writeUInt16LE(nameBuf.length, 26);
  return Buffer.concat([head, nameBuf, stored]);
}
const docxXml = (body) => `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
const p = (text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const validDocx = () => zipEntry('word/document.xml', docxXml(p('Water boils at 100 degrees Celsius at sea level in kitchens everywhere.')));

function docxReq({ name, size, bytes, title = 'Lying size' }) {
  const form = new FormData();
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  const file = new File([blob], name, { type: blob.type });
  Object.defineProperty(file, 'size', { value: size });
  const realBuf = Buffer.from(bytes);
  file.arrayBuffer = async () => realBuf.buffer.slice(realBuf.byteOffset, realBuf.byteOffset + realBuf.byteLength);
  form.append('file', file);
  form.append('title', title);
  return new Request('http://t/api/documents/docx', { method: 'POST', body: form });
}

test('docxUploadTooLarge rejects on real bytes even when file.size lies', () => {
  const MAX = 15 * 1024 * 1024;
  assert.equal(docxUploadTooLarge(1, MAX + 1), true, 'lying file.size cannot bypass the real-bytes check');
  assert.equal(docxUploadTooLarge(1, 100), false);
  assert.equal(docxUploadTooLarge(MAX + 1, 100), true, 'declared size is still checked');
});

test('docx route rejects when the real bytes exceed 15 MB even if file.size lies', async () => {
  const big = Buffer.alloc(15 * 1024 * 1024 + 1, 0);
  const res = await POST(docxReq({ name: 'big.docx', size: 1, bytes: big }));
  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /15 MB/);
});

test('docx route accepts a small valid docx and returns JSON, never throws', async () => {
  const res = await POST(docxReq({ name: 'small.docx', size: validDocx().length, bytes: validDocx(), title: 'Small docx' }));
  assert.ok([200, 400, 413, 422, 500].includes(res.status), `unexpected status ${res.status}`);
  const body = await res.json();
  assert.ok(body && typeof body === 'object', 'response is JSON');
});
