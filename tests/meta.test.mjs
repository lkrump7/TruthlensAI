import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveStatus, parseLiveVerdict, MetaClient, getModels, metaMode, callLiveJudge } from '../lib/meta.mjs';
import { MetaApiError, JudgeError } from '../lib/errors.mjs';
import { metaSearch } from '../lib/search.mjs';

test('liveStatus reports missing config by name, never a bare live flag', () => {
  const s = liveStatus({});
  assert.equal(s.configured, false);
  assert.ok(s.missing.includes('META_MODEL_API_URL'));
  assert.ok(s.missing.includes('META_MODEL_API_KEY'));
});

test('liveStatus is configured only when URL, key and both models are present', () => {
  const s = liveStatus({ META_MODEL_API_URL: 'https://example.invalid/chat', META_MODEL_API_KEY: 'k', META_SPARK_MODEL: 'a', META_WONDER_MODEL: 'b' });
  assert.equal(s.configured, true);
  assert.deepEqual(s.missing, []);
});

test('parseLiveVerdict accepts a cited verdict inside the allowed set', () => {
  const ev = [{ id: 'ev1' }, { id: 'ev2' }];
  const out = parseLiveVerdict(JSON.stringify({ verdict: 'Supported', citedIds: ['ev1'], explanation: 'ok' }), ev);
  assert.equal(out.verdict, 'Supported');
});

test('MetaClient reads config lazily from the env given at construction, not import time', async () => {
  const client = new MetaClient({ apiUrl: 'https://example.invalid/chat', apiKey: 'k', spark: 's1', wonder: 'w1' });
  assert.equal(client.models.spark, 's1');
  assert.equal(client.status().configured, true);
  const unconfigured = new MetaClient({ apiUrl: '', apiKey: '' });
  assert.equal(unconfigured.status().configured, false);
  await assert.rejects(() => unconfigured.judge({ claim: 'x', evidence: [] }), /not configured/);
});

test('MetaClient.judge parses a validated verdict from a chat-shaped response', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ verdict: 'Supported', citedIds: ['ev1'], stances: { ev1: 'supports' }, explanation: 'fine' }) } }] }) });
  const client = new MetaClient({ apiUrl: 'https://example.invalid/chat', apiKey: 'k', spark: 's1', wonder: 'w1', fetchImpl });
  const out = await client.judge({ claim: 'c', evidence: [{ id: 'ev1', stance: 'unknown', passage: 'p' }], model: 's1' });
  assert.equal(out.verdict, 'Supported');
  assert.equal(out.stances.ev1, 'supports');
});

test('sad: MetaClient surfaces HTTP failures as retryable MetaApiError only for 429/5xx', async () => {
  const mk = (status) => new MetaClient({ apiUrl: 'https://x/chat', apiKey: 'k', fetchImpl: async () => ({ ok: false, status, json: async () => ({}) }) });
  await assert.rejects(() => mk(503).judge({ claim: 'c', evidence: [] }), (e) => e instanceof MetaApiError && e.retryable === true);
  await assert.rejects(() => mk(400).judge({ claim: 'c', evidence: [] }), (e) => e instanceof MetaApiError && e.retryable === false);
});

test('sad: MetaClient rejects empty content and non-JSON completions', async () => {
  const empty = new MetaClient({ apiUrl: 'https://x/chat', apiKey: 'k', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '' } }] }) }) });
  await assert.rejects(() => empty.judge({ claim: 'c', evidence: [] }), MetaApiError);
  const badJson = new MetaClient({ apiUrl: 'https://x/chat', apiKey: 'k', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'not json' } }] }) }) });
  await assert.rejects(() => badJson.completeJson({ system: 's', user: 'u' }), JudgeError);
});

test('sad: metaSearch HTTP failure is a typed retryable error', async () => {
  const savedFetch = globalThis.fetch;
  const saved = { u: process.env.META_MODEL_API_URL, k: process.env.META_MODEL_API_KEY };
  process.env.META_MODEL_API_URL = 'https://example.invalid/chat/completions';
  process.env.META_MODEL_API_KEY = 'k';
  let calls = 0;
  globalThis.fetch = async () => { calls++; return { ok: false, status: 503, json: async () => ({}) }; };
  try {
    await assert.rejects(() => metaSearch('anything'), (e) => e instanceof MetaApiError && e.retryable === true);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = savedFetch;
    if (saved.u === undefined) delete process.env.META_MODEL_API_URL; else process.env.META_MODEL_API_URL = saved.u;
    if (saved.k === undefined) delete process.env.META_MODEL_API_KEY; else process.env.META_MODEL_API_KEY = saved.k;
  }
});

test('metaMode and the back-compat callLiveJudge wrapper still work', async () => {
  assert.equal(metaMode({}), 'demo');
  assert.equal(metaMode({ META_MODEL_API_URL: 'u', META_MODEL_API_KEY: 'k' }), 'configured');
  const savedFetch = globalThis.fetch;
  const saved = { u: process.env.META_MODEL_API_URL, k: process.env.META_MODEL_API_KEY };
  process.env.META_MODEL_API_URL = 'https://example.invalid/chat';
  process.env.META_MODEL_API_KEY = 'k';
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ verdict: 'Supported', citedIds: ['ev1'], stances: { ev1: 'supports' }, explanation: 'ok' }) } }] }) });
  try {
    const out = await callLiveJudge({ claim: 'c', evidence: [{ id: 'ev1', stance: 'unknown', passage: 'p' }] });
    assert.equal(out.verdict, 'Supported');
  } finally {
    globalThis.fetch = savedFetch;
    if (saved.u === undefined) delete process.env.META_MODEL_API_URL; else process.env.META_MODEL_API_URL = saved.u;
    if (saved.k === undefined) delete process.env.META_MODEL_API_KEY; else process.env.META_MODEL_API_KEY = saved.k;
  }
});

test('getModels reflects env at call time', () => {
  const m = getModels({ META_SPARK_MODEL: 'spark-x', META_WONDER_MODEL: 'wonder-y' });
  assert.deepEqual(m, { spark: 'spark-x', wonder: 'wonder-y' });
  assert.equal(getModels({}).spark, 'muse-spark-1.3');
});

test('parseLiveVerdict rejects invented citations and unknown verdicts', () => {
  const ev = [{ id: 'ev1' }];
  assert.throws(() => parseLiveVerdict(JSON.stringify({ verdict: 'Supported', citedIds: ['nope'], explanation: 'x' }), ev));
  assert.throws(() => parseLiveVerdict(JSON.stringify({ verdict: 'Definitely true', citedIds: [], explanation: 'x' }), ev));
  assert.throws(() => parseLiveVerdict('not json', ev));
});
