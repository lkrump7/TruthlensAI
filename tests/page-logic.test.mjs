import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldFallbackAfterStreamError, classifyUpload, pageLabel } from '../lib/page-logic.mjs';

test('shouldFallbackAfterStreamError is false for HTTP error statuses', () => {
  for (const status of [400, 401, 403, 404, 429, 500, 503]) {
    const err = new Error('stream unavailable');
    err.status = status;
    assert.equal(shouldFallbackAfterStreamError(err), false, `status ${status} must not fall back`);
  }
});

test('shouldFallbackAfterStreamError is true for network failures', () => {
  const network = new TypeError('fetch failed');
  assert.equal(shouldFallbackAfterStreamError(network), true);
});

test('shouldFallbackAfterStreamError is true for a truncated stream', () => {
  assert.equal(shouldFallbackAfterStreamError(new Error('stream ended without a verdict')), true);
});

test('classifyUpload accepts each known type within its byte limit', () => {
  assert.deepEqual(classifyUpload({ name: 'paper.pdf', size: 1024 }).kind, 'pdf');
  assert.deepEqual(classifyUpload({ name: 'paper.docx', size: 1024 }).kind, 'docx');
  assert.deepEqual(classifyUpload({ name: 'scan.png', size: 1024 }).kind, 'image');
  assert.deepEqual(classifyUpload({ name: 'clip.mp4', size: 1024 }).kind, 'video');
  assert.deepEqual(classifyUpload({ name: 'clip.mp3', size: 1024 }).kind, 'audio');
  assert.deepEqual(classifyUpload({ name: 'notes.txt', size: 1024 }).kind, 'text');
  for (const r of [
    classifyUpload({ name: 'paper.pdf', size: 1024 }),
    classifyUpload({ name: 'scan.png', size: 1024 }),
    classifyUpload({ name: 'notes.txt', size: 1024 }),
  ]) assert.equal(r.ok, true);
});

test('classifyUpload rejects files over the existing byte limits', () => {
  const MB = 1024 * 1024;
  assert.equal(classifyUpload({ name: 'big.pdf', size: 15 * MB + 1 }).ok, false);
  assert.equal(classifyUpload({ name: 'big.docx', size: 15 * MB + 1 }).ok, false);
  assert.equal(classifyUpload({ name: 'big.png', size: 10 * MB + 1 }).ok, false);
  assert.equal(classifyUpload({ name: 'big.mp4', size: 100 * MB + 1 }).ok, false);
  assert.equal(classifyUpload({ name: 'big.mp3', size: 50 * MB + 1 }).ok, false);
  assert.equal(classifyUpload({ name: 'big.txt', size: 15 * MB + 1 }).ok, false);
});

test('classifyUpload checks text size before the file is read', () => {
  const MB = 1024 * 1024;
  const over = classifyUpload({ name: 'notes.txt', size: 16 * MB });
  assert.equal(over.ok, false);
  assert.match(over.error, /15 MB/);
});

test('classifyUpload rejects unsupported types instead of skipping limits', () => {
  for (const name of ['run.exe', 'archive.zip', 'sheet.xlsx', 'noextension', 'notes.csv']) {
    const r = classifyUpload({ name, size: 10 });
    assert.equal(r.ok, false, `${name} must be rejected`);
    assert.ok(r.error, 'rejection carries a message');
  }
});

test('pageLabel prefers pages[0] and never shows undefined', () => {
  assert.equal(pageLabel({ pages: [5], page: undefined }), 'Page 5');
  assert.equal(pageLabel({ pages: [5] }), 'Page 5');
  assert.equal(pageLabel({ pages: [2, 3] }), 'Pages 2, 3');
  assert.equal(pageLabel({ page: 7 }), 'Page 7');
  assert.equal(pageLabel({}), 'Page ?');
  assert.equal(pageLabel(null), 'Page ?');
  for (const c of [{ pages: [5] }, { page: undefined }, {}]) {
    assert.doesNotMatch(pageLabel(c), /undefined/);
  }
});
