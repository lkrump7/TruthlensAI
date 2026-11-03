import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolated store: same parallel-race rationale as tests/store.test.mjs:
// spin a private store per run instead of sharing data/documents.json.
const manageDir = mkdtempSync(join(tmpdir(), 'tl-manage-'));
process.env.TRUTHLENS_STORE_FILE = join(manageDir, 'documents.json');
process.env.TRUTHLENS_USERS_FILE = join(manageDir, 'users.json');
import { createDocument, getDocument, listDocuments, deleteDocument, documentTextPages, recheckDocument, whenAutoVerificationDone, challengeDocumentClaim } from '../lib/store.mjs';
import { FileRepository, repository } from '../lib/repositories.mjs';
import { GET, DELETE } from '../app/api/documents/[id]/route.js';

test('documentTextPages rebuilds readable pages from chunks, in page order', () => {
  const pages = documentTextPages({ chunks: [
    { id: 'c2', page: 2, text: 'Second page opens.' },
    { id: 'c1', page: 1, text: 'First part.' },
    { id: 'c1b', page: 1, text: 'First page continues.' },
    { id: 'c2b', page: 2, text: 'Second page continues.' },
  ] });
  assert.deepEqual(pages, [
    { page: 1, text: 'First part. First page continues.' },
    { page: 2, text: 'Second page opens. Second page continues.' },
  ]);
  assert.deepEqual(documentTextPages({ chunks: [] }), []);
  assert.deepEqual(documentTextPages(null), []);
});

test('viewer text is the document exactly as submitted, paragraph breaks and all', async () => {
  // Sized so the paragraph break lands on a chunk boundary: rejoined
  // chunk text (the old viewer path) flattens it to a single space.
  const sentence = `${'A'.repeat(97)}. `;
  const para1 = sentence.repeat(4).trimEnd();
  const para2 = 'It worked and flooding fell across the whole valley within five years of the gates closing for good.';
  const original = `${para1}\n\n${para2}`;
  assert.ok(original.length > 480, 'the text must span more than one chunk for this test to mean anything');
  const doc = await createDocument({ title: 'Exact text', owner: 'manage-test', pages: [{ page: 1, text: original }] });
  try {
    const pages = documentTextPages(await getDocument(doc.id));
    assert.equal(pages.length, 1);
    assert.equal(pages[0].text, original, 'viewer text must be the submitted page, not chunks rejoined with spaces');
    const listed = (await listDocuments('manage-test')).find((d) => d.id === doc.id);
    assert.ok(listed, 'document still lists');
    assert.ok(!('sourcePages' in listed), 'list payloads stay lean: the full text is not in them');
  } finally {
    await deleteDocument(doc.id);
  }
});

test('the library lists a source once, however many copies exist, and removing it removes every copy', async () => {
  const pages = [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }];
  const first = await createDocument({ title: 'Same source', owner: 'dedupe-test', pages });
  const second = await createDocument({ title: 'Same source', owner: 'dedupe-test', pages });
  const renamed = await createDocument({ title: 'Same source, renamed', owner: 'dedupe-test', pages });
  try {
    assert.notEqual(second.id, first.id, 'copies can exist in the store; the library is what dedupes');
    const listed = (await listDocuments('dedupe-test')).filter((d) => d.title === 'Same source');
    assert.equal(listed.length, 1, 'the library shows the source once');
    assert.equal(listed[0].id, second.id, 'the newest copy is the one shown');
    assert.ok((await listDocuments('dedupe-test')).some((d) => d.id === renamed.id), 'the same text under a new title is a separate entry');
    await deleteDocument(second.id);
    assert.equal(await getDocument(first.id), null, 'removing the source removes the hidden copy too');
    assert.equal((await listDocuments('dedupe-test')).filter((d) => d.title === 'Same source').length, 0, 'no copy resurfaces after removal');
  } finally {
    await deleteDocument(renamed.id);
  }
});

test('FileRepository.remove deletes a document and persists the deletion', async () => {
  const file = join(mkdtempSync(join(tmpdir(), 'tl-repo-')), 'docs.json');
  const repo = new FileRepository(file);
  await repo.save({ id: 'doc-1', title: 'Keep out', chunks: [] });
  assert.equal(await repo.remove('doc-1'), true);
  assert.deepEqual(await repo.loadAll(), []);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), []);
  assert.equal(await repo.remove('doc-1'), false, 'removing a missing document reports false');
});

test('deleteDocument removes a library document for good', async () => {
  const doc = await createDocument({ title: 'Delete me', owner: 'manage-test', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }] });
  const removed = await deleteDocument(doc.id);
  assert.equal(removed?.id, doc.id);
  assert.equal(await getDocument(doc.id), null);
  assert.ok(!(await listDocuments('manage-test')).some((d) => d.id === doc.id));
  assert.equal(await deleteDocument(doc.id), null, 'a second removal finds nothing to remove');
  assert.equal(await deleteDocument('doc-does-not-exist'), null);
});

