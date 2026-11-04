import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mimeForAudioFile,
  formatTimestamp,
  planChunks,
  assembleAudioPages,
  audioToPages,
  makePlaybackAudio,
  MAX_AUDIO_FILE_SECONDS,
} from '../lib/audio.mjs';

test('mimeForAudioFile maps common audio extensions and rejects others', () => {
  assert.equal(mimeForAudioFile('a.MP3'), 'audio/mpeg');
  assert.equal(mimeForAudioFile('a.wav'), 'audio/wav');
  assert.equal(mimeForAudioFile('a.m4a'), 'audio/mp4');
  assert.equal(mimeForAudioFile('a.ogg'), 'audio/ogg');
  assert.equal(mimeForAudioFile('a.flac'), 'audio/flac');
  assert.equal(mimeForAudioFile('a.mp4'), null);
  assert.equal(mimeForAudioFile('a.png'), null);
});

test('formatTimestamp renders mm:ss', () => {
  assert.equal(formatTimestamp(0), '00:00');
  assert.equal(formatTimestamp(65), '01:05');
});

test('planChunks splits a duration into 50 second windows', () => {
  assert.deepEqual(planChunks(0), []);
  assert.deepEqual(planChunks(50), [{ startSec: 0, endSec: 50 }]);
  assert.deepEqual(planChunks(121), [
    { startSec: 0, endSec: 50 },
    { startSec: 50, endSec: 100 },
    { startSec: 100, endSec: 121 },
  ]);
});

test('assembleAudioPages keeps one timestamped page per spoken chunk', () => {
  const pages = assembleAudioPages({
    chunks: [
      { startSec: 0, endSec: 50, transcript: 'Water boils at 100 degrees.' },
      { startSec: 50, endSec: 80, transcript: '  ' },
    ],
  });
  assert.equal(pages.length, 1);
  assert.match(pages[0].text, /\[00:00–00:50\]/);
  assert.match(pages[0].text, /Speech: Water boils at 100 degrees\./);
  assert.deepEqual(assembleAudioPages({ chunks: [] }), []);
});

test('audioToPages transcribes each chunk in order with stubbed deps', async () => {
  const spoken = [];
  const { pages, durationSec } = await audioToPages(Buffer.from('fake-audio'), {
    probeDuration: async () => 75,
    extractAudioChunk: async (startSec, endSec) => Buffer.from(`wav-${startSec}-${endSec}`),
    transcribeChunk: async (wav) => { spoken.push(wav.toString()); return { transcript: `speech for ${wav.toString()}` }; },
  });
  assert.equal(durationSec, 75);
  assert.deepEqual(spoken, ['wav-0-50', 'wav-50-75']);
  assert.equal(pages.length, 2);
  assert.match(pages[0].text, /speech for wav-0-50/);
  assert.match(pages[1].text, /speech for wav-50-75/);
});

test('audioToPages rejects an empty buffer and an overlong file', async () => {
  await assert.rejects(() => audioToPages(Buffer.alloc(0)), /empty/i);
  await assert.rejects(
    () => audioToPages(Buffer.from('x'), { probeDuration: async () => MAX_AUDIO_FILE_SECONDS + 1 }),
    /too long/i,
  );
});

test('audioToPages surfaces an ffmpeg extraction failure', async () => {
  await assert.rejects(
    () => audioToPages(Buffer.from('fake-audio'), {
      probeDuration: async () => 25,
      extractAudioChunk: async () => { throw new Error('ffmpeg exploded: invalid data'); },
      transcribeChunk: async () => ({ transcript: 'unused' }),
    }),
    /ffmpeg exploded/,
  );
});

test('makePlaybackAudio keeps a file with a known extension untouched', async () => {
  const out = await makePlaybackAudio(Buffer.from('original-bytes'), {
    ext: '.mp3',
    probeFormat: async () => { throw new Error('should not probe'); },
    transcode: async () => { throw new Error('should not transcode'); },
  });
  assert.equal(out.buffer.toString(), 'original-bytes');
  assert.equal(out.ext, '.mp3');
  assert.equal(out.mime, 'audio/mpeg');
  assert.equal(out.transcoded, false);
});

test('makePlaybackAudio stores extensionless audio as a playable MP3 copy', async () => {
  const calls = [];
  const out = await makePlaybackAudio(Buffer.from('original-bytes'), {
    ext: '',
    probeFormat: async () => ({ hasAudio: true }),
    transcode: async (buf) => { calls.push(buf.toString()); return Buffer.from('mp3-bytes'); },
  });
  assert.equal(calls.length, 1, 'the bytes are re-encoded once');
  assert.equal(out.buffer.toString(), 'mp3-bytes');
  assert.equal(out.ext, '.mp3');
  assert.equal(out.mime, 'audio/mpeg');
  assert.equal(out.transcoded, true);
});

test('makePlaybackAudio keeps nothing playable when the bytes hold no audio', async () => {
  const silent = await makePlaybackAudio(Buffer.from('not-audio'), {
    ext: '',
    probeFormat: async () => ({ hasAudio: false }),
    transcode: async () => { throw new Error('should not transcode'); },
  });
  assert.equal(silent.mime, null, 'no mime is invented for bytes that are not audio');
  const failed = await makePlaybackAudio(Buffer.from('original-bytes'), {
    ext: '',
    probeFormat: async () => { throw new Error('ffprobe exploded'); },
    transcode: async () => { throw new Error('should not transcode'); },
  });
  assert.equal(failed.mime, null, 'a failed probe also stores nothing rather than a mislabeled file');
});
