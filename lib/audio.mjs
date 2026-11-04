import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MetaApiError } from './errors.mjs';
import { transcribeAudio } from './voice.mjs';
import { formatTimestamp, planChunks } from './video.mjs';

export { formatTimestamp, planChunks };

// Audio ingestion: ffmpeg splits the file into ≤50 s WAV chunks and Muse
// Voice Transcribe takes the speech. Same chunking and timestamped pages
// as the video workflow, minus the frame captions: there are no frames.
export const MAX_AUDIO_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_AUDIO_FILE_SECONDS = 600;
export const AUDIO_CHUNK_SECONDS = 50;

// ffprobe must wait as long as an extraction chunk: a slow file that
// probes past a short timeout would fail ingestion even though ffmpeg
// itself would have finished the same read.
export const FFPROBE_TIMEOUT_MS = 120000;
export const FFMPEG_AUDIO_TIMEOUT_MS = 120000;
export const FFMPEG_PLAYBACK_TIMEOUT_MS = 300000;

export const AUDIO_MIME_BY_EXT = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/opus',
  '.flac': 'audio/flac',
  '.aac': 'audio/aac',
};

/** @param {string} name */
export function mimeForAudioFile(name) {
  const m = String(name || '').toLowerCase().match(/\.[a-z0-9]+$/);
  return (m && AUDIO_MIME_BY_EXT[m[0]]) || null;
}

/**
 * One page per spoken time window. Silent windows are dropped, so an
 * audio file with no transcribed speech becomes zero pages and the
 * route rejects it with 422 instead of storing an empty document.
 * @param {{ chunks?: {startSec:number,endSec:number,transcript?:string}[] }} args
 */
export function assembleAudioPages({ chunks = [] } = {}) {
  const pages = [];
  for (const c of chunks) {
    const transcript = String(c?.transcript || '').trim();
    if (!transcript) continue;
    const startSec = Number(c.startSec) || 0;
    const endSec = Number(c.endSec) || 0;
    pages.push({ page: pages.length + 1, text: `[${formatTimestamp(startSec)}–${formatTimestamp(endSec)}] Speech: ${transcript}` });
  }
  return pages;
}

const run = promisify(execFile);

// ffmpeg failures carry tmpdir paths and raw stderr. Those stay in the
// server log; the client gets a generic message that names no paths.
export function sanitizeFfmpegError(err, target = 'audio file') {
  const detail = String(err?.stderr || '').trim() || String(err?.message || err || 'unknown ffmpeg error').trim();
  console.error(`[truthlens] ffmpeg failed on ${target}:`, detail.slice(0, 2000));
  return new MetaApiError(`Could not extract audio from that ${target}. It may be corrupt or use an unsupported format.`);
}

async function ffprobeDuration(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file], { timeout: FFPROBE_TIMEOUT_MS });
  const duration = Number(JSON.parse(stdout)?.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new MetaApiError('That audio file has no readable duration. It may be corrupt or in a format ffmpeg cannot read.');
  return duration;
}

async function ffmpegAudioChunk(file, dir, startSec, endSec) {
  const out = join(dir, `audio-${startSec}.wav`);
  try {
    await run('ffmpeg', ['-v', 'error', '-ss', String(startSec), '-to', String(endSec), '-i', file, '-ac', '1', '-ar', '24000', '-f', 'wav', '-y', out], { timeout: FFMPEG_AUDIO_TIMEOUT_MS });
  } catch (e) {
    throw sanitizeFfmpegError(e, 'audio file');
  }
  const wav = await readFile(out).catch(() => null);
  return wav && wav.length > 44 ? wav : null;
}

