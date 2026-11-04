import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const dir = mkdtempSync(join(tmpdir(), 'tl-media-pipe-'));
process.env.TRUTHLENS_STORE_FILE = join(dir, 'documents.json');
process.env.TRUTHLENS_USERS_FILE = join(dir, 'users.json');
delete process.env.META_MODEL_API_URL;
delete process.env.META_MODEL_API_KEY;

const { createDocument, getDocument } = await import('../lib/documents.mjs');
const { captionImage } = await import('../lib/caption.mjs');
const { audioToPages } = await import('../lib/audio.mjs');
const { videoToPages } = await import('../lib/video.mjs');
const { verifyResearchedClaim } = await import('../lib/pipeline.mjs');
const { extractClaimsFromPages } = await import('../lib/claims.mjs');

const allowAll = async (arr) => arr.map(() => ({ action: 'allow' }));
const textsOf = (claims) => claims.map((c) => c.text);

test('media extraction drops frame and image descriptions, keeps the quoted claim', async () => {
  const claims = await extractClaimsFromPages(
    [{ page: 1, text: 'The image shows a plain white background with a single line of small black text on the left side. No people or other objects are visible. Nothing else is visible in the frame. The visible text is "Water boils at 100 degrees Celsius at sea level."' }],
    { screenTexts: allowAll },
  );
  assert.deepEqual(textsOf(claims), ['Water boils at 100 degrees Celsius at sea level.'], JSON.stringify(textsOf(claims)));
});

test('media extraction strips speech and visual scaffolding from video pages', async () => {
  const claims = await extractClaimsFromPages(
    [{ page: 1, text: '[00:00–00:20] Speech: Apollo 11 was the spaceflight that first landed humans on the Moon in 1969. Visual (00:00): The frame shows vertical color bars in white and cyan. No people or other text are visible.' }],
    { screenTexts: allowAll },
  );
  assert.deepEqual(textsOf(claims), ['Apollo 11 was the spaceflight that first landed humans on the Moon in 1969.'], JSON.stringify(textsOf(claims)));
});

test('a stored media description rechecks as Not fact-checkable, with no search', async () => {
  let searched = false;
  const out = await verifyResearchedClaim('Visual (00:00): The frame shows vertical color bars in white and cyan.', {
    search: async () => { searched = true; return { queries: [], sources: [], citations: [] }; },
    fetchText: async () => '',
    judge: async () => ({ verdict: 'Supported', citedIds: [], stances: {}, explanation: 'should not run' }),
    stabilityRuns: 1,
  });
  assert.equal(out.verdict, 'Not fact-checkable', JSON.stringify(out));
  assert.equal(searched, false);
});

test('media extraction drops transcript boilerplate and the cut-off tail', async () => {
  const claims = await extractClaimsFromPages(
    [{ page: 1, text: '[00:00–00:19] Speech: This sound file contains the spoken version of a Wikipedia article on Apollo 11. Apollo 11 from Wikipedia, the free encyclopedia at en.wikipedia.org. Apollo 11 landed on the Moon in 1969. Apollo 11 was the spaceflight that first' }],
    { screenTexts: allowAll },
  );
  assert.deepEqual(textsOf(claims), ['Apollo 11 landed on the Moon in 1969.'], JSON.stringify(textsOf(claims)));
});
const { scoreOfflineEval } = await import('../lib/eval-offline.mjs');

const MEDIA_LABELS = ['media-image', 'media-video', 'media-audio'];

function mediaCases() {
  const all = JSON.parse(readFileSync('eval/offline-cases.json', 'utf8'));
  return all.filter((c) => MEDIA_LABELS.includes(c.label));
}

test('offline pipeline covers one image, one video, and one audio case', () => {
  const cases = mediaCases();
  assert.equal(cases.length, 3, `need one case per media type, found ${cases.length}`);
  for (const label of MEDIA_LABELS) {
    const c = cases.find((x) => x.label === label);
    assert.ok(c?.claim?.length > 10, `claim text required: ${label}`);
    assert.ok(Array.isArray(c.expected) && c.expected.length > 0, `expected required: ${label}`);
  }
});

