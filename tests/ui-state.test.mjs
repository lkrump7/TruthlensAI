import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, buildHash, filterClaims, createDebounced, uploadSizeError, detectCheckInput, timeAgo, claimCategory, safeResponseJson } from '../lib/ui-state.mjs';

test('buildHash writes a readable route for every view', () => {
  assert.equal(buildHash({ tab: 'home' }), '#/home');
  assert.equal(buildHash({ tab: 'check', tool: 'website' }), '#/check/website');
  assert.equal(buildHash({ tab: 'check' }), '#/check/claim');
  assert.equal(buildHash({ tab: 'claims' }), '#/claims');
  assert.equal(buildHash({ tab: 'history' }), '#/history');
  assert.equal(buildHash({ tab: 'library' }), '#/library');
  assert.equal(buildHash({ tab: 'library', docId: 'doc-1' }), '#/library/doc-1');
  assert.equal(buildHash({ tab: 'library', docId: 'doc-1', claimId: 'c/2' }), '#/library/doc-1/c%2F2');
});

test('parseHash reads back what buildHash wrote', () => {
  for (const state of [
    { tab: 'home' },
    { tab: 'check', tool: 'document' },
    { tab: 'claims' },
    { tab: 'library', docId: 'doc-1', claimId: 'c/2' },
  ]) {
    assert.deepEqual(parseHash(buildHash(state)), state);
  }
});

test('legacy ask links land on the single ask tool', () => {
  assert.deepEqual(parseHash('#/check/question'), { tab: 'check', tool: 'document' });
  assert.equal(buildHash({ tab: 'check', tool: 'question' }), '#/check/document');
});

test('parseHash returns null for empty or unknown routes instead of guessing', () => {
  assert.equal(parseHash(''), null);
  assert.equal(parseHash('#'), null);
  assert.equal(parseHash('#/nope'), null);
  assert.equal(parseHash('#/check/nonsense'), null);
  assert.equal(parseHash(undefined), null);
});

test('parseHash returns null for malformed percent encoding instead of throwing', () => {
  assert.equal(parseHash('#/library/%E0%A4%A'), null);
  assert.equal(parseHash('#/library/doc-1/%E0%A4%A'), null);
  assert.deepEqual(parseHash('#/library/doc-1'), { tab: 'library', docId: 'doc-1' });
});

test('filterClaims matches text case-insensitively and narrows by verdict', () => {
  const claims = [
    { id: '1', text: 'Water boils at 100 degrees.', verdict: 'Supported' },
    { id: '2', text: 'Humans use 10% of their brains.', verdict: 'Contradicted' },
    { id: '3', text: 'Brain size predicts memory.', verdict: null },
  ];
  assert.deepEqual(filterClaims(claims, { query: 'BRAIN' }).map((c) => c.id), ['2', '3']);
  assert.deepEqual(filterClaims(claims, { verdict: 'Supported' }).map((c) => c.id), ['1']);
  assert.deepEqual(filterClaims(claims, { verdict: 'unchecked' }).map((c) => c.id), ['3']);
  assert.deepEqual(filterClaims(claims, { query: 'brain', verdict: 'Contradicted' }).map((c) => c.id), ['2']);
  assert.equal(filterClaims(claims).length, 3);
  assert.deepEqual(filterClaims(null, { query: 'x' }), []);
});

test('uploadSizeError rejects oversize files before upload, by kind', () => {
  const MB = 1024 * 1024;
  assert.equal(uploadSizeError({ name: 'a.pdf', size: 16 * MB }), 'PDF is larger than 15 MB.');
  assert.equal(uploadSizeError({ name: 'a.docx', size: 16 * MB }), 'DOCX is larger than 15 MB.');
  assert.equal(uploadSizeError({ name: 'a.png', size: 11 * MB }), 'Image is larger than 10 MB.');
  assert.equal(uploadSizeError({ name: 'a.mp4', size: 101 * MB }), 'Video is larger than 100 MB.');
  assert.equal(uploadSizeError({ name: 'a.pdf', size: 15 * MB }), null);
  assert.equal(uploadSizeError({ name: 'notes.txt', size: 500 * MB }), 'Text is larger than 15 MB.');
  assert.equal(uploadSizeError({ name: 'notes.md', size: 16 * MB }), 'Text is larger than 15 MB.');
  assert.equal(uploadSizeError({ name: 'notes.txt', size: 1 * MB }), null);
});

