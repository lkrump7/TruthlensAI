import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');

function hexLuminance(hex) {
  const v = hex.replace('#', '');
  const channel = (i) => {
    const s = parseInt(v.slice(i, i + 2), 16) / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

function contrast(a, b) {
  const l1 = Math.max(hexLuminance(a), hexLuminance(b));
  const l2 = Math.min(hexLuminance(a), hexLuminance(b));
  return (l1 + 0.05) / (l2 + 0.05);
}

test('home eyebrow stays readable in light theme (dark text on a light pill)', () => {
  const block = css.match(/html\[data-theme="light"\]\s*\.home-eyebrow\s*\{[^}]*\}/);
  assert.ok(block, 'light theme overrides .home-eyebrow instead of reusing the dark pill');
  assert.ok(!block[0].includes('13,21,39'), 'light pill must not reuse the dark navy background');
  assert.match(block[0], /background:\s*rgba\(5,\s*150,\s*105/, 'light pill uses the light green tint');
  // #047857 (light --teal) on the tinted pill clears WCAG AA for small text.
  assert.ok(contrast('#047857', '#ebf6f3') >= 4.5, 'tint + dark green clears 4.5:1');
});