test('media cases verify through the stubbed pipeline without live credits', async () => {
  const out = await scoreOfflineEval(mediaCases());
  assert.equal(out.total, 3);
  assert.equal(out.accuracy, 1, JSON.stringify(out.results));
  for (const r of out.results) assert.ok(['Supported', 'Partially supported'].includes(r.verdict), `${r.label} -> ${r.verdict}`);
});

async function stubVerify(claim, pages) {
  const byUrl = new Map(pages.map((p) => [p.url, p.body]));
  return verifyResearchedClaim(claim, {
    search: async () => ({ queries: ['stub'], sources: pages.map((p) => ({ title: p.title, url: p.url })), citations: [] }),
    fetchText: async (url) => {
      if (!byUrl.has(url)) throw new Error(`stub 404 for ${url}`);
      return byUrl.get(url);
    },
    judge: async ({ evidence }) => ({
      verdict: 'Supported',
      citedIds: (evidence || []).map((e) => e.id),
      stances: Object.fromEntries((evidence || []).map((e) => [e.id, 'supports'])),
      explanation: 'stub',
    }),
    screenTexts: async (texts) => (texts || []).map(() => ({ action: 'allow' })),
    embedTexts: null,
    rerankTexts: null,
    nli: null,
    challenge: null,
    cache: false,
    stabilityRuns: 1,
  });
}

test('one image, one video, and one audio document save in the store and verify', async () => {
  const caption = await captionImage(Buffer.from([137, 80, 78, 71]), {
    mime: 'image/png',
    visionImpl: async () => 'A sign says water boils at 100 degrees Celsius at sea level.',
  });
  const audio = await audioToPages(Buffer.from('fake-audio'), {
    probeDuration: async () => 60,
    extractAudioChunk: async () => Buffer.from('wav-bytes'),
    transcribeChunk: async () => ({ transcript: 'Apollo 11 landed on the Moon in 1969.' }),
  });
  const video = await videoToPages(Buffer.from('fake-video'), {
    probeDuration: async () => 30,
    extractAudioChunk: async () => Buffer.from('wav-bytes'),
    transcribeChunk: async () => ({ transcript: 'Photosynthesis converts carbon dioxide and water into glucose using sunlight.' }),
    extractFrame: async () => Buffer.from('jpg-bytes').toString('base64'),
    captionFrame: async () => 'A green leaf under sunlight.',
  });
  assert.ok(audio.pages.length > 0 && video.pages.length > 0);

  const img = await createDocument({
    title: 'Sign photo', kind: 'image',
    media: { caption, model: 'muse-spark-1.3' },
    pages: [{ page: 1, text: caption }],
  });
  const aud = await createDocument({
    title: 'Moon speech', kind: 'audio',
    media: { durationSec: 60, voiceModel: 'muse-voice-transcribe-1.0' },
    pages: audio.pages,
  });
  const vid = await createDocument({
    title: 'Leaf clip', kind: 'video',
    media: { durationSec: 30, model: 'muse-spark-1.3', voiceModel: 'muse-voice-transcribe-1.0' },
    pages: video.pages,
  });

  assert.equal((await getDocument(img.id)).kind, 'image');
  assert.equal((await getDocument(aud.id)).kind, 'audio');
  assert.equal((await getDocument(vid.id)).kind, 'video');
  assert.match((await getDocument(img.id)).sourcePages[0].text, /water boils/i);

  const cases = mediaCases();
  const byLabel = new Map(cases.map((c) => [c.label, c]));
  for (const [kind, label] of [['image', 'media-image'], ['audio', 'media-audio'], ['video', 'media-video']]) {
    const c = byLabel.get(label);
    assert.ok(c, `media case for ${kind}`);
    const r = await stubVerify(c.claim, c.pages);
    assert.ok(['Supported', 'Partially supported'].includes(r.verdict), `${kind} -> ${r.verdict}`);
  }
});
