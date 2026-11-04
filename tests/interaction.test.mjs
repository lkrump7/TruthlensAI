import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const modalPath = new URL('../app/components/modal.js', import.meta.url);
const surface = ['../app/components/icons.js', '../app/components/mic.js', '../app/components/verdict.js',
  '../app/components/challenge.js', ...(existsSync(modalPath) ? ['../app/components/modal.js'] : []),
  '../app/page.js'].map(read).join('\n');
const page = read('../app/page.js');
const verdict = read('../app/components/verdict.js');
const css = read('../app/globals.css');

// Check flow: a judge who starts the wrong check must not be stuck for a minute.

test('flow: one shared stream reader serves the claim tool and the chat', () => {
  assert.ok(surface.includes('readVerifyStream'), 'shared stream reader exists');
  assert.ok((page.match(/readVerifyStream\(/g) || []).length >= 2, 'both check paths call it');
  assert.ok(surface.includes('/api/verify/stream'), 'it still reads the stream route');
});

test('flow: a running check can be cancelled and a cancel never retries silently', () => {
  assert.ok(surface.includes('AbortController'), 'checks carry an abort signal');
  assert.match(surface, /signal:/, 'the signal reaches fetch');
  assert.ok(surface.includes('Cancel check'), 'a cancel control shows while a check runs');
  assert.ok(surface.includes('Check cancelled'), 'a cancelled check says so in plain words');
  assert.ok(surface.includes('signal.aborted'), 'the fallback is skipped after a cancel');
});

test('flow: Ctrl or Cmd+Enter submits the claim box, and the hint says so', () => {
  assert.match(page, /ctrlKey \|\| e\.metaKey/, 'both modifier spellings work');
  assert.ok(page.includes('Ctrl+Enter'), 'the shortcut is written next to the button');
});

test('flow: progress and verdicts are announced to assistive tech', () => {
  assert.ok(surface.includes('data-announcer'), 'a polite live region exists');
  assert.match(surface, /aria-live="polite"/, 'announcements are polite, not assertive spam');
  assert.match(verdict, /data-live-stages[^>]*aria-live|aria-live[^>]*data-live-stages/, 'live stages announce as they land');
  assert.ok(page.includes('setAnnounce'), 'finishing a check announces the verdict');
});

test('flow: a failed report download says so instead of doing nothing', () => {
  const at = verdict.indexOf('downloadReport');
  const fn = verdict.slice(at, verdict.indexOf('function VerdictSummary', at));
  assert.ok(!fn.includes('if (!res.ok) return;'), 'no silent return on a failed download');
  assert.ok(verdict.includes('We could not download the report'), 'the failure is shown in words');
});

test('flow: the long verdict record folds its working away by default', () => {
  assert.ok(verdict.includes('<details'), 'investigation steps sit in a disclosure');
  assert.ok(verdict.includes('<summary>How we reached this verdict</summary>'), 'the heading stays readable');
  assert.match(css, /\.steps-details summary\s*\{[^}]*cursor:\s*pointer/, 'the disclosure looks clickable');
});

// Keyboard and accessibility.

test('a11y: dialogs trap focus, restore it on close, and lock page scroll', () => {
  assert.ok(existsSync(modalPath), 'a shared Modal component exists');
  const modal = read('../app/components/modal.js');
  assert.ok(modal.includes("e.key === 'Tab'"), 'Tab is trapped inside the dialog');
  assert.ok(modal.includes("e.key === 'Escape'"), 'Escape closes through the same path');
  assert.match(modal, /activeElement/, 'the opener is remembered');
  assert.match(modal, /body\.style\.overflow/, 'the page behind does not scroll');
  assert.ok((page.match(/<Modal\b/g) || []).length >= 3, 'result, viewer and delete dialogs share it');
});

test('a11y: navigation marks the current view and a skip link jumps to content', () => {
  assert.match(page, /aria-current=\{[^}]*'page'/, 'the active nav item is announced');
  assert.ok(page.includes('Skip to content'), 'skip link present');
  assert.ok(page.includes('id="main-content"'), 'skip target present');
  assert.match(css, /\.skip-link:focus/, 'skip link appears on focus');
});

test('a11y: Alt+arrow keys move between checked claims', () => {
  assert.ok(page.includes("'ArrowLeft'"), 'left arrow handled');
  assert.ok(page.includes("'ArrowRight'"), 'right arrow handled');
  assert.ok(page.includes('e.altKey'), 'plain arrows still scroll and edit');
});

test('a11y: the upload dropzone works from the keyboard and names the file', () => {
  const at = page.indexOf('data-upload-drop');
  const zone = page.slice(Math.max(0, at - 400), at + 1200);
  assert.ok(zone.includes('tabIndex={0}'), 'the zone can receive focus');
  assert.ok(zone.includes('role="button"'), 'the zone announces as actionable');
  assert.ok(page.includes('fileInput'), 'Enter opens the real file picker');
});

// Finding your way back.

test('wayback: the URL hash carries the view, document and claim', () => {
  assert.ok(page.includes("from '../lib/ui-state.mjs'"), 'the page uses the tested route helpers');
  assert.ok(page.includes('parseHash('), 'a pasted or refreshed link restores the view');
  assert.ok(page.includes('buildHash('), 'moving around rewrites the link');
  assert.ok(page.includes("'hashchange'"), 'the browser back button moves the view');
  assert.ok(page.includes('applyRouteDoc(next)'), 'back navigation re-selects the document at once, loaded or not');
});

test('wayback: claims inside a file can be searched and filtered by verdict', () => {
  assert.ok(page.includes('data-claim-filter'), 'filter controls anchor present');
  assert.ok(page.includes('Search claims in this file'), 'claim search is labelled');
  assert.ok(page.includes('Filter claims by verdict'), 'verdict filter is labelled');
  assert.ok(page.includes('filterClaims('), 'filtering uses the tested helper');
  assert.ok(page.includes('No claims match'), 'an empty result says so');
});

test('wayback: the vault feed can be searched by claim or source', () => {
  assert.ok(page.includes('vault-search'), 'vault search anchor present');
  assert.ok(page.includes('Search extracted claims or sources'), 'vault search is labelled');
  assert.ok(page.includes('No claims match'), 'an empty result says so');
});

test('wayback: evidence cards copy a citation with feedback', () => {
  assert.ok(verdict.includes('Copy citation'), 'copy action present on evidence');
  assert.match(verdict, /clipboard\.writeText/, 'the citation goes to the clipboard');
  assert.ok(verdict.includes('Copied'), 'the reader sees it worked');
});

test('wayback: history search waits for a pause instead of fetching per keystroke', () => {
  assert.ok(page.includes('createDebounced('), 'history loads through the debouncer');
  assert.ok(!/setHistQuery\(e\.target\.value\); void loadHistory/.test(page), 'no fetch fires inline on change');
});

test('wayback: first load says it is loading instead of showing an empty library', () => {
  assert.ok(page.includes('Loading your files'), 'initial loading state is written out');
});

test('debate: the interrogation input scrolls with the page instead of covering output', () => {
  const block = (css.match(/\.arena-console\{[^}]*\}/) || [])[0] || '';
  assert.ok(!/position:\s*sticky/.test(block), 'composer does not stick over the thread');
  assert.ok(!/position:\s*fixed/.test(block), 'composer does not float over the thread');
  assert.ok(!/bottom:\s*0/.test(block), 'composer does not pin to the viewport bottom');
});
