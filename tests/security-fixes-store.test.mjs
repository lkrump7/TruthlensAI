import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolated store for this file (same pattern as tests/store.test.mjs:
// the repository singleton reads TRUTHLENS_STORE_FILE lazily on first use).
const dir = mkdtempSync(join(tmpdir(), 'tl-sec-store-'));
const storeFile = join(dir, 'documents.json');
process.env.TRUTHLENS_STORE_FILE = storeFile;

const { FileRepository } = await import('../lib/repositories.mjs');

// --- 1. nextSeq dup-id race: the reservation must be durable -------------

test('parallel nextSeq claims across isolated writers never mint the same doc-N', async () => {
  const mA = await import('../lib/repositories.mjs?x=seqA');
  const mB = await import('../lib/repositories.mjs?x=seqB');
  const a = new mA.FileRepository(storeFile);
  const b = new mB.FileRepository(storeFile);
  const ids = await Promise.all(Array.from({ length: 20 }, (_, i) => (i % 2 ? a : b).nextSeq()));
  assert.equal(new Set(ids).size, 20, `duplicate seq minted: ${JSON.stringify(ids)}`);
});

test('nextSeq leaves a durable reservation so a crash cannot re-mint the id', async () => {
  const { rmSync } = await import('node:fs');
  const file = join(mkdtempSync(join(tmpdir(), 'tl-seqres-')), 'documents.json');
  const repo = new FileRepository(file);
  const claimed = await repo.nextSeq();
  // The reservation must not hinge on a single sidecar: lose it (disk
  // pressure, partial restore, cleanup) and the id must still be taken.
  rmSync(`${file}.seq`, { force: true });
  const fresh = new FileRepository(file);
  assert.ok((await fresh.nextSeq()) > claimed, 'a fresh instance must advance past the reservation even without the sidecar');
});

function dirOf(f) {
  return f.split('/').slice(0, -1).join('/') || '.';
}

// --- 2. cross-process RMW: stale aggregates must not silently win ---------

test('atomic update() applies to fresh state so isolated writers both survive', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'tl-update-')), 'documents.json');
  const mA = await import('../lib/repositories.mjs?x=updA');
  const mB = await import('../lib/repositories.mjs?x=updB');
  const a = new mA.FileRepository(file);
  await a.save({ id: 'doc-1', owner: 'demo', claims: [] });
  assert.equal(typeof a.update, 'function', 'FileRepository needs an atomic update() for RMW');
  const b = new mB.FileRepository(file); // stale in-memory copy, like another process
  await a.update('doc-1', (fresh) => ({ ...fresh, claims: [...fresh.claims, { id: 'cA' }] }));
  await b.update('doc-1', (fresh) => ({ ...fresh, claims: [...fresh.claims, { id: 'cB' }] }));
  const got = (await new FileRepository(file).loadAll()).find((d) => d.id === 'doc-1');
  const ids = new Set(got.claims.map((c) => c.id));
  assert.ok(ids.has('cA') && ids.has('cB'), `both appends must survive, got ${JSON.stringify(got.claims)}`);
});

test('assessDocumentClaim never drops a claim that landed mid-verification', async () => {
  const { assessDocumentClaim } = await import('../lib/documents.mjs');
  const { repository } = await import('../lib/repositories.mjs');
  const repo = repository();
  await repo.save({
    id: 'doc-assess-race', owner: 'demo', kind: 'excerpt', title: 'Race', createdAt: new Date().toISOString(),
    pages: 1, sourcePages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }],
    chunks: [{ id: 'chunk-1', page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }],
    claims: [], status: 'ready', autoPaused: false, coverage: 0, report: null,
  });
  let openGate;
  const gate = new Promise((res) => { openGate = res; });
  const assessedText = 'Water boils at 100 degrees Celsius at sea level in kitchens';
  const pending = assessDocumentClaim('doc-assess-race', assessedText, {
    stance: async () => ({ stance: 'unknown', reason: 'test' }),
    verify: async () => {
      await gate;
      return { verdict: 'Supported', judgedBy: 'test', supporting: [], contradicting: [] };
    },
  });
  await new Promise((r) => setTimeout(r, 50));
  // Another "process" (own in-memory state) files claim-1 while we verify.
  const external = new FileRepository(storeFile);
  const extDoc = (await external.loadAll()).find((d) => d.id === 'doc-assess-race');
  extDoc.claims.push({ id: 'doc-assess-race-claim-1', text: 'External concurrent claim', status: 'verified', verdict: 'Supported', judgedBy: 't', history: [] });
  await external.save(extDoc);
  openGate();
  const { doc } = await pending;
  const texts = doc.claims.map((c) => c.text);
  assert.ok(texts.includes('External concurrent claim'), 'concurrent claim must survive the verdict write');
  assert.ok(texts.includes(assessedText), `assessed claim must be appended, got ${JSON.stringify(texts)}`);
  assert.equal(new Set(doc.claims.map((c) => c.id)).size, doc.claims.length, 'claim ids must stay unique');
});

