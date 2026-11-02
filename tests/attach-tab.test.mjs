import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../app/page.js', import.meta.url), 'utf8');

test('file, image, audio and video share one attach tab, not two', () => {
  assert.ok(!page.includes('Audio & Video (10S/MB)'), 'no separate hero audio/video pill with the typo limit');
  assert.ok(!page.includes('>Audio and video<'), 'no separate omnibar audio/video pill');
});

test('the one attach tab names every file kind it takes', () => {
  assert.ok(page.includes('Attach File (PDF, image, audio, video)'), 'hero pill names all kinds');
  assert.ok(page.includes('Ask a source anything'), 'omnibar document pill renamed to Ask a source anything');
});

test('the upload panel describes all file kinds in one place', () => {
  const at = page.indexOf('data-upload');
  assert.ok(at > -1, 'upload panel exists');
  const block = page.slice(at, at + 4000);
  for (const kind of ['PDF', 'image', 'audio', 'video']) {
    assert.ok(block.toLowerCase().includes(kind.toLowerCase()), `upload description names ${kind}`);
  }
});
