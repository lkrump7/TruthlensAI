import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { extractDocxPages } from '../lib/docx.mjs';

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
function docxXml(body) {
  return `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
}
const p = (text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

test('extracts paragraph text from a stored docx', () => {
  const buf = zipEntry('word/document.xml', docxXml(p('Water boils at 100 degrees.') + p('It freezes at zero.')));
  const pages = extractDocxPages(buf);
  assert.equal(pages.length, 1);
  assert.match(pages[0].text, /Water boils at 100 degrees\./);
  assert.match(pages[0].text, /It freezes at zero\./);
  assert.equal(pages[0].page, 1);
});

test('extracts from a deflated docx entry', () => {
  const buf = zipEntry('word/document.xml', docxXml(p('Deflated text survives.')), 8);
  assert.match(extractDocxPages(buf)[0].text, /Deflated text survives\./);
});

test('decodes XML entities in docx text', () => {
  const buf = zipEntry('word/document.xml', docxXml(p('Fish &amp; chips &lt;always&gt; &#8220;quoted&#8221;')));
  const text = extractDocxPages(buf)[0].text;
  assert.ok(text.includes('Fish & chips <always>'));
  assert.ok(text.includes('“quoted”'));
});

test('splits docx pages on an explicit page break', () => {
  const body = p('First page claim.') + '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' + p('Second page claim.');
  const pages = extractDocxPages(zipEntry('word/document.xml', docxXml(body)));
  assert.equal(pages.length, 2);
  assert.match(pages[0].text, /First page claim\./);
  assert.match(pages[1].text, /Second page claim\./);
  assert.equal(pages[1].page, 2);
});

test('rejects a buffer that is not a docx zip', () => {
  assert.throws(() => extractDocxPages(Buffer.from('not a zip at all')), /Not a DOCX/);
});

test('docx with no readable text returns no pages', () => {
  const buf = zipEntry('word/document.xml', docxXml('<w:p><w:r><w:t>   </w:t></w:r></w:p>'));
  assert.deepEqual(extractDocxPages(buf), []);
});

test('decodes an out-of-range numeric entity as replacement text instead of throwing', () => {
  const buf = zipEntry('word/document.xml', docxXml(p('Fish &#999999999; chips always here today.')));
  const pages = extractDocxPages(buf);
  assert.equal(pages.length, 1);
  assert.match(pages[0].text, /Fish . chips/);
});

test('rejects a docx zip bomb with too many entries', () => {
  const parts = [];
  for (let i = 0; i < 600; i++) parts.push(zipEntry(`word/part${i}.xml`, '<x/>'));
  parts.push(zipEntry('word/document.xml', docxXml(p('Water boils at 100 degrees.'))));
  assert.throws(() => extractDocxPages(Buffer.concat(parts)), /too many|exceeds|limit/i);
});

test('rejects a docx entry that inflates past the size limit', () => {
  const big = `<w:p><w:r><w:t>${'Water boils at sea level. '.repeat(1000000)}</w:t></w:r></w:p>`;
  const buf = zipEntry('word/document.xml', docxXml(big), 8);
  assert.throws(() => extractDocxPages(buf), /too large|exceeds|limit/i);
});

test('extracts a docx whose local header uses a data descriptor', () => {
  const xml = docxXml(p('Water boils at one hundred degrees at sea level today.'));
  const comp = deflateRawSync(Buffer.from(xml));
  const name = Buffer.from('word/document.xml');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x08, 6); local.writeUInt16LE(8, 8);
  local.writeUInt16LE(name.length, 26);
  const desc = Buffer.alloc(16);
  desc.writeUInt32LE(0x08074b50, 0); desc.writeUInt32LE(comp.length, 8); desc.writeUInt32LE(Buffer.byteLength(xml), 12);
  const pages = extractDocxPages(Buffer.concat([local, name, comp, desc]));
  assert.equal(pages.length, 1);
  assert.match(pages[0].text, /Water boils at one hundred degrees/);
});
