import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const page = ['../app/components/icons.js', '../app/components/mic.js', '../app/page.js'].map(read).join('\n');

test('check omnibar offers one Ask a source anything backed by the document tool', () => {
  const count = page.split('Ask a source anything').length - 1;
  assert.equal(count, 1, 'exactly one ask pill remains in the omnibar');
  assert.match(page, /setTool\('document'\)/, 'the ask pill opens the document tool');
  assert.ok(!page.includes("setTool('question')"), 'no question tool remains');
  assert.ok(page.includes('data-assess-form'), 'the ask form lives inside the document tool');
  assert.ok(page.includes('Dictate a theory'), 'theory field keeps voice dictation');
});
