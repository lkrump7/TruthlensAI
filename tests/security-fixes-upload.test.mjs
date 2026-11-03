import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'tl-sec-upload-'));
process.env.TRUTHLENS_STORE_FILE = join(dir, 'documents.json');
process.env.TRUTHLENS_USERS_FILE = join(dir, 'users.json');

const okHtml = () => ({
  status: 200, ok: true,
  headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? 'text/html' : null) },
  text: async () => '<p>Water boils at 100 degrees Celsius at sea level.</p>',
});

// --- 1. DNS pinning fails closed -------------------------------------------
test('fetchPageText fails closed when DNS lookup fails instead of fetching unpinned', async () => {
  const { fetchPageText } = await import('../lib/fetch.mjs');
  let fetched = false;
  const lookup = async () => { throw new Error('DNS blowup'); };
  const fetchImpl = async () => { fetched = true; return okHtml(); };
  await assert.rejects(
    () => fetchPageText('https://example.com/article', { lookup, fetchImpl }),
    /DNS|lookup|blocked/i,
  );
  assert.equal(fetched, false, 'no fail-open fetch after a lookup error');
});

test('fetchPageText fails closed when DNS returns no addresses', async () => {
  const { fetchPageText } = await import('../lib/fetch.mjs');
  let fetched = false;
  const fetchImpl = async () => { fetched = true; return okHtml(); };
  await assert.rejects(
    () => fetchPageText('https://example.com/article', { lookup: async () => [], fetchImpl }),
    /DNS|lookup|resolve|blocked/i,
  );
  assert.equal(fetched, false, 'no fail-open fetch without a pinned address');
});

test('a redirect hop whose DNS fails is blocked before the second fetch', async () => {
  const { fetchPageText } = await import('../lib/fetch.mjs');
  const calls = [];
  const lookup = async (host) => {
    if (host === 'first.example') return [{ address: '93.184.216.34', family: 4 }];
    throw new Error('DNS blowup on redirect target');
  };
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) {
      return { status: 302, ok: false, headers: { get: (h) => (h === 'location' ? 'https://second.example/other' : null) } };
    }
    return okHtml();
  };
  await assert.rejects(() => fetchPageText('https://first.example/start', { lookup, fetchImpl }), /DNS|lookup|blocked/i);
  assert.equal(calls.length, 1, `second hop must not fetch, got ${calls.length} calls`);
});

// --- 2. ffprobe timeouts match the ffmpeg timeouts --------------------------
test('audio ffprobe runs under a timeout matching its ffmpeg timeout', async () => {
  const audio = await import('../lib/audio.mjs');
  assert.equal(audio.FFPROBE_TIMEOUT_MS, 120000, 'audio ffprobe timeout matches the ffmpeg chunk timeout');
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../lib/audio.mjs', import.meta.url), 'utf8');
  assert.match(src, /ffprobe[\s\S]{0,400}timeout:\s*FFPROBE_TIMEOUT_MS/, 'the audio ffprobe call passes a timeout');
});

// --- 5. failed fetch bodies are drained or cancelled ----------------------
function recordingBody() {
  const rec = { cancelled: false };
  rec.body = { cancel: async () => { rec.cancelled = true; } };
  return rec;
}

test('fetchPageText cancels the body of a failed response instead of leaking the socket', async () => {
  const { fetchPageText } = await import('../lib/fetch.mjs');
  const rec = recordingBody();
  const fetchImpl = async () => ({
    status: 400, ok: false, headers: { get: () => 'text/html' }, body: rec.body,
  });
  await assert.rejects(() => fetchPageText('https://example.com/bad', { lookup: async () => [{ address: '93.184.216.34', family: 4 }], fetchImpl }), /fetch 400/);
  assert.equal(rec.cancelled, true, 'failed body must be cancelled');
});

