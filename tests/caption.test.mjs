import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MetaClient } from '../lib/meta.mjs';
import { captionImage, BlankCaptionError, MAX_IMAGE_BYTES, mimeForImageFile } from '../lib/caption.mjs';
import { CAPTION_SYSTEM, CAPTION_INSTRUCTION } from '../lib/prompts.mjs';

const ENV = { META_MODEL_API_URL: 'https://api.meta.ai/v1/chat/completions', META_MODEL_API_KEY: 'k' };

test('MetaClient.vision posts an image_url data URL to Spark and returns the caption text', async () => {
  let seen;
  const client = new MetaClient({
    env: ENV,
    fetchImpl: async (url, opts) => {
      seen = { url, body: JSON.parse(opts.body) };
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'A chart.' } }] }) };
    },
  });
  const out = await client.vision({ imageBase64: 'QUJD', mime: 'image/png', system: CAPTION_SYSTEM, instruction: CAPTION_INSTRUCTION });
  assert.equal(out, 'A chart.');
  assert.equal(seen.body.model, 'muse-spark-1.3');
  assert.deepEqual(seen.body.messages[1].content, [
    { type: 'text', text: CAPTION_INSTRUCTION },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
  ]);
});

test('MetaClient.vision refuses without Meta config and surfaces HTTP failures', async () => {
  const anon = new MetaClient({ env: {}, fetchImpl: async () => { throw new Error('should not fetch'); } });
  await assert.rejects(() => anon.vision({ imageBase64: 'QUJD', system: 's', instruction: 'i' }), /not configured/i);
  const failing = new MetaClient({ env: ENV, fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
  await assert.rejects(() => failing.vision({ imageBase64: 'QUJD', system: 's', instruction: 'i' }), /503/);
});

test('caption prompt asks for scene, exact visible text, and plain factual sentences', () => {
  assert.match(CAPTION_SYSTEM, /caption/i);
  assert.match(CAPTION_INSTRUCTION, /exactly/i);
  assert.match(CAPTION_INSTRUCTION, /plain sentences/i);
});

test('captionImage forwards bytes as base64 with the mime and trims the caption', async () => {
  let seen;
  const out = await captionImage(Buffer.from([1, 2, 3]), {
    mime: 'image/jpeg',
    visionImpl: async (args) => { seen = args; return '  A red sign says water boils at 100 degrees.  '; },
  });
  assert.equal(out, 'A red sign says water boils at 100 degrees.');
  assert.equal(seen.imageBase64, Buffer.from([1, 2, 3]).toString('base64'));
  assert.equal(seen.mime, 'image/jpeg');
  assert.equal(seen.system, CAPTION_SYSTEM);
});

test('captionImage rejects empty, oversize, unsupported, and blank results before trusting them', async () => {
  const noFetch = async () => { throw new Error('should not call vision'); };
  await assert.rejects(() => captionImage(Buffer.alloc(0), { mime: 'image/png', visionImpl: noFetch }), /empty/i);
  await assert.rejects(() => captionImage(Buffer.alloc(MAX_IMAGE_BYTES + 1), { mime: 'image/png', visionImpl: noFetch }), /too large/i);
  await assert.rejects(() => captionImage(Buffer.from('x'), { mime: 'image/tiff', visionImpl: noFetch }), /unsupported/i);
  await assert.rejects(() => captionImage(Buffer.from('x'), { mime: 'image/png', visionImpl: async () => '   ' }), /no caption/i);
});

test('captionImage throws BlankCaptionError for a blank caption', async () => {
  await assert.rejects(
    () => captionImage(Buffer.from('x'), { mime: 'image/png', visionImpl: async () => '   ' }),
    (e) => e instanceof BlankCaptionError && /no caption/i.test(e.message),
  );
});

test('mimeForImageFile maps extensions and rejects others', () => {
  assert.equal(mimeForImageFile('a.PNG'), 'image/png');
  assert.equal(mimeForImageFile('a.jpg'), 'image/jpeg');
  assert.equal(mimeForImageFile('a.webp'), 'image/webp');
  assert.equal(mimeForImageFile('a.gif'), 'image/gif');
  assert.equal(mimeForImageFile('a.txt'), null);
  assert.equal(mimeForImageFile('noext'), null);
});
