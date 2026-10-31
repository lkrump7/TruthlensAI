import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planChunks, planFrameTimes, formatTimestamp, assembleVideoPages, videoToPages, MAX_VIDEO_SECONDS } from '../lib/video.mjs';

test('planChunks splits a duration into 50 second windows', () => {
  assert.deepEqual(planChunks(0), []);
  assert.deepEqual(planChunks(50), [{ startSec: 0, endSec: 50 }]);
  assert.deepEqual(planChunks(121), [
    { startSec: 0, endSec: 50 },
    { startSec: 50, endSec: 100 },
    { startSec: 100, endSec: 121 },
  ]);
});

test('planFrameTimes samples every 10 seconds and caps at 12 frames', () => {
  assert.deepEqual(planFrameTimes(3), [0]);
  assert.deepEqual(planFrameTimes(35), [0, 10, 20, 30]);
  const long = planFrameTimes(3600);
  assert.equal(long.length, 12);
  assert.equal(long[0], 0);
});

test('formatTimestamp renders mm:ss', () => {
  assert.equal(formatTimestamp(0), '00:00');
  assert.equal(formatTimestamp(65), '01:05');
  assert.equal(formatTimestamp(600), '10:00');
});

test('assembleVideoPages merges speech and frame captions into one timestamped page per window', () => {
  const pages = assembleVideoPages({
    chunks: [
      { startSec: 0, endSec: 50, transcript: 'Water boils at 100 degrees.' },
      { startSec: 50, endSec: 80, transcript: '' },
    ],
    frames: [
      { atSec: 10, caption: 'A thermometer in a pot.' },
      { atSec: 60, caption: 'A chart on a wall.' },
    ],
  });
  assert.equal(pages.length, 2);
  assert.match(pages[0].text, /\[00:00–00:50\]/);
  assert.match(pages[0].text, /Speech: Water boils at 100 degrees\./);
  assert.match(pages[0].text, /Visual \(00:10\): A thermometer in a pot\./);
  assert.match(pages[1].text, /Visual \(01:00\): A chart on a wall\./);
  assert.doesNotMatch(pages[1].text, /Speech:/);
});

test('assembleVideoPages keeps frames when there is no speech at all', () => {
  const pages = assembleVideoPages({ chunks: [], frames: [{ atSec: 0, caption: 'A silent chart.' }, { atSec: 20, caption: 'A second chart.' }] });
  assert.equal(pages.length, 2);
  assert.match(pages[0].text, /A silent chart\./);
  assert.deepEqual(assembleVideoPages({ chunks: [], frames: [] }), []);
  assert.deepEqual(assembleVideoPages({ chunks: [{ startSec: 0, endSec: 50, transcript: '  ' }], frames: [] }), []);
});

test('videoToPages transcribes each audio chunk in order and captions each sampled frame', async () => {
  const spoken = [];
  const captioned = [];
  const pages = await videoToPages(Buffer.from('fake-video'), {
    probeDuration: async () => 75,
    extractAudioChunk: async (startSec, endSec) => Buffer.from(`wav-${startSec}-${endSec}`),
    transcribeChunk: async (wav) => { spoken.push(wav.toString()); return { transcript: `speech for ${wav.toString()}` }; },
    extractFrame: async (atSec) => Buffer.from(`jpg-${atSec}`).toString('base64'),
    captionFrame: async (b64, atSec) => { captioned.push(atSec); return `frame at ${atSec}`; },
  });
  assert.deepEqual(spoken, ['wav-0-50', 'wav-50-75']);
  assert.equal(captioned[0], 0);
  assert.equal(pages.length, 2);
  assert.match(pages[0].text, /speech for wav-0-50/);
  assert.match(pages[1].text, /speech for wav-50-75/);
  assert.match(pages[1].text, /frame at 50/);
});

test('videoToPages still returns frame pages when the video has no audio track', async () => {
  const pages = await videoToPages(Buffer.from('fake-video'), {
    probeDuration: async () => 25,
    extractAudioChunk: async () => null,
    transcribeChunk: async () => { throw new Error('should not transcribe'); },
    extractFrame: async () => Buffer.from('jpg').toString('base64'),
    captionFrame: async (b64, atSec) => `silent frame ${atSec}`,
  });
  assert.equal(pages.length, 3);
  assert.match(pages[0].text, /silent frame 0/);
});

test('videoToPages rejects empty input and over-long videos before any transcription', async () => {
  await assert.rejects(() => videoToPages(Buffer.alloc(0), { probeDuration: async () => 10 }), /empty/i);
  await assert.rejects(() => videoToPages(Buffer.from('x'), {
    probeDuration: async () => MAX_VIDEO_SECONDS + 1,
    transcribeChunk: async () => { throw new Error('should not transcribe'); },
  }), /too long/i);
});