test('fetchPageText cancels each failed body before retrying', async () => {
  const { fetchPageText } = await import('../lib/fetch.mjs');
  const recs = [recordingBody(), recordingBody()];
  let calls = 0;
  const fetchImpl = async () => {
    const rec = recs[calls++];
    if (calls === 1) return { status: 503, ok: false, headers: { get: () => null }, body: rec.body };
    return {
      status: 200, ok: true,
      headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? 'text/html' : null) },
      text: async () => '<p>Water boils at sea level.</p>',
    };
  };
  const text = await fetchPageText('https://example.com/boil', { lookup: async () => [{ address: '93.184.216.34', family: 4 }], fetchImpl });
  assert.match(text, /Water boils/);
  assert.equal(recs[0].cancelled, true, 'the retried 503 body must be cancelled');
});

test('fetchPageText cancels the body when the content-type is unsupported', async () => {
  const { fetchPageText } = await import('../lib/fetch.mjs');
  const rec = recordingBody();
  const fetchImpl = async () => ({
    status: 200, ok: true, headers: { get: () => 'application/pdf' }, body: rec.body,
  });
  await assert.rejects(() => fetchPageText('https://example.com/paper.pdf', { lookup: async () => [{ address: '93.184.216.34', family: 4 }], fetchImpl }), /content-type/);
  assert.equal(rec.cancelled, true, 'rejected body must be cancelled');
});

// --- 3. ffmpeg internals stay server-side ----------------------------------
const SECRET = 'SECRET-RAW-9f2c7d1e5b';

async function withStubBinaries({ probeJson, ffmpegStderr }, fn) {
  const { mkdtempSync, writeFileSync, chmodSync, rmSync } = await import('node:fs');
  const bin = mkdtempSync(join(tmpdir(), 'tl-upload-bin-'));
  if (probeJson !== undefined) {
    writeFileSync(join(bin, 'ffprobe'), `#!/bin/sh\nprintf '%s' '${probeJson}'\n`);
    chmodSync(join(bin, 'ffprobe'), 0o755);
  }
  if (ffmpegStderr !== undefined) {
    writeFileSync(join(bin, 'ffmpeg'), `#!/bin/sh\necho "${ffmpegStderr} ${SECRET}" >&2\nexit 1\n`);
    chmodSync(join(bin, 'ffmpeg'), 0o755);
  }
  const savedPath = process.env.PATH;
  process.env.PATH = `${bin}:${savedPath || ''}`;
  try {
    return await fn();
  } finally {
    if (savedPath === undefined) delete process.env.PATH; else process.env.PATH = savedPath;
    rmSync(bin, { recursive: true, force: true });
  }
}

function captureConsoleError() {
  const logged = [];
  const real = console.error;
  console.error = (...args) => { logged.push(args); };
  return { logged, restore: () => { console.error = real; } };
}
const loggedText = (logged) => logged.flatMap((args) => args.map((a) => String(a?.message ?? a))).join('\n');

test('videoToPages hides ffmpeg stderr and tmp paths from the client error', async () => {
  const { videoToPages } = await import('../lib/video.mjs');
  const cap = captureConsoleError();
  try {
    await assert.rejects(
      () => withStubBinaries(
        { probeJson: '{"streams":[{"codec_type":"video"},{"codec_type":"audio"}]}', ffmpegStderr: 'invalid data while decoding stream' },
        () => videoToPages(Buffer.from('fake-video-with-audio'), {
          probeDuration: async () => 25,
          transcribeChunk: async () => { throw new Error('should not transcribe'); },
          extractFrame: async () => Buffer.from('jpg').toString('base64'),
          captionFrame: async () => 'a frame',
        }),
      ),
      (err) => {
        const msg = String(err?.message || '');
        assert.ok(!msg.includes(SECRET), `client error leaks stderr marker: ${msg}`);
        assert.ok(!msg.includes('invalid data while decoding'), `client error leaks ffmpeg stderr: ${msg}`);
        assert.ok(!msg.includes('/tmp/') && !msg.includes('truthlens-video-'), `client error leaks tmp path: ${msg}`);
        return true;
      },
    );
    assert.ok(loggedText(cap.logged).includes(SECRET), 'full ffmpeg detail still goes to the server log');
  } finally {
    cap.restore();
  }
});

