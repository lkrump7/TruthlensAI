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

test('library ask handoff opens the ask tool for its own source', () => {
  const at = page.indexOf('data-ask-link');
  assert.ok(at > -1, 'library ask block exists');
  const block = page.slice(at, at + 1200);
  assert.ok(block.includes('setDoc(doc)'), 'handoff keeps its own source open');
  assert.match(block, /setTool\('document'\)/, 'handoff still opens the document tool');
});

test('empty ask state offers a way to add a file or a URL', () => {
  const at = page.indexOf('data-assess-form');
  assert.ok(at > -1, 'assess form exists');
  const block = page.slice(at, at + 4000);
  const emptyAt = block.indexOf('Add an excerpt or a website first');
  assert.ok(emptyAt > -1, 'empty ask state exists');
  const empty = block.slice(Math.max(0, emptyAt - 200), emptyAt + 1500);
  assert.ok(empty.includes("setTool('website')"), 'empty ask state links to the website tool');
  assert.ok(empty.includes('setShowUpload') || empty.includes('data-upload'), 'empty ask state links back to file ingest');
});

test('ask form uses the active source with no duplicate file dropdown', () => {
  const at = page.indexOf('data-assess-form');
  assert.ok(at > -1, 'assess form exists');
  const block = page.slice(at, at + 3000);
  assert.ok(!block.includes('<select'), 'ask form has no duplicate source dropdown');
  assert.ok(!block.includes('Pick a file'), 'no duplicate Pick a file picker');
  assert.ok(!block.includes('Choose a document'), 'no Choose a document dropdown');
  assert.ok(block.includes('assessDoc'), 'ask form asks the active source');
});