// An upload whose filename carries no recognized extension (recorder
// shares like "Audio recording") transcribes fine but leaves the viewer
// with text only: nothing may be stored under a client-supplied label.
// When the bytes provably hold audio, keep an MP3 copy every browser
// plays instead. The label comes from our own ffprobe check and encode,
// never from the client's claim.
async function ffprobeHasAudio(buffer) {
  const dir = await mkdtemp(join(tmpdir(), 'truthlens-playback-probe-'));
  try {
    const input = join(dir, 'input.audio');
    await writeFile(input, buffer);
    const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'json', input], { timeout: FFPROBE_TIMEOUT_MS });
    const streams = JSON.parse(stdout)?.streams;
    return { hasAudio: Array.isArray(streams) && streams.some((s) => s?.codec_type === 'audio') };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function ffmpegToMp3(buffer) {
  const dir = await mkdtemp(join(tmpdir(), 'truthlens-playback-'));
  try {
    const input = join(dir, 'input.audio');
    const out = join(dir, 'playback.mp3');
    await writeFile(input, buffer);
    await run('ffmpeg', ['-v', 'error', '-i', input, '-vn', '-c:a', 'libmp3lame', '-b:a', '160k', '-y', out], { timeout: FFMPEG_PLAYBACK_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
    return await readFile(out);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Returns the bytes the viewer should store: the upload itself when its
 * extension names a playable format, otherwise an MP3 copy re-encoded
 * from bytes that provably hold audio. Anything else keeps nothing, so
 * a mislabeled file is never served back under an invented type.
 * @param {Buffer|Uint8Array} buffer
 * @param {{ ext?: string, probeFormat?: Function, transcode?: Function }} [deps]
 * @returns {Promise<{ buffer: Buffer, ext: string, mime: string|null, transcoded: boolean }>}
 */
export async function makePlaybackAudio(buffer, deps = {}) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const ext = String(deps.ext || '').toLowerCase();
  const known = AUDIO_MIME_BY_EXT[ext];
  if (known) return { buffer: buf, ext, mime: known, transcoded: false };
  const none = { buffer: buf, ext, mime: null, transcoded: false };
  if (!buf.length) return none;
  let hasAudio = false;
  try {
    hasAudio = Boolean((await (deps.probeFormat || ffprobeHasAudio)(buf))?.hasAudio);
  } catch {
    return none;
  }
  if (!hasAudio) return none;
  try {
    const out = await (deps.transcode || ffmpegToMp3)(buf);
    if (!out?.length) return none;
    return { buffer: Buffer.from(out), ext: '.mp3', mime: 'audio/mpeg', transcoded: true };
  } catch (e) {
    console.error('[truthlens] playback transcode failed, keeping no audio file:', String(e?.message || e).slice(0, 500));
    return none;
  }
}

/**
 * @param {Buffer|Uint8Array} buffer
 * @param {{ probeDuration?: Function, extractAudioChunk?: Function, transcribeChunk?: Function }} [deps]
 * @returns {Promise<{ pages: {page:number,text:string}[], durationSec: number }>}
 */
export async function audioToPages(buffer, deps = {}) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (!buf.length) throw new MetaApiError('Audio is empty. Choose an audio file first.');
  if (buf.length > MAX_AUDIO_FILE_BYTES) throw new MetaApiError(`Audio is too large (${buf.length} bytes). Keep it under ${MAX_AUDIO_FILE_BYTES / (1024 * 1024)} MB.`);
  const needsFile = !deps.probeDuration || !deps.extractAudioChunk;
  let dir = null;
  let file = null;
  try {
    if (needsFile) {
      dir = await mkdtemp(join(tmpdir(), 'truthlens-audio-'));
      file = join(dir, 'input.audio');
      await writeFile(file, buf);
    }
    const probeDuration = deps.probeDuration || (() => ffprobeDuration(file));
    const extractAudioChunk = deps.extractAudioChunk || ((s, e) => ffmpegAudioChunk(file, dir, s, e));
    const transcribeChunk = deps.transcribeChunk || ((wav) => transcribeAudio(wav));

    const durationSec = await probeDuration();
    if (durationSec > MAX_AUDIO_FILE_SECONDS) throw new MetaApiError(`Audio is too long (${Math.round(durationSec)} seconds). Keep it under ${MAX_AUDIO_FILE_SECONDS / 60} minutes.`);

    const chunks = [];
    for (const w of planChunks(durationSec, AUDIO_CHUNK_SECONDS)) {
      const wav = await extractAudioChunk(w.startSec, w.endSec);
      if (!wav || !wav.length) { chunks.push({ ...w, transcript: '' }); continue; }
      const { transcript } = await transcribeChunk(wav);
      chunks.push({ ...w, transcript: String(transcript || '').trim() });
    }
    return { pages: assembleAudioPages({ chunks }), durationSec };
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
