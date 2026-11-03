import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fixDir = mkdtempSync(join(tmpdir(), 'tl-docfix-'));
process.env.TRUTHLENS_STORE_FILE = join(fixDir, 'documents.json');
process.env.TRUTHLENS_MEDIA_DIR = join(fixDir, 'media');

const { createDocument, getDocument, listDocuments, deleteDocument, assessDocumentClaim } = await import('../lib/documents.mjs');
const { repository } = await import('../lib/repositories.mjs');
const { CONFIG } = await import('../lib/config.mjs');

const PAGES = [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }];

test('deleted documents stay deleted: tombstone persists and in-flight saves cannot resurrect', async () => {
  const doc = await createDocument({ title: 'Tombstone me', owner: 'fix-tomb', pages: PAGES });
  const held = await getDocument(doc.id);
  assert.ok(held, 'setup: document exists');

  const removed = await deleteDocument(doc.id);
  assert.equal(removed?.id, doc.id);
  assert.equal(await getDocument(doc.id), null, 'deleted doc reads back null');
  assert.ok(!(await listDocuments('fix-tomb')).some((d) => d.id === doc.id), 'deleted doc leaves the library');
  assert.equal(await deleteDocument(doc.id), null, 'second removal finds nothing');

  const all = await repository().loadAll();
  assert.ok(all.some((d) => d.id === doc.id && d.kind === 'tombstone'), 'tombstone marker persists in the repository');

  // Simulate a restart: a fresh module instance has an empty memory set,
  // so only the persisted marker can keep the deletion.
  const freshDocs = await import(`../lib/documents.mjs?restart=${Date.now()}`);
  assert.equal(await freshDocs.getDocument(doc.id), null, 'tombstone survives a restart');
  assert.ok(!(await freshDocs.listDocuments('fix-tomb')).some((d) => d.id === doc.id), 'tombstone stays out of the library after restart');

  // A verdict in flight while the reader deletes must not save its held
  // copy back over the deletion.
  const doc2 = await createDocument({ title: 'In-flight tombstone', owner: 'fix-tomb', pages: PAGES });
  let release;
  const gate = new Promise((r) => { release = r; });
  const pending = assessDocumentClaim(doc2.id, 'Water boils at 100 degrees Celsius at sea level in kitchens.', {
    stance: async () => ({ stance: 'unknown', reason: 'test' }),
    verify: async (c) => { await gate; return { text: c.text, type: 'Scientific', verdict: 'Supported', judgedBy: 'Test', supporting: [], contradicting: [], explanation: 'ok', limitations: [] }; },
  });
  await deleteDocument(doc2.id);
  release();
  await pending;
  assert.equal(await getDocument(doc2.id), null, 'in-flight verdict must not resurrect a tombstoned doc');
  const survivors = (await repository().loadAll()).filter((d) => d.id === doc2.id && d.kind !== 'tombstone');
  assert.equal(survivors.length, 0, 'no full copy of the tombstoned doc is re-saved');

  // Tombstones carry no claims, so claim scans skip them naturally.
  const markers = (await repository().loadAll()).filter((d) => d.kind === 'tombstone');
  assert.ok(markers.length >= 2, 'both deletions left persisted markers');
  assert.ok(markers.every((d) => (d.claims || []).length === 0), 'tombstones carry no claims');
});

test('stored titles are truncated to 300 characters, never unbounded', async () => {
  const { normalizeTitle, createDocument: create2, getDocument: get2, deleteDocument: del2 } = await import('../lib/documents.mjs');
  assert.equal(normalizeTitle('  padded  '), 'padded', 'trim behaviour is unchanged');
  assert.equal(normalizeTitle(''), 'Untitled document', 'fallback is unchanged');
  assert.equal(normalizeTitle('x'.repeat(1000000)).length, 300, 'megabyte titles are truncated');
  const doc = await create2({ title: 'y'.repeat(500), owner: 'fix-tomb', pages: PAGES });
  try {
    assert.equal(doc.title.length, 300, 'stored title is truncated on create');
    assert.equal((await get2(doc.id)).title.length, 300, 'stored title is truncated on read');
  } finally {
    await del2(doc.id);
  }
});

test('custom challenge instructions beyond MAX_CLAIM_CHARS throw with code too-long', async () => {
  const { challengeDocumentClaim: challenge } = await import('../lib/documents.mjs');
  const doc = await createDocument({ title: 'Challenge cap', owner: 'fix-tomb', pages: PAGES });
  try {
    await assert.rejects(
      challenge(doc.id, doc.claims[0].id, { kind: 'custom', text: 'z'.repeat(CONFIG.MAX_CLAIM_CHARS + 1) }),
      (err) => err instanceof Error && err.code === 'too-long',
      'over-long custom text must throw a too-long error',
    );
    const atCap = await challenge(doc.id, doc.claims[0].id, { kind: 'custom', text: 'z'.repeat(CONFIG.MAX_CLAIM_CHARS) });
    assert.ok(atCap?.followup, 'exactly at-cap custom text is still accepted');
  } finally {
    await deleteDocument(doc.id);
  }
});

test('contradiction map surfaces opposing positions as unverified disagreement', async () => {
  // BDD spec: opposing positions surface even before verification, marked
  // as unverified disagreement — never presented as a verified verdict.
  const { buildContradictionMap } = await import('../lib/contradictions.mjs');
  const pair = (statusA, verdictA, statusB, verdictB) => ([
    { id: 'd1', title: 'Book A', claims: [{ id: 'a', text: 'Artificial intelligence increases employment across the economy.', status: statusA, verdict: verdictA, page: 1 }] },
    { id: 'd2', title: 'Book B', claims: [{ id: 'b', text: 'Artificial intelligence reduces employment across the economy.', status: statusB, verdict: verdictB, page: 4 }] },
  ]);
  const draft = buildContradictionMap(pair('pending', undefined, 'pending', undefined));
  assert.equal(draft.length, 1, 'an unverified opposing pair still maps');
  assert.equal(draft[0].verifiedDisagreement, false, 'it is marked unverified disagreement, not verified');
  const single = buildContradictionMap([
    { id: 'd1', title: 'Book A', claims: [{ id: 'a', text: 'Artificial intelligence increases employment across the economy.', status: 'verified', verdict: 'Supported', page: 1 }] },
  ]);
  assert.equal(single.length, 0, 'one document alone is not a contradiction');
});
