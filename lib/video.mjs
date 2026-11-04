import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MetaApiError } from './errors.mjs';
import { transcribeAudio } from './voice.mjs';
import { defaultMetaClient } from './meta.mjs';
import { CAPTION_SYSTEM, frameCaptionInstruction } from './prompts.mjs';

// Video ingestion: ffmpeg splits the file, Muse Voice Transcribe takes
// the speech and Muse Spark vision captions sampled frames. There is no
// native Meta video endpoint in this app, so the two are merged by
// timestamp into pages the claim pipeline can read like excerpt pages.
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 600;
export const VIDEO_CHUNK_SECONDS = 50;
export const FRAME_INTERVAL_SECONDS = 10;
export const MAX_FRAMES = 12;

export const VIDEO_MIME_BY_EXT = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
};

/** @param {string} name */
export function mimeForVideoFile(name) {
  const m = String(name || '').toLowerCase().match(/\.[a-z0-9]+$/);
  return (m && VIDEO_MIME_BY_EXT[m[0]]) || null;
}

const run = promisify(execFile);

// ffprobe must wait as long as an extraction chunk: a slow file that
// probes past a short timeout would fail ingestion even though ffmpeg
// itself would have finished the same read.
export const FFPROBE_TIMEOUT_MS = 120000;
export const FFMPEG_AUDIO_TIMEOUT_MS = 120000;
export const FFMPEG_FRAME_TIMEOUT_MS = 60000;
export const FFMPEG_PLAYBACK_TIMEOUT_MS = 300000;

// ffmpeg failures carry tmpdir paths and raw stderr. Those stay in the
// server log; the client gets a generic message that names no paths.
export function sanitizeFfmpegError(err, target = 'video') {
  const detail = String(err?.stderr || '').trim() || String(err?.message || err || 'unknown ffmpeg error').trim();
  console.error(`[truthlens] ffmpeg failed on ${target}:`, detail.slice(0, 2000));
  return new MetaApiError(`Could not extract audio from that ${target}. It may be corrupt or use an unsupported format.`);
}

/** @param {number} sec */
export function formatTimestamp(sec) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** @param {number} durationSec @param {number} [chunkSec] */
export function planChunks(durationSec, chunkSec = VIDEO_CHUNK_SECONDS) {
  const total = Number(durationSec) || 0;
  const out = [];
  for (let start = 0; start < total; start += chunkSec) out.push({ startSec: start, endSec: Math.min(total, start + chunkSec) });
  return out;
}

/** @param {number} durationSec @param {number} [intervalSec] @param {number} [maxFrames] */
export function planFrameTimes(durationSec, intervalSec = FRAME_INTERVAL_SECONDS, maxFrames = MAX_FRAMES) {
  const total = Number(durationSec) || 0;
  if (total <= 0) return [];
  const times = [];
  for (let t = 0; t < total && times.length < maxFrames; t += intervalSec) times.push(t);
  return times;
}

/**
 * One page per time window. Speech comes from the audio chunk covering
 * the window; frames are filed under the window they fall in. A silent
 * video gets one page per frame instead of an error.
 * @param {{ chunks?: {startSec:number,endSec:number,transcript?:string}[], frames?: {atSec:number,caption?:string}[] }} args
 */
export function assembleVideoPages({ chunks = [], frames = [] } = {}) {
  const cleanFrames = (frames || []).filter((f) => f && String(f.caption || '').trim());
  const spoken = (chunks || []).map((c) => ({ startSec: c.startSec, endSec: c.endSec, transcript: String(c.transcript || '').trim() }));
  const windows = spoken.some((c) => c.transcript)
    ? spoken
    : cleanFrames.map((f) => ({ startSec: f.atSec, endSec: f.atSec + FRAME_INTERVAL_SECONDS, transcript: '' }));
  const pages = [];
  for (const w of windows) {
    const visual = cleanFrames.filter((f) => f.atSec >= w.startSec && f.atSec < w.endSec);
    if (!w.transcript && !visual.length) continue;
    const lines = [`[${formatTimestamp(w.startSec)}–${formatTimestamp(w.endSec)}]`];
    if (w.transcript) lines.push(`Speech: ${w.transcript}`);
    for (const f of visual) lines.push(`Visual (${formatTimestamp(f.atSec)}): ${String(f.caption).trim()}`);
    pages.push({ page: pages.length + 1, text: lines.join(' ') });
  }
  return pages;
}