// --- 3. history claim-id atomicity ----------------------------------------

test('racing recordInvestigation writers cannot mint the same claim id', async () => {
  const m1 = await import('../lib/history.mjs?x=hist1');
  const m2 = await import('../lib/history.mjs?x=hist2');
  const owner = `race-${Date.now()}`;
  const jobs = [];
  for (let i = 0; i < 10; i++) {
    const m = i % 2 ? m1 : m2;
    jobs.push(m.recordInvestigation({ owner, workflow: 'claim', result: { text: `history claim ${i}`, verdict: 'Supported', judgedBy: 't' } }));
  }
  const out = await Promise.all(jobs);
  const returnedIds = out.map((o) => o.claim.id);
  assert.equal(new Set(returnedIds).size, 10, `claim ids collided: ${JSON.stringify(returnedIds)}`);
  const all = await new FileRepository(storeFile).loadAll();
  const stored = all.filter((d) => d.kind === 'history' && (d.owner || 'demo') === owner).flatMap((d) => d.claims || []);
  assert.equal(stored.length, 10, `expected 10 stored claims, got ${stored.length}`);
  assert.equal(new Set(stored.map((c) => c.id)).size, 10);
});

// --- 4. stale-lock preemption needs ownership -------------------------------

test('file lock carries an owner token and a foreign release cannot steal it', async () => {
  const { acquireFileLock, releaseFileLock } = await import('../lib/repositories.mjs');
  assert.equal(typeof acquireFileLock, 'function', 'lock acquire must be observable for ownership');
  const file = join(mkdtempSync(join(tmpdir(), 'tl-lockown-')), 'documents.json');
  const token = await acquireFileLock(file);
  assert.ok(token, 'acquire returns a fencing token');
  assert.equal(readFileSync(`${file}.lock/owner`, 'utf8'), token);
  await releaseFileLock(file, 'not-the-owner');
  assert.ok(readdirSync(dirOf(file)).includes('documents.json.lock'), 'foreign release must not delete a live lock');
  await releaseFileLock(file, token);
  assert.ok(!readdirSync(dirOf(file)).includes('documents.json.lock'), 'owner release cleans up');
});

test('a preempted slow holder cannot delete the new owner live lock', async () => {
  const { acquireFileLock, releaseFileLock } = await import('../lib/repositories.mjs');
  const file = join(mkdtempSync(join(tmpdir(), 'tl-lockfence-')), 'documents.json');
  const slow = await acquireFileLock(file);
  const old = new Date(Date.now() - 30000);
  utimesSync(`${file}.lock`, old, old); // slow holder exceeded the 10s stale window
  const next = await acquireFileLock(file);
  assert.notEqual(next, slow, 'preemption hands the lock to the waiter');
  await releaseFileLock(file, slow); // slow holder finally finishes
  assert.equal(readFileSync(`${file}.lock/owner`, 'utf8'), next, 'slow release must not steal the new owner lock');
  await releaseFileLock(file, next);
});

test('a stale ownerless lock is still recovered (back-compat)', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'tl-lockstale-')), 'documents.json');
  mkdirSync(`${file}.lock`, { recursive: true });
  const old = new Date(Date.now() - 30000);
  utimesSync(`${file}.lock`, old, old);
  const repo = new FileRepository(file);
  await repo.save({ id: 'doc-1', owner: 'demo', claims: [] });
  assert.equal((await new FileRepository(file).loadAll()).length, 1);
});

