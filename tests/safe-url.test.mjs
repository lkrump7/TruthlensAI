import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { safeHttpUrl } from '../lib/ui-state.mjs';

test('safeHttpUrl keeps plain http and https links, trimming spaces', () => {
  assert.equal(safeHttpUrl('https://example.com/a'), 'https://example.com/a');
  assert.equal(safeHttpUrl('  http://example.com/  '), 'http://example.com/');
  assert.equal(safeHttpUrl('HTTPS://EXAMPLE.COM/x'), 'HTTPS://EXAMPLE.COM/x');
});

test('safeHttpUrl rejects javascript:, data:, protocol-relative and empty values', () => {
  assert.equal(safeHttpUrl('javascript:alert(1)'), null);
  assert.equal(safeHttpUrl('  JavaScript:alert(1)'), null);
  assert.equal(safeHttpUrl('data:text/html,<h1>x</h1>'), null);
  assert.equal(safeHttpUrl('//example.com/x'), null);
  assert.equal(safeHttpUrl(''), null);
  assert.equal(safeHttpUrl('   '), null);
  assert.equal(safeHttpUrl(null), null);
  assert.equal(safeHttpUrl(undefined), null);
  assert.equal(safeHttpUrl('example.com/page'), null);
  assert.equal(safeHttpUrl('/relative/path'), null);
});

test('evidence and website links render through safeHttpUrl with a text fallback', () => {
  const verdict = readFileSync(new URL('../app/components/verdict.js', import.meta.url), 'utf8');
  const website = readFileSync(new URL('../app/components/website.js', import.meta.url), 'utf8');
  assert.ok(verdict.includes('safeHttpUrl'), 'verdict.js gates links through safeHttpUrl');
  assert.ok(website.includes('safeHttpUrl'), 'website.js gates links through safeHttpUrl');
  assert.ok(!/href=\{e\.url\}/.test(verdict), 'no raw e.url href remains in verdict.js');
  assert.ok(!/href=\{p\.url\}/.test(verdict), 'no raw p.url href remains in verdict.js');
  assert.ok(!/href=\{doc\.sourceUrl\}/.test(website), 'no raw doc.sourceUrl href remains in website.js');
});
