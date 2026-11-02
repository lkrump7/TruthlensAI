import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('challenge icons carry their card tone so each icon has its own theme color', () => {
  const challenge = read('../app/components/challenge.js');
  assert.ok(
    challenge.includes('format-icon ${') || challenge.includes('format-icon `'),
    'format-icon must include the card tone class, not a single shared color',
  );
  assert.ok(challenge.includes('o.tone'), 'icon tone must come from the card tone');
});

test('challenge icon tones resolve to distinct theme colors in CSS', () => {
  const css = read('../app/globals.css');
  const tones = ['tone-rose', 'tone-green', 'tone-cyan'];
  const bodies = tones.map((tone) => {
    const match = css.match(new RegExp(`\\.format-icon\\.${tone}\\s*\\{[^}]*\\}`));
    assert.ok(match, `.format-icon.${tone} rule must exist`);
    return match[0];
  });
  const unique = new Set(bodies);
  assert.equal(unique.size, 3, 'rose, green, and cyan icons must not share one color');
  for (const body of bodies) {
    assert.match(body, /color\s*:/, 'each icon tone must set its own color');
  }
});
