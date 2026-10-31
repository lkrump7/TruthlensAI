import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkDocument, chunkDocumentSemantic } from '../lib/chunk.mjs';

const pages = [{ page: 1, text: 'The reservoir opened in 1998 after five years of construction work. Flooding deaths fell sharply once the reservoir began operating. The valley towns downstream reported far fewer flood emergencies each year. Meanwhile, the cookbook describes a slow method for braising lamb with rosemary. The sauce should rest before serving so the flavours settle properly. A heavy pan keeps the temperature steady during the long cooking time.' }];

// Fake semantic space: reservoir sentences near each other, cooking far away.
const embedTexts = async (texts) => texts.map((t) => (/reservoir|flooding|valley/i.test(t) ? [1, 0] : [0, 1]));

test('semantic chunking splits at the topic boundary the fixed chunker merges', async () => {
  const fixed = chunkDocument(pages);
  assert.equal(fixed.length, 1, 'fixture check: fixed chunking merges both topics into one chunk');
  const semantic = await chunkDocumentSemantic(pages, { embedTexts });
  assert.equal(semantic.length, 2);
  assert.match(semantic[0].text, /reservoir/i);
  assert.doesNotMatch(semantic[0].text, /cookbook/i);
  assert.match(semantic[1].text, /cookbook/i);
  assert.ok(semantic.every((c) => c.page === 1 && /^chunk-p1-/.test(c.id)), 'ids and page attribution keep the fixed format');
});

test('semantic chunking falls back to fixed chunking without embeddings', async () => {
  const semantic = await chunkDocumentSemantic(pages, { embedTexts: async () => null });
  assert.deepEqual(semantic, chunkDocument(pages));
  const noFn = await chunkDocumentSemantic(pages, {});
  assert.deepEqual(noFn, chunkDocument(pages));
});

test('semantic chunking still respects the size cap within one topic', async () => {
  const long = [{ page: 2, text: Array.from({ length: 12 }, (_, i) => `Reservoir report part ${i}: flooding levels and reservoir operations in the valley are described in detail here.`).join(' ') }];
  const semantic = await chunkDocumentSemantic(long, { embedTexts, size: 300 });
  assert.ok(semantic.length > 1, 'one topic still splits at the size cap');
  assert.ok(semantic.every((c) => c.text.length <= 340), 'chunks stay near the cap');
});
