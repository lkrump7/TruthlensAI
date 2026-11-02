import { test } from 'node:test';
import assert from 'node:assert/strict';
import { liveStatus, parseLiveVerdict, MetaClient, getModels, metaMode, callLiveJudge } from '../lib/meta.mjs';
import { MetaApiError, JudgeError } from '../lib/errors.mjs';
import { metaSearch } from '../lib/search.mjs';
import { createBreaker } from '../lib/breaker.mjs';

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

test('MetaClient retries a retryable HTTP failure once and then succeeds', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return calls === 1 ? { ok: false, status: 503, json: async () => ({}) } : { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ verdict: 'Supported', citedIds: ['ev1'], stances: { ev1: 'supports' }, explanation: 'fine' }) } }] }) }; };
  const client = new MetaClient({ apiUrl: 'https://example.invalid/chat', apiKey: 'k', spark: 's1', wonder: 'w1', fetchImpl });
  const out = await client.judge({ claim: 'c', evidence: [{ id: 'ev1', stance: 'unknown', passage: 'p' }], model: 's1' });
  assert.equal(out.verdict, 'Supported');
  assert.equal(calls, 2);
});

test('circuit breaker opens after repeated retryable failures, fails fast, then probes', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: false, status: 503, json: async () => ({}) }; };
  const client = new MetaClient({ apiUrl: 'https://x/chat', apiKey: 'k', fetchImpl, breaker: createBreaker({ threshold: 3, cooldownMs: 40 }) });
  for (let i = 0; i < 3; i++) await assert.rejects(() => client.judge({ claim: 'c', evidence: [] }), MetaApiError);
  const before = calls;
  await assert.rejects(() => client.judge({ claim: 'c', evidence: [] }), /circuit/i);
  assert.equal(calls, before, 'open circuit must not call the provider');
  await new Promise((r) => setTimeout(r, 60));
  await assert.rejects(() => client.judge({ claim: 'c', evidence: [] }), MetaApiError);
  assert.ok(calls > before, 'half-open probe must call the provider once more');
});

test('circuit breaker counts network failures and allows only one half-open probe', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new TypeError('fetch failed'); };
  const client = new MetaClient({ apiUrl: 'https://x/chat', apiKey: 'k', fetchImpl, breaker: createBreaker({ threshold: 2, cooldownMs: 30 }) });
  await assert.rejects(() => client.judge({ claim: 'c', evidence: [] }));
  await assert.rejects(() => client.judge({ claim: 'c', evidence: [] }));
  const before = calls;
  await assert.rejects(() => client.judge({ claim: 'c', evidence: [] }), /circuit/i);
  assert.equal(calls, before);
  await new Promise((r) => setTimeout(r, 50));
  const probes = await Promise.allSettled([client.judge({ claim: 'c', evidence: [] }), client.judge({ claim: 'c', evidence: [] }), client.judge({ claim: 'c', evidence: [] })]);
  assert.ok(calls - before <= 2, `probe burst used ${calls - before} fetches`);
  assert.ok(probes.filter((p) => p.status === 'rejected' && /circuit/i.test(p.reason.message)).length >= 2);
});

test('circuit breaker never counts non-retryable failures', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: false, status: 400, json: async () => ({}) }; };
  const client = new MetaClient({ apiUrl: 'https://x/chat', apiKey: 'k', fetchImpl, breaker: createBreaker({ threshold: 2, cooldownMs: 1000 }) });
  await assert.rejects(() => client.judge({ claim: 'c', evidence: [] }), MetaApiError);
  await assert.rejects(() => client.judge({ claim: 'c', evidence: [] }), MetaApiError);
  const before = calls;
  await assert.rejects(() => client.judge({ claim: 'c', evidence: [] }), (e) => e instanceof MetaApiError && !/circuit/i.test(e.message));
  assert.ok(calls > before);
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

test('MetaClient aborts a completion that never answers', async () => {
  const fetchImpl = (url, opts) => new Promise((resolve, reject) => {
    opts.signal.addEventListener('abort', () => reject(new Error('aborted by timeout')));
  });
  const client = new MetaClient({ apiUrl: 'https://example.invalid/chat', apiKey: 'k', fetchImpl, timeoutMs: 20 });
  const keepAlive = setTimeout(() => {}, 500);
  try {
    await assert.rejects(() => client.completeJson({ system: 's', user: 'u' }), /aborted by timeout/);
  } finally { clearTimeout(keepAlive); }
});

test('parseLiveVerdict rejects invented citations and unknown verdicts', () => {
  const ev = [{ id: 'ev1' }];
  assert.throws(() => parseLiveVerdict(JSON.stringify({ verdict: 'Supported', citedIds: ['nope'], explanation: 'x' }), ev));
  assert.throws(() => parseLiveVerdict(JSON.stringify({ verdict: 'Definitely true', citedIds: [], explanation: 'x' }), ev));
  assert.throws(() => parseLiveVerdict('not json', ev));
});
