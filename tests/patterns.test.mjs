import { test } from 'node:test';
import assert from 'node:assert/strict';
import { topicKeyFor } from '../lib/claims.mjs';
import { MetaClient } from '../lib/meta.mjs';
import { LocalRankBackend, FaissRankBackend, rankEvidence, backendForClaim } from '../lib/rank.mjs';
import { GATES, applyGates } from '../lib/verdict.mjs';
import { FetchError, MetaApiError, JudgeError } from '../lib/errors.mjs';
import { withRetry } from '../lib/fetch.mjs';
import { parseLiveVerdict } from '../lib/meta.mjs';
import { FileRepository, PostgresRepository } from '../lib/repositories.mjs';
import { FaissClient } from '../lib/faiss.mjs';
import { makeVerdict } from '../lib/verdict.mjs';
import { createDocument as createDocumentFromService } from '../lib/documents.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('topicKeyFor lives in claims and builds a stable topic key', () => {
  const a = topicKeyFor('AI increases employment across the economy');
  const b = topicKeyFor('AI increases employment across the economy');
  assert.equal(a, b);
  assert.ok(a.includes('employment'));
  assert.ok(!a.includes('increases'));
});

test('topicKeyFor separates claims that differ only in word order', () => {
  assert.notEqual(topicKeyFor('Cats kill dogs'), topicKeyFor('Dogs kill cats'));
});

test('topicKeyFor separates claims that differ only in a number', () => {
  const a = topicKeyFor('The vaccine reduced hospitalisations by 80 percent among elderly residents');
  const b = topicKeyFor('The vaccine reduced hospitalisations by 20 percent among elderly residents');
  assert.notEqual(a, b);
  assert.equal(topicKeyFor('Deaths fell by eighty percent in the trial'), topicKeyFor('Deaths fell by 80 percent in the trial'));
});

test('LocalRankBackend ranks the closest vector first', async () => {
  const backend = new LocalRankBackend();
  await backend.reset([{ id: 'far', vector: [0, 1] }, { id: 'near', vector: [1, 0] }]);
  const hits = await backend.search([1, 0], 2);
  assert.deepEqual(hits.map((h) => h.id), ['near', 'far']);
});

test('FaissRankBackend delegates reset and search to the sidecar client', async () => {
  const calls = [];
  const client = {
    add: async (ns, items, opts) => calls.push(['add', ns, items.length, opts.reset]),
    search: async (ns, vector, k) => { calls.push(['search', ns, k]); return [{ id: 'x', score: 0.5 }]; },
  };
  const backend = new FaissRankBackend(client, 'evidence-abc');
  await backend.reset([{ id: 'x', vector: [1, 0] }]);
  const hits = await backend.search([1, 0], 1);
  assert.deepEqual(calls, [['add', 'evidence-abc', 1, true], ['search', 'evidence-abc', 1]]);
  assert.equal(hits[0].id, 'x');
});

test('rankEvidence applies source tier weight and slices to maxEvidence', async () => {
  const evidence = [
    { id: 'a', source: 'blog.example', passage: 'alpha' },
    { id: 'b', source: 'nih.gov', passage: 'beta' },
  ];
  const embed = (text) => (text === 'query' || text === 'alpha' ? [1, 0] : [0.9, 0.1]);
  const ranked = await rankEvidence({ claim: 'query', evidence, embed, maxEvidence: 1 });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].id, 'b');
});

test('GATES is a named list in pipeline order', () => {
  assert.deepEqual(GATES.map((g) => g.name), ['citation', 'outdated', 'corroboration', 'stability']);
  for (const g of GATES) { assert.equal(typeof g.applies, 'function'); assert.equal(typeof g.apply, 'function'); }
});

test('applyGates accepts an injected gate list and respects its order', () => {
  const ctx = { verdict: 'Supported', cited: [{ id: 'a' }], supporting: [], contradicting: [], limitations: [] };
  assert.equal(applyGates(ctx, []).verdict, 'Supported');
  const custom = [{ name: 'force', applies: () => true, apply: (c) => ({ ...c, verdict: 'Misleading' }) }];
  assert.equal(applyGates(ctx, custom).verdict, 'Misleading');
  assert.equal(applyGates(ctx).verdict, 'Partially supported');
});

test('withRetry retries only errors flagged retryable, never by message text', async () => {
  let plain = 0;
  await assert.rejects(() => withRetry(async () => { plain++; throw new Error('fetch 500 timeout'); }), /fetch 500/);
  assert.equal(plain, 1);
  let flagged = 0;
  const out = await withRetry(async () => { flagged++; if (flagged < 2) throw new FetchError('fetch 503', { retryable: true }); return 'ok'; });
  assert.equal(out, 'ok');
  assert.equal(flagged, 2);
  let fatal = 0;
  await assert.rejects(() => withRetry(async () => { fatal++; throw new FetchError('fetch 404'); }), FetchError);
  assert.equal(fatal, 1);
});

