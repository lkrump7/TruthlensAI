import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pagesFromPastedText } from '../lib/paste.mjs';

const para = (n) => `Paragraph ${n} states a checkable fact about topic ${n}. It adds supporting detail in a second sentence so the passage has substance.`;

test('short pasted text with no separator stays one page, unchanged', () => {
  const text = 'Water boils at 100 degrees Celsius at sea level.';
  assert.deepEqual(pagesFromPastedText(text), [{ page: 1, text }]);
});

test('long pasted text as-is is split into pages at paragraph boundaries, losing nothing', () => {
  const paras = Array.from({ length: 40 }, (_, i) => para(i + 1));
  const text = paras.join('\n\n');
  const pages = pagesFromPastedText(text);
  assert.ok(pages.length > 1, 'long paste becomes several pages');
  assert.deepEqual(pages.map((p) => p.page), pages.map((_, i) => i + 1));
  const rejoined = pages.map((p) => p.text).join('\n\n');
  for (const sentence of paras) assert.ok(rejoined.includes(sentence), sentence.slice(0, 40));
  for (const pg of pages) assert.ok(pg.text.length <= 3200, `page stays near the cap, got ${pg.text.length}`);
});

test('explicit page separators are still honoured when present', () => {
  const text = 'First page text here.\n--- page ---\nSecond page text here.';
  const pages = pagesFromPastedText(text);
  assert.equal(pages.length, 2);
  assert.match(pages[0].text, /First page/);
  assert.match(pages[1].text, /Second page/);
});

test('form feeds are still honoured as page breaks', () => {
  const pages = pagesFromPastedText('Alpha page text.\fBeta page text.');
  assert.equal(pages.length, 2);
  assert.match(pages[1].text, /Beta/);
});

test('blank pasted text makes no pages instead of one empty page', () => {
  assert.deepEqual(pagesFromPastedText(''), []);
  assert.deepEqual(pagesFromPastedText('  \n  '), []);
  assert.deepEqual(pagesFromPastedText('\f\n--- page ---\n'), []);
});

test('page separators work with CRLF and at the start or end of the paste', () => {
  const crlf = pagesFromPastedText('First page text here.\r\n--- page ---\r\nSecond page text here.');
  assert.equal(crlf.length, 2);
  assert.match(crlf[1].text, /Second page/);
  assert.ok(!crlf.some((p) => p.text.includes('--- page ---')), 'the separator never becomes page text');
  assert.deepEqual(pagesFromPastedText('--- page ---\nOnly page text here.').map((p) => p.text), ['Only page text here.']);
  assert.deepEqual(pagesFromPastedText('Only page text here.\n--- page ---').map((p) => p.text), ['Only page text here.']);
  assert.deepEqual(pagesFromPastedText('--- page ---\n--- page ---'), []);
});
