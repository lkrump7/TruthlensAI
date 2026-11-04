import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'tl-delete-bulk-'));
process.env.TRUTHLENS_STORE_FILE = join(dir, 'documents.json');
process.env.TRUTHLENS_USERS_FILE = join(dir, 'users.json');

const { repository } = await import('../lib/repositories.mjs');
const { deleteDocument, getDocument } = await import('../lib/documents.mjs');

function bulkDoc(id) {
  return {
    id,
    owner: 'demo',
    kind: 'excerpt',
    title: 'Scanned',
    fingerprint: 'bulk-fp-scanned-1',
    pages: 1,
    chunks: [],
    sourcePages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level.' }],
    claims: [],
    status: 'ready',
    createdAt: new Date().toISOString(),
  };
}

test('deleting one copy removes every copy sharing its fingerprint', async () => {
  const repo = repository();
  for (let i = 1; i <= 5; i++) await repo.save(bulkDoc(`doc-bulk-${i}`));
  const removed = await deleteDocument('doc-bulk-1');
  assert.ok(removed, 'expected a removed document');
  assert.equal(removed.id, 'doc-bulk-1');
  const all = await repo.loadAll();
  const survivors = all.filter((d) => d.fingerprint === 'bulk-fp-scanned-1' && d.kind !== 'tombstone');
  assert.deepEqual(survivors, []);
  for (let i = 1; i <= 5; i++) {
    assert.equal(await getDocument(`doc-bulk-${i}`), null, `doc-bulk-${i} should stay deleted`);
  }
});

test('bulk delete rewrites the store once, not once per copy', async () => {
  const repo = repository();
  for (let i = 1; i <= 5; i++) await repo.save(bulkDoc(`doc-many-${i}`));
  let persists = 0;
  const origPersist = repo.persist.bind(repo);
  repo.persist = (...args) => { persists += 1; return origPersist(...args); };
  try {
    await deleteDocument('doc-many-1');
  } finally {
    repo.persist = origPersist;
  }
  assert.ok(persists <= 3, `expected at most 3 store rewrites, saw ${persists}`);
});
