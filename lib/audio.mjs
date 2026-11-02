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

async function ffprobeDuration(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', file]);
  const duration = Number(JSON.parse(stdout)?.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new MetaApiError('That audio file has no readable duration. It may be corrupt or in a format ffmpeg cannot read.');
  return duration;
}

async function ffmpegAudioChunk(file, dir, startSec, endSec) {
  const out = join(dir, `audio-${startSec}.wav`);
  try {
    await run('ffmpeg', ['-v', 'error', '-ss', String(startSec), '-to', String(endSec), '-i', file, '-ac', '1', '-ar', '24000', '-f', 'wav', '-y', out], { timeout: 120000 });
  } catch (e) {
    const detail = String(e?.stderr || '').trim() || String(e?.message || e || 'unknown ffmpeg error').trim();
    throw new MetaApiError(`ffmpeg could not extract audio from that file: ${detail}`);
  }
  const wav = await readFile(out).catch(() => null);
  return wav && wav.length > 44 ? wav : null;
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
