import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { planChunks, planFrameTimes, formatTimestamp, assembleVideoPages, videoToPages, planPlayback, makePlaybackVideo, MAX_VIDEO_SECONDS } from '../lib/video.mjs';

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
  const { pages, durationSec } = await videoToPages(Buffer.from('fake-video'), {
    probeDuration: async () => 75,
    extractAudioChunk: async (startSec, endSec) => Buffer.from(`wav-${startSec}-${endSec}`),
    transcribeChunk: async (wav) => { spoken.push(wav.toString()); return { transcript: `speech for ${wav.toString()}` }; },
    extractFrame: async (atSec) => Buffer.from(`jpg-${atSec}`).toString('base64'),
    captionFrame: async (b64, atSec) => { captioned.push(atSec); return `frame at ${atSec}`; },
  });
  assert.equal(durationSec, 75);
  assert.deepEqual(spoken, ['wav-0-50', 'wav-50-75']);
  assert.equal(captioned[0], 0);
  assert.equal(pages.length, 2);
  assert.match(pages[0].text, /speech for wav-0-50/);
  assert.match(pages[1].text, /speech for wav-50-75/);
  assert.match(pages[1].text, /frame at 50/);
});

test('videoToPages still returns frame pages when the video has no audio track', async () => {
  const { pages, durationSec } = await videoToPages(Buffer.from('fake-video'), {
    probeDuration: async () => 25,
    extractAudioChunk: async () => null,
    transcribeChunk: async () => { throw new Error('should not transcribe'); },
    extractFrame: async () => Buffer.from('jpg').toString('base64'),
    captionFrame: async (b64, atSec) => `silent frame ${atSec}`,
  });
  assert.equal(durationSec, 25);
  assert.equal(pages.length, 3);
  assert.match(pages[0].text, /silent frame 0/);
});

test('videoToPages surfaces an audio-chunk failure instead of treating it as silence', async () => {
  await assert.rejects(
    () => videoToPages(Buffer.from('fake-video'), {
      probeDuration: async () => 25,
      extractAudioChunk: async () => { throw new Error('ffmpeg exploded: invalid data while decoding'); },
      transcribeChunk: async () => ({ transcript: 'unused' }),
      extractFrame: async () => Buffer.from('jpg').toString('base64'),
      captionFrame: async () => 'a frame',
    }),
    /ffmpeg exploded/,
  );
});

test('videoToPages hides real ffmpeg stderr from the client error but keeps it in the log', async () => {
  // No extractAudioChunk dep: videoToPages runs the real ffmpegAudioChunk,
  // which probes with ffprobe and shells out to ffmpeg. Stub both binaries
  // on PATH so the probe reports an audio stream and ffmpeg fails.
  const bin = mkdtempSync(join(tmpdir(), 'tl-video-bin-'));
  writeFileSync(join(bin, 'ffprobe'), '#!/bin/sh\nprintf \'%s\' \'{"streams":[{"codec_type":"video"},{"codec_type":"audio"}]}\'\n');
  writeFileSync(join(bin, 'ffmpeg'), '#!/bin/sh\necho "invalid data while decoding stream" >&2\nexit 1\n');
  chmodSync(join(bin, 'ffprobe'), 0o755);
  chmodSync(join(bin, 'ffmpeg'), 0o755);
  const savedPath = process.env.PATH;
  process.env.PATH = `${bin}:${savedPath || ''}`;
  const logged = [];
  const realError = console.error;
  console.error = (...args) => { logged.push(args); };
  try {
    await assert.rejects(
      () => videoToPages(Buffer.from('fake-video-with-audio'), {
        probeDuration: async () => 25,
        transcribeChunk: async () => { throw new Error('should not transcribe'); },
        extractFrame: async () => Buffer.from('jpg').toString('base64'),
        captionFrame: async () => 'a frame',
      }),
      (err) => {
        const msg = String(err?.message || '');
        assert.ok(!msg.includes('invalid data while decoding stream'), `client error leaks ffmpeg stderr: ${msg}`);
        assert.match(msg, /Could not extract audio/);
        return true;
      },
    );
    assert.ok(logged.flat().join(' ').includes('invalid data while decoding stream'), 'full ffmpeg detail still goes to the server log');
  } finally {
    console.error = realError;
    if (savedPath === undefined) delete process.env.PATH; else process.env.PATH = savedPath;
    rmSync(bin, { recursive: true, force: true });
  }
});