async function ffprobeDuration(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file], { timeout: FFPROBE_TIMEOUT_MS });
  const duration = Number(JSON.parse(stdout)?.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new MetaApiError('That video has no readable duration. It may be corrupt or in a format ffmpeg cannot read.');
  return duration;
}

async function ffprobeHasAudio(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', file], { timeout: FFPROBE_TIMEOUT_MS });
  const streams = JSON.parse(stdout)?.streams;
  return Array.isArray(streams) && streams.some((s) => s?.codec_type === 'audio');
}

async function ffmpegAudioChunk(file, dir, startSec, endSec) {
  // No audio stream is not an error: frames still carry a silent video.
  if (!await ffprobeHasAudio(file)) return null;
  const out = join(dir, `audio-${startSec}.wav`);
  try {
    await run('ffmpeg', ['-v', 'error', '-ss', String(startSec), '-to', String(endSec), '-i', file, '-vn', '-ac', '1', '-ar', '24000', '-f', 'wav', '-y', out], { timeout: FFMPEG_AUDIO_TIMEOUT_MS });
  } catch (e) {
    throw sanitizeFfmpegError(e, 'video');
  }
  const wav = await readFile(out).catch(() => null);
  return wav && wav.length > 44 ? wav : null;
}

// Browsers only decode a narrow set of video and audio codecs. An MP4
// with AC-3 or DTS audio, or any Matroska file, shows picture with no
// sound (or nothing) in the viewer even though ffmpeg reads it fine for
// transcription. The stored playback copy is therefore normalized to
// H.264 + AAC in MP4 unless the upload already uses codecs every
// browser plays.
const WEBM_SAFE_VIDEO = new Set(['vp8', 'vp9', 'av1']);
const WEBM_SAFE_AUDIO = new Set(['opus', 'vorbis']);

/**
 * @param {{ ext?: string, videoCodec?: string|null, audioCodec?: string|null }} streams
 * @returns {{ action: 'keep' } | { action: 'transcode', ext: string, mime: string, videoCodec: string, audioCodec: string|null }}
 */
export function planPlayback({ ext, videoCodec, audioCodec } = {}) {
  const e = String(ext || '').toLowerCase();
  const v = String(videoCodec || '').toLowerCase() || null;
  const a = String(audioCodec || '').toLowerCase() || null;
  const safe = (e === '.mp4' || e === '.mov') && v === 'h264' && (a === null || a === 'aac')
    || e === '.webm' && WEBM_SAFE_VIDEO.has(v) && (a === null || WEBM_SAFE_AUDIO.has(a));
  if (safe) return { action: 'keep' };
  return { action: 'transcode', ext: '.mp4', mime: 'video/mp4', videoCodec: v === 'h264' ? 'copy' : 'libx264', audioCodec: a ? 'aac' : null };
}

async function ffprobeStreams(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', file], { timeout: FFPROBE_TIMEOUT_MS });
  const streams = JSON.parse(stdout)?.streams;
  const list = Array.isArray(streams) ? streams : [];
  return {
    videoCodec: list.find((s) => s?.codec_type === 'video')?.codec_name || null,
    audioCodec: list.find((s) => s?.codec_type === 'audio')?.codec_name || null,
  };
}

