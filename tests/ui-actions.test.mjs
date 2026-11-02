import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const page = ['../app/components/verdict.js', '../app/page.js'].map(read).join('\n');
const block = (start, end) => {
  const i = page.indexOf(start); const j = page.indexOf(end, i);
  assert.ok(i > -1 && j > i, `block ${start}`);
  return page.slice(i, j);
};

test('paste-text upload always clears busy and reports failures', () => {
  const b = block('async function addDoc', 'async function verifyClaim');
  assert.match(b, /finally\s*{\s*setBusy\(''\)/);
  assert.match(b, /catch/);
});

test('sign-in reports an unreachable server instead of failing silently', () => {
  const b = block('async function auth(', 'async function verify()');
  assert.match(b, /catch/);
  assert.match(b, /could not reach/i);
});

test('recheck shows progress and reports failure', () => {
  assert.match(page, /busy === 'recheck'/);
  assert.match(page, /could not check again/i);
});

test('pause and resume report failure instead of flipping silently', () => {
  const b = block('async function toggleAuto', 'const shown');
  assert.match(b, /catch|!r\.ok/);
  assert.match(page, /could not pause|could not restart/i);
});

test('verdict download works for saved standalone checks via history ids', () => {
  const v = read('../app/components/verdict.js');
  assert.match(v, /historyDocId/);
  assert.match(v, /historyClaimId/);
});

test('question tool only counts real documents, not history entries', () => {
  assert.match(page, /realDocs\.length === 0/);
});

test('a claim waiting on auto-check still offers a manual check', () => {
  const i = page.indexOf("c.status === 'pending' ? 'Verifying…'");
  assert.ok(i > -1);
  assert.ok(page.slice(i, i + 500).includes('Verify this claim'), 'pending row must carry its own verify button');
});

test('a failed file load says so instead of rendering an empty library', () => {
  assert.match(page, /could not load your files/i);
  assert.match(page, /loadErr/);
});

test('removing a file from the viewer does not stack two dialogs', () => {
  const b = block('function askDelete', 'function openLibraryExtras');
  assert.match(b, /setViewerDoc\(null\)/);
});

test('a stale error from one tool does not haunt another after switching', () => {
  const effects = [...page.matchAll(/useEffect\(\(\) => \{([^}]*)\},\s*\[([^\]]*)\]\)/g)];
  const clearing = effects.find((m) => m[1].includes("setErr('')") && m[2].includes('tab') && m[2].includes('tool'));
  assert.ok(clearing, 'switching tab/tool must reset the shared error (e.g. a website Blocked URL must not sit under the claim Verify button)');
});
