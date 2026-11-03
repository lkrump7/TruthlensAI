import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolated store so this file never touches real data.
const dir = mkdtempSync(join(tmpdir(), 'tl-sec-frontend-'));
process.env.TRUTHLENS_STORE_FILE = join(dir, 'documents.json');
process.env.TRUTHLENS_USERS_FILE = join(dir, 'users.json');

const page = readFileSync(new URL('../app/page.js', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../app/layout.js', import.meta.url), 'utf8');
const verdict = readFileSync(new URL('../app/components/verdict.js', import.meta.url), 'utf8');
const website = readFileSync(new URL('../app/components/website.js', import.meta.url), 'utf8');
const evidenceSrc = readFileSync(new URL('../lib/evidence.mjs', import.meta.url), 'utf8');
const exportSrc = readFileSync(new URL('../app/api/export/route.js', import.meta.url), 'utf8');
const historySrc = readFileSync(new URL('../app/api/history/route.js', import.meta.url), 'utf8');
const contraSrc = readFileSync(new URL('../app/api/contradictions/route.js', import.meta.url), 'utf8');
const streamSrc = readFileSync(new URL('../app/api/verify/stream/route.js', import.meta.url), 'utf8');
const errorsSrc = readFileSync(new URL('../lib/errors.mjs', import.meta.url), 'utf8');

test('safeHttpUrl allowlists http/https only', async () => {
  const { safeHttpUrl } = await import('../lib/ui-state.mjs');
  assert.equal(safeHttpUrl('https://example.com/a'), 'https://example.com/a');
  assert.equal(safeHttpUrl('  http://example.com/  '), 'http://example.com/');
  assert.equal(safeHttpUrl('javascript:alert(1)'), null);
  assert.equal(safeHttpUrl('  JavaScript:alert(1)'), null);
  assert.equal(safeHttpUrl('data:text/html,<h1>x</h1>'), null);
  assert.equal(safeHttpUrl('//example.com/x'), null);
  assert.equal(safeHttpUrl('/relative/path'), null);
  assert.equal(safeHttpUrl('example.com/page'), null);
  assert.equal(safeHttpUrl(''), null);
  assert.equal(safeHttpUrl(null), null);
});

test('evidence and source URLs render only through the http/https allowlist', () => {
  for (const [name, src] of [['verdict.js', verdict], ['website.js', website], ['page.js', page]]) {
    assert.ok(src.includes('safeHttpUrl'), `${name} gates links through safeHttpUrl`);
  }
  assert.doesNotMatch(verdict, /href=\{e\.url\}/, 'verdict.js must not render raw evidence URLs');
  assert.doesNotMatch(verdict, /href=\{p\.url\}/, 'verdict.js must not render raw passage URLs');
  assert.doesNotMatch(website, /href=\{doc\.sourceUrl\}/, 'website.js must not render raw source URLs');
  assert.doesNotMatch(page, /href=\{doc\.sourceUrl\}/, 'page.js must not render raw source URLs in anchors');
  assert.doesNotMatch(page, /href=\{viewerDoc\.sourceUrl\}/, 'page.js must not render raw viewer URLs in anchors');
  assert.doesNotMatch(page, /src=\{viewerDoc\.sourceUrl\}/, 'viewer iframe src must use the allowlisted URL, not the raw value');
});

test('evidence lib passes source URLs through for the UI allowlist to gate', () => {
  assert.match(evidenceSrc, /url: src\.url/, 'evidence keeps the fetched URL so the UI gate sees the real value');
  assert.doesNotMatch(evidenceSrc, /<a\s+href/, 'evidence lib renders no anchors itself');
  assert.doesNotMatch(evidenceSrc, /dangerouslySetInnerHTML/, 'evidence lib injects no HTML');
});

test('only the static theme boot script uses dangerouslySetInnerHTML', () => {
  for (const [name, src] of [['page.js', page], ['verdict.js', verdict], ['website.js', website]]) {
    assert.doesNotMatch(src, /dangerouslySetInnerHTML/, `${name} must not inject HTML`);
  }
  const hits = (layout.match(/dangerouslySetInnerHTML/g) || []).length;
  assert.equal(hits, 1, 'layout.js keeps exactly one dangerouslySetInnerHTML (the static theme boot script)');
  assert.match(layout, /THEME_BOOT_SCRIPT/, 'the single injection is the static theme constant');
  assert.doesNotMatch(layout, /\$\{[^}]* (sourceUrl|url|passage|text|claim|user|doc) /i, 'theme script interpolates no user data');
});

test('read routes enforce canView and answer strangers with generic 404', async () => {
  assert.match(exportSrc, /canView/, 'export route enforces canView');
  assert.match(exportSrc, /Document not found/, 'export route answers with generic 404');
  assert.match(contraSrc, /canView/, 'contradictions route enforces canView');
  assert.match(historySrc, /canView|listHistory/, 'history route scopes reads to the viewer');
});

test('export/history/contradictions error bodies stay generic; history caps limit at 200', async () => {
  for (const [name, src] of [['export', exportSrc], ['history', historySrc], ['contradictions', contraSrc]]) {
    const responses = [...src.matchAll(/Response\.json\(\{ error: ([^}]+)\}/g)].map((m) => m[1]);
    assert.ok(responses.length > 0, `${name} route has error bodies to check`);
    for (const body of responses) {
      assert.doesNotMatch(body, /err\.message|err\.stack|String\(err|e\.message/, `${name} error body must not leak internals: ${body}`);
    }
  }
  assert.match(historySrc, /200/, 'history route caps the page size at 200');
  const { listHistory, recordInvestigation } = await import('../lib/history.mjs');
  const verdictFor = (text) => ({
    text, type: 'Scientific', verdict: 'Supported', judgedBy: 'Muse Spark 1.3',
    supporting: [], contradicting: [], explanation: 'Checked.', limitations: [],
  });
  const owner = `limit-probe-${Date.now() % 1000000}`;
  await recordInvestigation({ owner, workflow: 'claim', result: verdictFor('Water boils at 100 degrees Celsius at sea level.') });
  const capped = await listHistory(owner, { limit: 5000 });
  assert.ok(capped.length <= 200, `history caps huge limits at 200, got ${capped.length}`);
});

test('stream SSE errors and persisted live-failure strings stay generic while the server log keeps detail', async () => {
  assert.match(streamSrc, /Verification failed\. Try again\./, 'SSE client gets a generic message');
  assert.match(streamSrc, /console\.error/, 'SSE server log keeps the raw detail');
  assert.doesNotMatch(streamSrc, /send\(\{ kind: 'error', error: err/, 'SSE never forwards the raw error object');
  assert.match(errorsSrc, /Live research failed\. Retry the claim\./, 'persisted live-failure wording is generic');
  assert.match(errorsSrc, /console\.error/, 'live-failure helper logs raw detail server-side');
  assert.doesNotMatch(page, /\{event\.error\}/, 'the client never renders the SSE error string as markup');
  assert.match(page, /The check failed\. Try again\./, 'stream failures surface a generic notice in the UI');
});