test('audioToPages hides ffmpeg stderr and tmp paths from the client error', async () => {
  const { audioToPages } = await import('../lib/audio.mjs');
  const cap = captureConsoleError();
  try {
    await assert.rejects(
      () => withStubBinaries(
        { ffmpegStderr: 'invalid data found when processing input' },
        () => audioToPages(Buffer.from('fake-audio'), { probeDuration: async () => 25 }),
      ),
      (err) => {
        const msg = String(err?.message || '');
        assert.ok(!msg.includes(SECRET), `client error leaks stderr marker: ${msg}`);
        assert.ok(!msg.includes('invalid data found'), `client error leaks ffmpeg stderr: ${msg}`);
        assert.ok(!msg.includes('/tmp/') && !msg.includes('truthlens-audio-'), `client error leaks tmp path: ${msg}`);
        return true;
      },
    );
    assert.ok(loggedText(cap.logged).includes(SECRET), 'full ffmpeg detail still goes to the server log');
  } finally {
    cap.restore();
  }
});

function withLiveEnv(fetchImpl) {
  const savedFetch = globalThis.fetch;
  const saved = { u: process.env.META_MODEL_API_URL, k: process.env.META_MODEL_API_KEY };
  process.env.META_MODEL_API_URL = 'https://example.invalid/chat';
  process.env.META_MODEL_API_KEY = 'k';
  globalThis.fetch = fetchImpl;
  return () => {
    globalThis.fetch = savedFetch;
    if (saved.u === undefined) delete process.env.META_MODEL_API_URL; else process.env.META_MODEL_API_URL = saved.u;
    if (saved.k === undefined) delete process.env.META_MODEL_API_KEY; else process.env.META_MODEL_API_KEY = saved.k;
  };
}

function lyingUploadReq(url, field, { name, size, bytes, type }) {
  const form = new FormData();
  const blob = new Blob([bytes], { type });
  const file = new File([blob], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  const realBuf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  file.arrayBuffer = async () => realBuf.buffer.slice(realBuf.byteOffset, realBuf.byteOffset + realBuf.byteLength);
  form.append(field, file);
  return new Request(url, { method: 'POST', body: form });
}

test('transcribe route returns a generic error without backend internals', async () => {
  const { POST } = await import('../app/api/transcribe/route.js');
  const restore = withLiveEnv(async () => { throw new Error(`connection reset at /tmp/ffmpeg-work ${SECRET}`); });
  const cap = captureConsoleError();
  try {
    const wav = Buffer.concat([Buffer.from('RIFF....WAVEfmt '), Buffer.alloc(1000)]);
    const res = await POST(lyingUploadReq('http://t/api/transcribe', 'audio', { name: 'clip.wav', size: wav.length, bytes: wav, type: 'audio/wav' }));
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.ok(!String(body.error).includes(SECRET), `client error leaks internals: ${body.error}`);
    assert.ok(!String(body.error).includes('/tmp/'), `client error leaks tmp path: ${body.error}`);
    assert.ok(loggedText(cap.logged).includes(SECRET), 'full detail still goes to the server log');
  } finally {
    cap.restore();
    restore();
  }
});

// --- 4+6. real upload caps enforced before heavy work ----------------------
test('audio document route hides transcription internals from the client', async (t) => {
  const { execFileSync } = await import('node:child_process');
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { t.skip('ffmpeg not available'); return; }
  const { promisify } = await import('node:util');
  const { execFile } = await import('node:child_process');
  const { readFile } = await import('node:fs/promises');
  const run = promisify(execFile);
  const out = join(dir, 'tone-secret.wav');
  await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-ar', '24000', '-ac', '1', out]);
  const wav = await readFile(out);
  const { POST } = await import('../app/api/documents/audio/route.js');
  const restore = withLiveEnv(async () => { throw new Error(`asr blew up at /tmp/vox ${SECRET}`); });
  const cap = captureConsoleError();
  try {
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'tone.wav');
    const res = await POST(new Request('http://t/api/documents/audio', { method: 'POST', body: form }));
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.ok(!String(body.error).includes(SECRET), `client error leaks internals: ${body.error}`);
    assert.ok(!String(body.error).includes('/tmp/'), `client error leaks tmp path: ${body.error}`);
    assert.ok(loggedText(cap.logged).includes(SECRET), 'full detail still goes to the server log');
  } finally {
    cap.restore();
    restore();
  }
});

