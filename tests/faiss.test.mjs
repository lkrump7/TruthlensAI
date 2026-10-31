import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FaissClient } from '../lib/faiss.mjs';
import { ocrPdfPages } from '../lib/ocr.mjs';

test('FaissClient posts vectors and parses hits', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    return { ok: true, status: 200, json: async () => (url.endsWith('/search') ? { hits: [{ id: 'a', score: 0.9 }] } : { added: 1, total: 1 }) };
  };
  const c = new FaissClient('http://sidecar:8100', fetchImpl);
  await c.add('docs', [{ id: 'a', vector: [1, 0] }]);
  const hits = await c.search('docs', [1, 0], 3);
  assert.equal(hits[0].id, 'a');
  assert.equal(calls[0].url, 'http://sidecar:8100/faiss/add');
  assert.equal(calls[1].body.k, 3);
});

test('FaissClient surfaces sidecar errors', async () => {
  const c = new FaissClient('http://sidecar:8100', async () => ({ ok: false, status: 500, json: async () => ({}) }));
  await assert.rejects(() => c.search('docs', [1], 1), /500/);
});

test('ocrPdfPages renders via sidecar then transcribes each page with vision', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ pages: [{ page: 1, imageBase64: 'AAA' }, { page: 2, imageBase64: 'BBB' }] }) });
  const vision = async (img) => (img === 'AAA' ? 'Water boils at 100 degrees Celsius at sea level.' : 'Humans only use part of their brains each day.');
  const pages = await ocrPdfPages(Buffer.from('%PDF-fake'), { sidecarUrl: 'http://sidecar:8100', fetchImpl, vision });
  assert.equal(pages.length, 2);
  assert.match(pages[1].text, /Humans only use/);
});

test('ocrPdfPages default vision transcribes through the Meta API shape', async () => {
  const savedFetch = globalThis.fetch;
  const savedEnv = { u: process.env.META_MODEL_API_URL, k: process.env.META_MODEL_API_KEY };
  process.env.META_MODEL_API_URL = 'https://example.invalid/chat';
  process.env.META_MODEL_API_KEY = 'k';
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Water boils at 100 degrees Celsius at sea level.' } }] }) });
  const renderFetch = async () => ({ ok: true, status: 200, json: async () => ({ pages: [{ page: 1, imageBase64: 'AAA' }] }) });
  try {
    const pages = await ocrPdfPages(Buffer.from('%PDF-fake'), { sidecarUrl: 'http://sidecar:8100', fetchImpl: renderFetch });
    assert.equal(pages.length, 1);
    assert.match(pages[0].text, /Water boils/);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedEnv.u === undefined) delete process.env.META_MODEL_API_URL; else process.env.META_MODEL_API_URL = savedEnv.u;
    if (savedEnv.k === undefined) delete process.env.META_MODEL_API_KEY; else process.env.META_MODEL_API_KEY = savedEnv.k;
  }
});

test('sad: ocrPdfPages surfaces vision HTTP failures', async () => {
  const savedFetch = globalThis.fetch;
  const saved = { u: process.env.META_MODEL_API_URL, k: process.env.META_MODEL_API_KEY };
  process.env.META_MODEL_API_URL = 'https://example.invalid/chat';
  process.env.META_MODEL_API_KEY = 'k';
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const renderFetch = async () => ({ ok: true, status: 200, json: async () => ({ pages: [{ page: 1, imageBase64: 'AAA' }] }) });
  try { await assert.rejects(() => ocrPdfPages(Buffer.from('%PDF-fake'), { sidecarUrl: 'http://sidecar:8100', fetchImpl: renderFetch }), /OCR vision returned 500/); }
  finally {
    globalThis.fetch = savedFetch;
    if (saved.u === undefined) delete process.env.META_MODEL_API_URL; else process.env.META_MODEL_API_URL = saved.u;
    if (saved.k === undefined) delete process.env.META_MODEL_API_KEY; else process.env.META_MODEL_API_KEY = saved.k;
  }
});

test('ocrPdfPages refuses scanned PDFs when no sidecar is configured', async () => {
  await assert.rejects(() => ocrPdfPages(Buffer.from('%PDF-fake'), {}), /sidecar/i);
});
