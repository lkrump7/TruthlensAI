import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'tl-history-delete-'));
const storeFile = join(dir, 'documents.json');
process.env.TRUTHLENS_STORE_FILE = storeFile;
delete process.env.META_MODEL_API_URL;
delete process.env.META_MODEL_API_KEY;

const { recordInvestigation, listHistory, getHistoryEntry } = await import('../lib/history.mjs');
const { createDocument, whenAutoVerificationDone } = await import('../lib/documents.mjs');

const verdictFor = (text, verdict = 'Supported') => ({
  text, type: 'Scientific', verdict, judgedBy: 'Muse Spark 1.3',
  supporting: [], contradicting: [], explanation: 'Checked.', limitations: [],
});

test('deleteHistoryEntry removes a standalone check from history', async () => {
  const { deleteHistoryEntry } = await import('../lib/history.mjs');
  const saved = await recordInvestigation({
    owner: 'reader-del-1', workflow: 'claim',
    result: verdictFor('Water boils at 100 degrees Celsius at sea level.'),
  });
  const removed = await deleteHistoryEntry('reader-del-1', saved.claim.id);
  assert.ok(removed, 'delete returns the removed record');
  assert.equal(removed.claimId, saved.claim.id);
  const entries = await listHistory('reader-del-1');
  assert.ok(!entries.some((e) => e.claimId === saved.claim.id), 'deleted claim is gone from history');
  assert.equal(await getHistoryEntry('reader-del-1', saved.claim.id), null);
});

test('deleteHistoryEntry drops idempotency keys pointing at the removed claim', async () => {
  const { deleteHistoryEntry } = await import('../lib/history.mjs');
  const { repository } = await import('../lib/repositories.mjs');
  const key = `del-key-${Date.now()}-${Math.random()}`;
  const saved = await recordInvestigation({
    owner: 'reader-del-2', workflow: 'claim',
    result: verdictFor('Water boils at 100 degrees Celsius at sea level.'),
    idempotencyKey: key,
  });
  await deleteHistoryEntry('reader-del-2', saved.claim.id);
  const all = await repository().loadAll();
  const doc = all.find((d) => d.kind === 'history' && d.owner === 'reader-del-2');
  assert.ok(doc, 'history doc survives with zero claims');
  assert.equal((doc.claims || []).length, 0);
  assert.ok(!doc.idempotencyKeys?.[key], 'stale key is gone');
});

test('deleteHistoryEntry removes one excerpt claim and keeps its siblings', async () => {
  const { deleteHistoryEntry } = await import('../lib/history.mjs');
  const doc = await createDocument({
    title: 'Delete probe excerpt', owner: 'reader-del-3',
    pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens everywhere today. Humans only use 10 percent of their brains according to the old myth repeated here.' }],
  });
  await whenAutoVerificationDone(doc.id);
  const { repository } = await import('../lib/repositories.mjs');
  const before = (await repository().loadAll()).find((d) => d.id === doc.id);
  assert.ok((before.claims || []).length >= 2, 'fixture yields at least two claims');
  const victim = before.claims[0];
  const removed = await deleteHistoryEntry('reader-del-3', victim.id);
  assert.ok(removed);
  assert.equal(removed.docId, doc.id);
  const after = (await repository().loadAll()).find((d) => d.id === doc.id);
  assert.ok(!after.claims.some((c) => c.id === victim.id), 'victim claim is gone');
  assert.equal(after.claims.length, before.claims.length - 1, 'siblings stay');
  assert.equal(after.report.totalClaims, after.claims.length, 'report is rebuilt');
});

test('deleteHistoryEntry returns null for unknown ids and other owners', async () => {
  const { deleteHistoryEntry } = await import('../lib/history.mjs');
  const saved = await recordInvestigation({
    owner: 'reader-del-4', workflow: 'claim',
    result: verdictFor('A private claim about reservoirs rising.'),
  });
  assert.equal(await deleteHistoryEntry('reader-del-4', 'claim-does-not-exist'), null);
  assert.equal(await deleteHistoryEntry('reader-del-5', saved.claim.id), null, 'another owner cannot delete it');
  const entries = await listHistory('reader-del-4');
  assert.ok(entries.some((e) => e.claimId === saved.claim.id), 'the claim survives the refused delete');
});

test('deleteHistoryEntries removes a whole similar-result group at once', async () => {
  const { deleteHistoryEntries } = await import('../lib/history.mjs');
  const owner = 'reader-del-6';
  const a = await recordInvestigation({ owner, workflow: 'claim', result: verdictFor('The valley reservoir released 40 million litres of water in June.') });
  const b = await recordInvestigation({ owner, workflow: 'claim', result: verdictFor('The valley reservoir released 40 million litres of water in June today.') });
  const listed = await listHistory(owner);
  const row = listed.find((e) => /released 40 million/.test(e.text));
  assert.ok(row && row.duplicateCount >= 2, 'fixture groups the similar pair');
  const ids = [row.claimId, ...row.duplicates.map((d) => d.claimId)];
  assert.ok(ids.includes(a.claim.id) && ids.includes(b.claim.id));
  const out = await deleteHistoryEntries(owner, ids);
  assert.equal(out.deleted.length, 2);
  const after = await listHistory(owner);
  assert.ok(!after.some((e) => /released 40 million/.test(e.text)), 'the whole group is gone');
});

test('DELETE /api/history removes the owned entry and 404s a second time', async () => {
  const { DELETE } = await import('../app/api/history/route.js');
  const saved = await recordInvestigation({
    owner: 'demo', workflow: 'claim',
    result: verdictFor('Water boils at 100 degrees Celsius at sea level.'),
  });
  const res = await DELETE(new Request('http://x/api/history', {
    method: 'DELETE', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ claimId: saved.claim.id }),
  }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.deleted, saved.claim.id);
  const again = await DELETE(new Request('http://x/api/history', {
    method: 'DELETE', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ claimId: saved.claim.id }),
  }));
  assert.equal(again.status, 404);
});