test('video document route hides transcription internals from the client', async (t) => {
  const { execFileSync } = await import('node:child_process');
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { t.skip('ffmpeg not available'); return; }
  const { promisify } = await import('node:util');
  const { execFile } = await import('node:child_process');
  const { readFile } = await import('node:fs/promises');
  const run = promisify(execFile);
  const out = join(dir, 'silent-secret.mp4');
  await run('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=320x240:rate=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', out]);
  const bytes = await readFile(out);
  const { POST } = await import('../app/api/documents/video/route.js');
  const restore = withLiveEnv(async () => { throw new Error(`vision blew up at /tmp/frames ${SECRET}`); });
  const cap = captureConsoleError();
  try {
    const form = new FormData();
    form.append('file', new Blob([bytes], { type: 'video/mp4' }), 'silent.mp4');
    const res = await POST(new Request('http://t/api/documents/video', { method: 'POST', body: form }));
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.ok(!String(body.error).includes(SECRET), `client error leaks internals: ${body.error}`);
    assert.ok(!String(body.error).includes('/tmp/'), `client error leaks tmp path: ${body.error}`);
    assert.ok(loggedText(cap.logged).includes(SECRET), 'full detail still goes to the server log');
  } finally {
    cap.restore();
    restore();
  }
});

function bigUploadReq(url, field, { name, bytes, type }) {
  const form = new FormData();
  form.append(field, new Blob([bytes], { type }), name);
  return new Request(url, { method: 'POST', body: form });
}

test('video route rejects oversize real bytes with 413 before any model call', async () => {
  const { POST } = await import('../app/api/documents/video/route.js');
  const { MAX_VIDEO_BYTES } = await import('../lib/video.mjs');
  let fetchCalls = 0;
  const restore = withLiveEnv(async () => { fetchCalls++; throw new Error('must not fetch'); });
  try {
    const big = Buffer.alloc(MAX_VIDEO_BYTES + 1, 0);
    const res = await POST(bigUploadReq('http://t/api/documents/video', 'file', { name: 'big.mp4', bytes: big, type: 'video/mp4' }));
    assert.equal(res.status, 413);
    assert.equal(fetchCalls, 0, 'heavy work must not start for an oversize file');
  } finally {
    restore();
  }
});

test('audio route rejects oversize real bytes with 413 before any model call', async () => {
  const { POST } = await import('../app/api/documents/audio/route.js');
  const { MAX_AUDIO_FILE_BYTES } = await import('../lib/audio.mjs');
  let fetchCalls = 0;
  const restore = withLiveEnv(async () => { fetchCalls++; throw new Error('must not fetch'); });
  try {
    const big = Buffer.alloc(MAX_AUDIO_FILE_BYTES + 1, 0);
    const res = await POST(bigUploadReq('http://t/api/documents/audio', 'file', { name: 'big.mp3', bytes: big, type: 'audio/mpeg' }));
    assert.equal(res.status, 413);
    assert.equal(fetchCalls, 0, 'heavy work must not start for an oversize file');
  } finally {
    restore();
  }
});

test('image route rejects oversize real bytes with 413 before any model call', async () => {
  const { POST } = await import('../app/api/documents/image/route.js');
  const { MAX_IMAGE_BYTES } = await import('../lib/caption.mjs');
  let fetchCalls = 0;
  const restore = withLiveEnv(async () => { fetchCalls++; throw new Error('must not fetch'); });
  try {
    const big = Buffer.alloc(MAX_IMAGE_BYTES + 1, 0);
    const res = await POST(bigUploadReq('http://t/api/documents/image', 'file', { name: 'big.png', bytes: big, type: 'image/png' }));
    assert.equal(res.status, 413);
    assert.equal(fetchCalls, 0, 'heavy work must not start for an oversize file');
  } finally {
    restore();
  }
});