test('deleteDocument never removes the investigation history store', async () => {
  const { repository } = await import('../lib/repositories.mjs');
  const fake = { id: 'doc-history-guard', owner: 'manage-test', kind: 'history', title: 'Investigation history', chunks: [], claims: [], pages: 0 };
  await repository().save(fake);
  try {
    assert.equal(await deleteDocument(fake.id), null);
    assert.equal((await getDocument(fake.id))?.kind, 'history');
  } finally {
    await repository().remove(fake.id);
  }
});

test('GET /api/documents/[id] returns the document text for the popup viewer', async () => {
  const doc = await createDocument({ title: 'View me', owner: 'manage-test', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }] });
  try {
    const res = await GET(new Request(`http://x/api/documents/${doc.id}`), { params: { id: doc.id } });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.document.title, 'View me');
    assert.ok(Array.isArray(body.document.contentPages), 'viewer payload carries contentPages');
    assert.match(body.document.contentPages.map((p) => p.text).join(' '), /Water boils/);
    assert.ok(!('chunks' in body.document), 'raw chunks stay out of the viewer payload');
    const missing = await GET(new Request('http://x/api/documents/nope'), { params: { id: 'nope' } });
    assert.equal(missing.status, 404);
  } finally {
    await deleteDocument(doc.id);
  }
});

test('created documents store a trimmed title', async () => {
  const doc = await createDocument({ title: '  Padded title  ', owner: 'manage-test', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }] });
  try {
    assert.equal(doc.title, 'Padded title', 'title is trimmed on create so exact-title confirms can match');
    assert.equal((await getDocument(doc.id)).title, 'Padded title');
  } finally {
    await deleteDocument(doc.id);
  }
});

test('DELETE /api/documents/[id] removes the document and then 404s', async () => {
  const doc = await createDocument({ title: 'Remove via API', owner: 'manage-test', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }] });
  const res = await DELETE(new Request(`http://x/api/documents/${doc.id}`, { method: 'DELETE' }), { params: { id: doc.id } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.deleted, doc.id);
  assert.equal(await getDocument(doc.id), null);
  const again = await DELETE(new Request(`http://x/api/documents/${doc.id}`, { method: 'DELETE' }), { params: { id: doc.id } });
  assert.equal(again.status, 404);
});

test('recheck keeps going past one bad claim instead of aborting the loop', async () => {
  const doc = await createDocument({
    title: 'Recheck skips bad claims',
    owner: 'recheck-test',
    pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level. Apollo 11 landed on the Moon in 1969. Honey never spoils in sealed jars.' }],
  });
  try {
    await whenAutoVerificationDone(doc.id);
    const before = await getDocument(doc.id);
    assert.ok(before.claims.length >= 2, 'fixture needs 2+ claims');
    before.claims[1].status = 'bogus-status';
    await repository().save(before);
    const after = await recheckDocument(doc.id);
    assert.ok(after, 'recheck resolves instead of throwing');
    const fresh = await getDocument(doc.id);
    assert.equal(fresh.claims[1].status, 'bogus-status', 'the bad claim is left untouched');
    assert.equal(fresh.claims[0].status, 'verified', 'the good claim is still rechecked');
  } finally {
    await deleteDocument(doc.id);
  }
});

test('a challenge followup survives its claim vanishing mid-challenge', async () => {
  const doc = await createDocument({
    title: 'Challenge re-attaches vanished claims',
    owner: 'challenge-test',
    pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchen tests.' }],
  });
  try {
    await whenAutoVerificationDone(doc.id);
    const claimId = (await getDocument(doc.id)).claims[0].id;
    // A concurrent write strips the claim after the challenge loads it:
    // the locked save must re-attach it, not file the followup away.
    const repo = repository();
    const origLoadAll = repo.loadAll.bind(repo);
    let calls = 0;
    repo.loadAll = async (...a) => {
      calls++;
      const docs = await origLoadAll(...a);
      if (calls >= 2) {
        const d = docs.find((x) => x.id === doc.id);
        if (d) d.claims = (d.claims || []).filter((c) => c.id !== claimId);
      }
      return docs;
    };
    let out;
    try {
      out = await challengeDocumentClaim(doc.id, claimId, { kind: 'compare-author' });
    } finally {
      repo.loadAll = origLoadAll;
    }
    assert.ok(out, 'challenge resolves');
    const target = ((await getDocument(doc.id)).claims || []).find((c) => c.id === claimId);
    assert.ok(target, 'the claim is still in stored state');
    assert.equal((target.followups || []).length, 1, 'the followup persisted with the claim');
  } finally {
    await deleteDocument(doc.id);
  }
});
