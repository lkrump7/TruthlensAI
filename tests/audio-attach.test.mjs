import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const page = readFileSync(new URL('../app/page.js', import.meta.url), 'utf8');
const icons = readFileSync(new URL('../app/components/icons.js', import.meta.url), 'utf8');

test('audio uploads go to the audio transcription route', () => {
  assert.ok(page.includes('/api/documents/audio'), 'upload posts audio files to the audio route');
  assert.ok(page.includes('mp3'), 'upload recognises audio filenames');
});

test('the file picker accepts standalone audio', () => {
  assert.ok(page.includes('.mp3'), 'picker accept lists an audio extension');
  assert.ok(page.includes('audio/*'), 'picker accept lists audio/*');
});

test('the library viewer plays audio originals', () => {
  assert.ok(page.includes("viewerDoc.kind === 'audio'"), 'viewer handles the audio kind');
  assert.ok(page.includes('<audio'), 'viewer renders an audio player');
});

test('there is an audio icon for audio badges', () => {
  assert.ok(icons.includes('audio:'), 'icon set names an audio icon');
});

test('the audio player stretches full width like the video player', () => {
  const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
  assert.ok(css.includes('audio.viewer-media'), 'viewer CSS sizes the audio player');
});