test('transcribe route rejects oversize real bytes with 413 before any model call', async () => {
  const { POST } = await import('../app/api/transcribe/route.js');
  const { MAX_AUDIO_BYTES } = await import('../lib/voice.mjs');
  let fetchCalls = 0;
  const restore = withLiveEnv(async () => { fetchCalls++; throw new Error('must not fetch'); });
  try {
    const big = Buffer.alloc(MAX_AUDIO_BYTES + 1, 0);
    const res = await POST(bigUploadReq('http://t/api/transcribe', 'audio', { name: 'clip.wav', bytes: big, type: 'audio/wav' }));
    assert.equal(res.status, 413);
    assert.equal(fetchCalls, 0, 'heavy work must not start for an oversize file');
  } finally {
    restore();
  }
});

// --- 4. bounded pre-read: lying lengths cannot force full buffering -------
test('boundedFormData stops reading a lying stream past the cap', async () => {
  const { boundedFormData } = await import('../lib/media-store.mjs');
  const total = Buffer.alloc(1000, 0);
  let pulled = 0;
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      const slice = total.subarray(pulled, pulled + 100);
      if (!slice.length) { controller.close(); return; }
      pulled += slice.length;
      controller.enqueue(slice);
    },
    cancel() { cancelled = true; },
  });
  const req = new Request('http://t/upload', {
    method: 'POST',
    headers: { 'content-type': 'multipart/form-data; boundary=xyz', 'content-length': '10' },
    body: stream, duplex: 'half',
  });
  const out = await boundedFormData(req, 100, 50);
  assert.equal(out.tooLarge, true, 'oversize stream is rejected');
  assert.ok(pulled < total.length, `must stop early, pulled ${pulled} of ${total.length}`);
  assert.equal(cancelled, true, 'the runaway stream is cancelled');
});

test('boundedFormData parses a small body normally', async () => {
  const { boundedFormData } = await import('../lib/media-store.mjs');
  const form = new FormData();
  form.append('file', new Blob([Buffer.from('tiny')], { type: 'text/plain' }), 'tiny.txt');
  const probe = new Request('http://t/upload', { method: 'POST', body: form });
  const contentType = probe.headers.get('content-type');
  const raw = Buffer.from(await probe.arrayBuffer());
  const req = new Request('http://t/upload', {
    method: 'POST', headers: { 'content-type': contentType }, body: raw, duplex: 'half',
  });
  const out = await boundedFormData(req, 15 * 1024 * 1024);
  assert.equal(out.tooLarge, false);
  const file = out.form?.get('file');
  assert.ok(file && typeof file.arrayBuffer === 'function', 'small upload still parses');
  assert.equal(Buffer.from(await file.arrayBuffer()).toString(), 'tiny');
});

test('image route cancels a lying oversize stream instead of buffering it all', async () => {
  const { POST } = await import('../app/api/documents/image/route.js');
  const { MAX_IMAGE_BYTES } = await import('../lib/caption.mjs');
  const big = Buffer.alloc(MAX_IMAGE_BYTES + 3 * 1024 * 1024, 0);
  const form = new FormData();
  form.append('file', new Blob([big], { type: 'image/png' }), 'big.png');
  const probe = new Request('http://t/api/documents/image', { method: 'POST', body: form });
  const contentType = probe.headers.get('content-type');
  const raw = Buffer.from(await probe.arrayBuffer());
  let pulled = 0;
  const stream = new ReadableStream({
    pull(controller) {
      const slice = raw.subarray(pulled, pulled + 64 * 1024);
      if (!slice.length) { controller.close(); return; }
      pulled += slice.length;
      controller.enqueue(slice);
    },
  });
  const req = new Request('http://t/api/documents/image', {
    method: 'POST',
    headers: { 'content-type': contentType, 'content-length': '100' },
    body: stream, duplex: 'half',
  });
  const res = await POST(req);
  assert.equal(res.status, 413);
  assert.ok(pulled < raw.length, `must reject before full buffering, pulled ${pulled} of ${raw.length}`);
});

test('video ffmpeg calls use the named timeout constants, not bare literals', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../lib/video.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /timeout:\s*120000/, 'no bare 120000 literal');
  assert.doesNotMatch(src, /timeout:\s*60000/, 'no bare 60000 literal');
  assert.match(src, /timeout:\s*FFMPEG_AUDIO_TIMEOUT_MS/);
  assert.match(src, /timeout:\s*FFMPEG_FRAME_TIMEOUT_MS/);
});