test('judge and Meta failures carry typed errors', () => {
  assert.throws(() => parseLiveVerdict('not json', []), JudgeError);
  assert.throws(() => parseLiveVerdict(JSON.stringify({ verdict: 'Nope', citedIds: [] }), []), JudgeError);
  const e = new MetaApiError('Meta Model API returned 503', { retryable: true });
  assert.equal(e.retryable, true);
  assert.equal(e.name, 'MetaApiError');
});

test('FileRepository lives outside the document service and round-trips a doc', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'tl-repo-')), 'docs.json');
  const repo = new FileRepository(file);
  const doc = { id: `doc-${await repo.nextSeq()}`, owner: 'demo', title: 'T', chunks: [] };
  await repo.save(doc);
  const loaded = await new FileRepository(file).loadAll();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].title, 'T');
  assert.equal(typeof createDocumentFromService, 'function');
});

test('makeVerdict rejects a verdict outside the allowed set', () => {
  assert.throws(() => makeVerdict({ verdict: 'Definitely true' }), /unknown verdict/i);
  assert.equal(makeVerdict({ verdict: 'Supported' }).verdict, 'Supported');
  assert.equal(makeVerdict({}).verdict, 'Unverifiable');
  assert.equal(makeVerdict({ verdict: undefined }).verdict, 'Unverifiable');
});

test('LocalRankBackend rejects dimension-mismatched vectors like the FAISS sidecar', async () => {
  const backend = new LocalRankBackend();
  await backend.reset([{ id: 'x', vector: [1, 0] }]);
  await assert.rejects(() => backend.search([1, 0, 0], 1), /dimension/i);
  await assert.rejects(() => backend.reset([{ id: 'y', vector: [1, 0, 0] }, { id: 'z', vector: [1, 0] }]), /dimension/i);
});

test('Postgres nextSeq is atomic across repository instances', async () => {
  let counter = 41;
  const pool = { query: async (sql) => (sql.includes('nextval') ? { rows: [{ seq: String(++counter) }] } : { rows: [] }) };
  const a = new PostgresRepository('postgres://x'); a.pool = pool;
  const b = new PostgresRepository('postgres://x'); b.pool = pool;
  const ids = [await a.nextSeq(), await b.nextSeq(), await a.nextSeq()];
  assert.deepEqual(ids, [42, 43, 44]);
  assert.equal(new Set(ids).size, 3);
});

test('Postgres sequence alignment never rewinds an ahead sequence', async () => {
  const calls = [];
  const repo = new PostgresRepository('postgres://x');
  repo.pool = { query: async (sql, _params) => { calls.push(sql); return sql.includes('last_value') ? { rows: [{ last_value: '3', is_called: true }] } : { rows: [] }; } };
  await repo._alignSequence(2);
  assert.ok(!calls.some((q) => q.includes('setval')), 'must not setval backwards');
  await repo._alignSequence(5);
  assert.ok(calls.some((q) => q.includes('setval')), 'must raise sequence when existing ids are ahead');
});

test('PostgresRepository loadAll and save speak the documents upsert contract', async () => {
  const calls = [];
  const repo = new PostgresRepository('postgres://x');
  repo.pool = { query: async (sql, _params) => { calls.push(sql); return sql.startsWith('SELECT data') ? { rows: [{ data: { id: 'doc-1', title: 'T' } }] } : { rows: [] }; } };
  assert.deepEqual((await repo.loadAll()).map((d) => d.title), ['T']);
  await repo.save({ id: 'doc-1', owner: 'alice', title: 'T' });
  assert.ok(calls.some((sql) => sql.includes('ON CONFLICT')));
});

test('FaissClient health reports sidecar status', async () => {
  const c = new FaissClient('http://sidecar:8100', async () => ({ ok: true, status: 200, json: async () => ({ faiss: true }) }));
  assert.equal((await c.health()).faiss, true);
});

test('backendForClaim picks FAISS with a sidecar URL and local without', () => {
  assert.ok(backendForClaim('Water boils', 'http://127.0.0.1:8100') instanceof FaissRankBackend);
  assert.ok(backendForClaim('Water boils', '') instanceof LocalRankBackend);
});

test('MetaClient does not expose its API key as a public field', () => {
  const client = new MetaClient({ apiUrl: 'https://example.invalid/chat', apiKey: 'secret-key', spark: 's1', wonder: 'w1' });
  assert.equal(client.apiKey, undefined);
  assert.equal(JSON.stringify(client).includes('secret-key'), false);
  assert.equal(client.status().configured, true);
});