test('planPlayback keeps only browser-safe video and audio codec pairs as-is', () => {
  assert.equal(planPlayback({ ext: '.mp4', videoCodec: 'h264', audioCodec: 'aac' }).action, 'keep');
  assert.equal(planPlayback({ ext: '.mp4', videoCodec: 'h264', audioCodec: null }).action, 'keep', 'silent video needs no playback copy');
  assert.equal(planPlayback({ ext: '.webm', videoCodec: 'vp9', audioCodec: 'opus' }).action, 'keep');
  assert.equal(planPlayback({ ext: '.mp4', videoCodec: 'h264', audioCodec: 'ac3' }).action, 'transcode', 'browsers show the picture but cannot decode AC-3 audio');
  assert.equal(planPlayback({ ext: '.mp4', videoCodec: 'h264', audioCodec: 'dts' }).action, 'transcode');
  assert.equal(planPlayback({ ext: '.mkv', videoCodec: 'h264', audioCodec: 'aac' }).action, 'transcode', 'Matroska is not a browser container');
  assert.equal(planPlayback({ ext: '.mov', videoCodec: 'h264', audioCodec: 'pcm_s16le' }).action, 'transcode');
});

test('makePlaybackVideo transcodes unsafe audio to an MP4 playback copy', async () => {
  const calls = [];
  const out = await makePlaybackVideo(Buffer.from('original-bytes'), {
    ext: '.mp4',
    probeStreams: async () => ({ videoCodec: 'h264', audioCodec: 'ac3' }),
    transcode: async (buf, plan) => { calls.push(plan); return Buffer.from('playback-bytes'); },
  });
  assert.equal(calls.length, 1, 'one transcode runs');
  assert.equal(calls[0].audioCodec, 'aac', 'the playback copy re-encodes audio as AAC');
  assert.equal(out.ext, '.mp4');
  assert.equal(out.mime, 'video/mp4');
  assert.equal(out.buffer.toString(), 'playback-bytes');
  assert.equal(out.transcoded, true);
});

test('makePlaybackVideo leaves a browser-safe file untouched and falls back when transcoding fails', async () => {
  const safe = await makePlaybackVideo(Buffer.from('original-bytes'), {
    ext: '.mp4',
    probeStreams: async () => ({ videoCodec: 'h264', audioCodec: 'aac' }),
    transcode: async () => { throw new Error('should not transcode'); },
  });
  assert.equal(safe.buffer.toString(), 'original-bytes');
  assert.equal(safe.transcoded, false);

  const fallback = await makePlaybackVideo(Buffer.from('original-bytes'), {
    ext: '.mkv',
    probeStreams: async () => ({ videoCodec: 'h264', audioCodec: 'ac3' }),
    transcode: async () => { throw new Error('ffmpeg exploded'); },
  });
  assert.equal(fallback.buffer.toString(), 'original-bytes', 'a failed transcode keeps the original rather than losing the file');
  assert.equal(fallback.ext, '.mkv');
  assert.equal(fallback.transcoded, false);
});

test('makePlaybackVideo turns a real AC-3 video into one with AAC audio', async (t) => {
  const { execFileSync } = await import('node:child_process');
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); } catch { t.skip('ffmpeg not available'); return; }
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const { readFile } = await import('node:fs/promises');
  const run = promisify(execFile);
  const dir = mkdtempSync(join(tmpdir(), 'tl-playback-'));
  try {
    const src = join(dir, 'ac3.mp4');
    await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=10', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'ac3', '-shortest', src]);
    const out = await makePlaybackVideo(await readFile(src), { ext: '.mp4' });
    assert.equal(out.transcoded, true);
    const dst = join(dir, 'playback.mp4');
    writeFileSync(dst, out.buffer);
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'csv=p=0', dst]);
    assert.match(stdout, /h264,video/);
    assert.match(stdout, /aac,audio/, 'the stored playback copy carries AAC audio a browser can play');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('videoToPages rejects empty input and over-long videos before any transcription', async () => {
  await assert.rejects(() => videoToPages(Buffer.alloc(0), { probeDuration: async () => 10 }), /empty/i);
  await assert.rejects(() => videoToPages(Buffer.from('x'), {
    probeDuration: async () => MAX_VIDEO_SECONDS + 1,
    transcribeChunk: async () => { throw new Error('should not transcribe'); },
  }), /too long/i);
});
