import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../app/page.js', import.meta.url), 'utf8');

test('verify result renders inline under the verify form, not only at the page bottom', () => {
  const formAt = page.indexOf('Verify this claim');
  const inlineAt = page.indexOf('data-result-inline');
  const asideAt = page.indexOf('<aside>');
  assert.ok(inlineAt > formAt, 'inline result anchor must follow the verify form');
  assert.ok(inlineAt < asideAt, 'inline result must render before the documents column ends the first screen');
});

test('verify request always clears the busy state and reports failures', () => {
  assert.match(page, /finally\s*{\s*setBusy\(''\)/);
  assert.match(page, /Verification did not complete/);
});

test('document view offers reader-directed investigation controls', () => {
  for (const marker of ['Investigate a claim or theory from this book', 'Verify this claim', 'Not yet verified', 'Challenge this finding', 'Find stronger opposing evidence', 'What would prove this wrong?', 'Pause automatic verification', 'investigated by you']) {
    assert.ok(page.includes(marker), marker);
  }
  assert.match(page, /\/assess/);
  assert.match(page, /\/challenge/);
  assert.match(page, /\/auto/);
});

test('verdict view shows faithfulness and evidence strength separately', () => {
  assert.ok(page.includes('Citation stance coverage'));
  assert.ok(page.includes('Evidence strength'));
});

test('document view subscribes to live document events with polling kept as fallback', () => {
  assert.match(page, /EventSource/);
  assert.match(page, /\/events/);
  assert.match(page, /setInterval/);
});

test('busy verify state tells the user live research takes a while', () => {
  assert.match(page, /30–60 seconds|30-60 seconds/);
});