test('detectCheckInput routes one box to claims, a page, or a pasted document', () => {
  assert.equal(detectCheckInput({ text: 'Humans only use 10% of their brains.' }), 'claim');
  assert.equal(detectCheckInput({ text: 'First claim.\nSecond claim.\nThird claim.' }), 'claim');
  assert.equal(detectCheckInput({ text: '' }), 'claim');
  assert.equal(detectCheckInput({ text: '  https://example.org/article  ' }), 'website');
  assert.equal(detectCheckInput({ text: 'HTTP://EXAMPLE.ORG/A' }), 'website');
  assert.equal(detectCheckInput({ text: 'Is https://example.org true?' }), 'claim', 'a URL inside a sentence stays a claim');
  assert.equal(detectCheckInput({ text: 'www.example.org/article' }), 'claim', 'a bare domain without a scheme stays a claim');
  assert.equal(detectCheckInput({ text: 'x'.repeat(1499) }), 'claim');
  assert.equal(detectCheckInput({ text: 'x'.repeat(1500) }), 'document');
  assert.equal(detectCheckInput({ text: 'https://example.org/a-very-long-' + 'x'.repeat(2000) }), 'website', 'a long URL is still a page');
});

test('timeAgo names recency the way the vault shows it', () => {
  const noon = new Date(); noon.setHours(12, 0, 0, 0);
  const now = noon.getTime();
  assert.match(timeAgo(new Date(now - 60 * 1000).toISOString(), now), /^Today, \d/, 'same day shows the time');
  const yesterday = new Date(noon.getTime() - 26 * 3600 * 1000);
  assert.match(timeAgo(yesterday.toISOString(), now), /^Yesterday, \d/, 'yesterday shows the time');
  assert.equal(timeAgo(new Date(noon.getTime() - 3 * 86400 * 1000).toISOString(), now), '3 days ago');
  assert.equal(timeAgo(new Date(noon.getTime() - 6 * 86400 * 1000).toISOString(), now), '6 days ago');
  const old = new Date(noon.getTime() - 30 * 86400 * 1000);
  assert.match(timeAgo(old.toISOString(), now), /^[A-Z][a-z]+ \d{1,2}, \d{4}$/, 'older dates show month, day, year');
  assert.equal(timeAgo('', now), '');
  assert.equal(timeAgo('not-a-date', now), '');
});

test('claimCategory sorts documents into vault tabs', () => {
  assert.equal(claimCategory({ kind: 'book' }), 'book');
  assert.equal(claimCategory({ kind: 'website' }), 'paper');
  assert.equal(claimCategory({ kind: 'image' }), 'scan');
  assert.equal(claimCategory({ kind: 'video' }), 'scan');
  assert.equal(claimCategory({ kind: 'history' }), 'book');
  assert.equal(claimCategory({}), 'book');
  assert.equal(claimCategory(null), 'book');
});

test('safeResponseJson returns parsed JSON and {} on non-JSON bodies', async () => {
  assert.deepEqual(await safeResponseJson({ json: async () => ({ document: { title: 'T' } }) }), { document: { title: 'T' } });
  assert.deepEqual(await safeResponseJson({ json: async () => { throw new SyntaxError('Unexpected token'); } }), {});
});

test('createDebounced runs only the last call, and cancel drops it', async () => {
  const calls = [];
  const run = createDebounced((v) => calls.push(v), 15);
  run('a'); run('b'); run('c');
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(calls, ['c']);
  run('d'); run.cancel();
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(calls, ['c']);
});
