import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { extractPdfPages } from '../lib/pdf.mjs';

function makePdf(streams) {
  const objects = ['<< /Type /Catalog >>'];
  for (const s of streams) objects.push(s);
  let pdf = '%PDF-1.4\n';
  objects.forEach((body, i) => { pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  return Buffer.from(pdf + 'trailer\n%%EOF\n', 'latin1');
}
const textStream = (text, compress) => {
  const content = `BT /F1 12 Tf (${text}) Tj ET`;
  if (compress) {
    const data = deflateSync(Buffer.from(content));
    return `<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n${data.toString('binary')}\nendstream`;
  }
  return `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
};

test('extractPdfPages reads an uncompressed text stream with its page text intact', () => {
  const pages = extractPdfPages(makePdf([textStream('Water boils at 100 degrees Celsius at sea level.', false)]));
  assert.equal(pages.length, 1);
  assert.match(pages[0].text, /Water boils/);
  assert.equal(pages[0].page, 1);
});

test('extractPdfPages inflates FlateDecode streams', () => {
  const pages = extractPdfPages(makePdf([textStream('Humans only use a small part of their brains daily.', true)]));
  assert.equal(pages.length, 1);
  assert.match(pages[0].text, /Humans only use/);
});

test('extractPdfPages separates multiple content streams into pages', () => {
  const pages = extractPdfPages(makePdf([textStream('First page claim about brains here today.', false), textStream('Second page claim about water boiling now.', false)]));
  assert.equal(pages.length, 2);
  assert.equal(pages[1].page, 2);
});

test('extractPdfPages decodes hex strings inside TJ arrays (PyMuPDF-style PDFs)', () => {
  const hex = Buffer.from('Water boils at 100 degrees Celsius at sea level.').toString('hex');
  const content = `BT /F1 12 Tf [<${hex}>]TJ ET`;
  const pdf = makePdf([`<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);
  const pages = extractPdfPages(pdf);
  assert.equal(pages.length, 1);
  assert.match(pages[0].text, /Water boils/);
});

test('extractPdfPages throws a clear error on a non-PDF buffer', () => {
  assert.throws(() => extractPdfPages(Buffer.from('not a pdf at all')), /not a pdf/i);
});

test('extractPdfPages rejects a decompression bomb instead of inflating without limit', () => {
  const huge = `BT /F1 12 Tf (${'Water boils '.repeat(2000000)}) Tj ET`;
  const data = deflateSync(Buffer.from(huge));
  const stream = `<< /Length ${data.length} /Filter /FlateDecode >>\nstream\n${data.toString('binary')}\nendstream`;
  assert.throws(() => extractPdfPages(makePdf([stream])), /too large|exceeds|limit/i);
});