// --- 5. bounded caches -------------------------------------------------------

test('deletedDocIds is LRU-bounded but tombstones still win after eviction', async () => {
  const docs = await import('../lib/documents.mjs');
  assert.ok(docs.deletedDocIds, 'deleted-doc cache must be observable to prove its bound');
  assert.ok(docs.DELETED_DOC_CACHE_LIMIT > 0, 'cache limit must exist');
  const { rememberDeletedDocId, deletedDocIds, DELETED_DOC_CACHE_LIMIT } = docs;
  for (let i = 0; i < DELETED_DOC_CACHE_LIMIT + 50; i++) rememberDeletedDocId(`doc-evict-${i}`);
  assert.ok(deletedDocIds.size <= DELETED_DOC_CACHE_LIMIT, `cache must stay bounded, got ${deletedDocIds.size}`);
  assert.ok(deletedDocIds.has(`doc-evict-${DELETED_DOC_CACHE_LIMIT + 49}`), 'newest entry survives');
  assert.ok(!deletedDocIds.has('doc-evict-0'), 'oldest entry is evicted first');
  // Eviction only drops the fast path: the tombstone in the store still hides the doc.
  const { repository } = await import('../lib/repositories.mjs');
  await repository().save({ id: 'doc-tomb-cache', owner: 'demo', kind: 'tombstone', title: 'Deleted document', createdAt: new Date().toISOString(), pages: 0, chunks: [], claims: [], status: 'ready' });
  rememberDeletedDocId('doc-tomb-cache');
  for (let i = 0; i < DELETED_DOC_CACHE_LIMIT + 10; i++) rememberDeletedDocId(`doc-flood-${i}`);
  assert.ok(!deletedDocIds.has('doc-tomb-cache'), 'setup: tombstone id was evicted from memory');
  const { getDocument } = await import('../lib/documents.mjs');
  assert.equal(await getDocument('doc-tomb-cache'), null, 'evicted tombstone id must still resolve via the store');
});

test('claimIdReservations is bounded', async () => {
  const docs = await import('../lib/documents.mjs');
  assert.ok(docs.claimIdReservations, 'claim reservations must be observable to prove their bound');
  assert.ok(docs.CLAIM_RESERVATION_DOC_LIMIT > 0, 'reservation limit must exist');
  const { reserveClaimId, claimIdReservations, CLAIM_RESERVATION_DOC_LIMIT } = docs;
  const releases = [];
  for (let i = 0; i < CLAIM_RESERVATION_DOC_LIMIT + 50; i++) {
    releases.push(reserveClaimId({ id: `doc-res-${i}`, claims: [] }));
  }
  assert.ok(claimIdReservations.size <= CLAIM_RESERVATION_DOC_LIMIT, `reservations must stay bounded, got ${claimIdReservations.size}`);
  for (const r of releases) r.release();
});

// --- corrupt fail-closed stays intact -----------------------------------------

test('corrupt store still fails closed on the new write paths', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'tl-corrupt-')), 'documents.json');
  writeFileSync(file, '{not json');
  const repo = new FileRepository(file);
  assert.equal((await repo.loadAll()).length, 0);
  await assert.rejects(() => repo.save({ id: 'doc-1', owner: 'demo', claims: [] }), /corrupt/);
  if (typeof repo.update === 'function') {
    await assert.rejects(() => repo.update('doc-1', (fresh) => ({ ...(fresh || {}), id: 'doc-1' })), /corrupt/);
  } else {
    assert.fail('update() must exist and fail closed on a corrupt store');
  }
  if (typeof repo.insert === 'function') {
    await assert.rejects(() => repo.insert({ id: 'doc-9', owner: 'demo' }), /corrupt/);
  } else {
    assert.fail('insert() must exist and fail closed on a corrupt store');
  }
  assert.equal(readFileSync(file, 'utf8'), '{not json', 'corrupt bytes must survive refused writes');
});