async function ffmpegPlayback(buffer, ext, plan) {
  const dir = await mkdtemp(join(tmpdir(), 'truthlens-playback-'));
  try {
    const input = join(dir, `input${ext || '.mp4'}`);
    const out = join(dir, 'playback.mp4');
    await writeFile(input, buffer);
    const args = ['-v', 'error', '-i', input, '-map', '0:v:0'];
    if (plan.audioCodec) args.push('-map', '0:a:0');
    args.push('-c:v', plan.videoCodec);
    if (plan.videoCodec === 'libx264') args.push('-pix_fmt', 'yuv420p');
    if (plan.audioCodec) args.push('-c:a', 'aac', '-b:a', '160k');
    args.push('-movflags', '+faststart', '-y', out);
    await run('ffmpeg', args, { timeout: FFMPEG_PLAYBACK_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function probeStreamsWith(buffer, ext) {
  const dir = await mkdtemp(join(tmpdir(), 'truthlens-playback-probe-'));
  try {
    const input = join(dir, `input${ext || '.mp4'}`);
    await writeFile(input, buffer);
    return await ffprobeStreams(input);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Returns the bytes the viewer should store: the upload itself when a
 * browser can play both its streams, otherwise an MP4 copy with the
 * audio re-encoded as AAC. Any failure keeps the original bytes, so a
 * normalization problem never loses the file.
 * @param {Buffer|Uint8Array} buffer
 * @param {{ ext?: string, probeStreams?: Function, transcode?: Function }} [deps]
 * @returns {Promise<{ buffer: Buffer, ext: string, mime: string|null, transcoded: boolean }>}
 */
export async function makePlaybackVideo(buffer, deps = {}) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const ext = String(deps.ext || '').toLowerCase();
  const keep = { buffer: buf, ext, mime: VIDEO_MIME_BY_EXT[ext] || null, transcoded: false };
  if (!buf.length) return keep;
  let streams;
  try {
    streams = await (deps.probeStreams || ((b) => probeStreamsWith(b, ext)))(buf);
  } catch {
    return keep;
  }
  const plan = planPlayback({ ext, videoCodec: streams?.videoCodec, audioCodec: streams?.audioCodec });
  if (plan.action === 'keep') return keep;
  try {
    const out = await (deps.transcode || ((b, p) => ffmpegPlayback(b, ext, p)))(buf, plan);
    if (!out?.length) return keep;
    return { buffer: Buffer.from(out), ext: plan.ext, mime: plan.mime, transcoded: true };
  } catch (e) {
    console.error('[truthlens] playback transcode failed, keeping original:', String(e?.message || e).slice(0, 500));
    return keep;
  }
}

async function ffmpegFrame(file, dir, atSec) {
  const out = join(dir, `frame-${atSec}.jpg`);
  try {
    await run('ffmpeg', ['-v', 'error', '-ss', String(atSec), '-i', file, '-frames:v', '1', '-vf', 'scale=1024:-2', '-y', out], { timeout: FFMPEG_FRAME_TIMEOUT_MS });
  } catch { return null; }
  const jpg = await readFile(out).catch(() => null);
  return jpg && jpg.length ? jpg.toString('base64') : null;
}

/**
 * @param {Buffer|Uint8Array} buffer
 * @param {{ probeDuration?: Function, extractAudioChunk?: Function, transcribeChunk?: Function, extractFrame?: Function, captionFrame?: Function }} [deps]
 * @returns {Promise<{ pages: {page:number,text:string}[], durationSec: number }>}
 */
export async function videoToPages(buffer, deps = {}) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (!buf.length) throw new MetaApiError('Video is empty. Choose a video file first.');
  if (buf.length > MAX_VIDEO_BYTES) throw new MetaApiError(`Video is too large (${buf.length} bytes). Keep it under ${MAX_VIDEO_BYTES / (1024 * 1024)} MB.`);
  const needsFile = !deps.probeDuration || !deps.extractAudioChunk || !deps.extractFrame;
  let dir = null;
  let file = null;
  try {
    if (needsFile) {
      dir = await mkdtemp(join(tmpdir(), 'truthlens-video-'));
      file = join(dir, 'input.mp4');
      await writeFile(file, buf);
    }
    const probeDuration = deps.probeDuration || (() => ffprobeDuration(file));
    const extractAudioChunk = deps.extractAudioChunk || ((s, e) => ffmpegAudioChunk(file, dir, s, e));
    const transcribeChunk = deps.transcribeChunk || ((wav) => transcribeAudio(wav));
    const extractFrame = deps.extractFrame || ((t) => ffmpegFrame(file, dir, t));
    const captionFrame = deps.captionFrame || ((b64, atSec) => defaultMetaClient().vision({
      imageBase64: b64, mime: 'image/jpeg', system: CAPTION_SYSTEM, instruction: frameCaptionInstruction(atSec),
    }));

    const durationSec = await probeDuration();
    if (durationSec > MAX_VIDEO_SECONDS) throw new MetaApiError(`Video is too long (${Math.round(durationSec)} seconds). Keep it under ${MAX_VIDEO_SECONDS / 60} minutes.`);

    const chunks = [];
    for (const w of planChunks(durationSec)) {
      const wav = await extractAudioChunk(w.startSec, w.endSec);
      if (!wav || !wav.length) { chunks.push({ ...w, transcript: '' }); continue; }
      const { transcript } = await transcribeChunk(wav);
      chunks.push({ ...w, transcript: String(transcript || '').trim() });
    }
    const frames = [];
    for (const atSec of planFrameTimes(durationSec)) {
      const b64 = await extractFrame(atSec);
      if (!b64) continue;
      const caption = String(await captionFrame(b64, atSec) || '').trim();
      if (caption) frames.push({ atSec, caption });
    }
    return { pages: assembleVideoPages({ chunks, frames }), durationSec };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
