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

test('challenge directions announce the running follow-up at the buttons', () => {
  const challenge = read('../app/components/challenge.js');
  assert.ok(challenge.includes('role="status"'), 'busy state must expose a status node for assistive tech');
  assert.ok(challenge.includes('Running your follow-up check'), 'the running line names the follow-up check, not a generic spinner');
});

test('suggest failures surface the server message with a retry, never silent No ideas', () => {
  const src = read('../app/components/challenge.js');
  assert.ok(src.includes('function suggestStateFromResponse'), 'suggest response mapping is an exported pure function');
  const start = src.indexOf('function suggestStateFromResponse');
  const end = src.indexOf('export function SuggestedNext', start);
  assert.ok(end > start, 'helper sits before SuggestedNext');
  const body = src.slice(start, end).replace(/export\s+function/g, 'function');
  const { suggestStateFromResponse } = new Function(`${body}; return { suggestStateFromResponse };`)();
  const rateLimited = suggestStateFromResponse(false, 429, { error: 'Too many suggestion requests. Wait a minute and try again.' });
  assert.match(rateLimited.error, /Too many suggestion requests/, '429 keeps its message');
  assert.equal(rateLimited.suggestions.length, 0, 'failed fetch keeps no stale ideas');
  const badRequest = suggestStateFromResponse(false, 400, { error: 'A finished verdict is needed before suggestions can be made.' });
  assert.match(badRequest.error, /finished verdict/, '400 keeps its message');
  const emptyOk = suggestStateFromResponse(true, 200, { suggestions: [], source: '' });
  assert.ok(emptyOk.error.length > 0, '200 with no ideas becomes a retryable error, not silent empty');
  const good = suggestStateFromResponse(true, 200, { suggestions: [{ question: 'Q?', why: 'W', investigateAs: 'I' }], source: 'local' });
  assert.equal(good.error, '', 'good payload stays quiet');
  assert.equal(good.suggestions.length, 1, 'good payload keeps its ideas');
});

test('suggest box never goes silently empty the way the screenshot showed', () => {
  const challenge = read('../app/components/challenge.js');
  assert.ok(!challenge.includes('No ideas for this one'), 'the silent dead-end message is gone');
  assert.ok(challenge.includes('Retry ideas'), 'an empty suggest box offers a retry');
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
