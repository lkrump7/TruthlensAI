import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../app/page.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

test('header logo is not duplicated by brand-name text', () => {
  assert.ok(!page.includes('brand-name'), 'no text wordmark next to the image wordmark');
});

test('header logo renders larger than the old 40px mark', () => {
  const rule = css.match(/\.brand-logo\s*\{[^}]*\}/)?.[0] || '';
  assert.ok(rule, 'brand-logo rule present');
  const height = Number((rule.match(/height:\s*(\d+)px/) || [])[1]);
  assert.ok(height >= 56, `logo height is ${height || 'unset'}px, expected at least 56px`);
});

test('header does not duplicate the logo-embedded motto', () => {
  assert.ok(!/Insight from Truth/i.test(page), 'no duplicate motto text next to the image wordmark');
  assert.ok(!page.includes('brand-motto'), 'no motto element next to the image wordmark');
});
