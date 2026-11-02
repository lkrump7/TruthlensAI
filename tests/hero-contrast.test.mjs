import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

test('home check panel uses the theme surface, not a hardcoded dark wash', () => {
  const rule = css.match(/\.hero-check\s*\{[^}]*\}/)?.[0] || '';
  assert.ok(rule, 'hero-check rule present');
  assert.ok(!rule.includes('13,21,39'), 'no hardcoded dark rgba in hero-check');
  assert.match(rule, /var\(--surface2\)/, 'hero-check sits on the theme surface');
});

test('home claim box uses the theme surface, not near-black', () => {
  const rule = css.match(/\.hero-box textarea\s*\{[^}]*\}/)?.[0] || '';
  assert.ok(rule, 'hero-box textarea rule present');
  assert.ok(!rule.includes('#070B12'), 'no near-black fill in the claim box');
  assert.match(rule, /var\(--surface\)/, 'claim box sits on the theme surface');
});
