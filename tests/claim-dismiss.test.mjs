import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'tl-dismiss-'));
process.env.TRUTHLENS_STORE_FILE = join(dir, 'documents.json');
process.env.TRUTHLENS_USERS_FILE = join(dir, 'users.json');

const { createDocument, getDocument, whenAutoVerificationDone } = await import('../lib/store.mjs');

const PAGES = [{ page: 1, text: 'The reservoir reduced flooding deaths by 60 percent across the valley over five years. Engineers recorded rainfall every day during the study period.' }];

test('a reader can dismiss a junk claim and restore it', async () => {
  const { dismissDocumentClaim } = await import('../lib/store.mjs');
  const doc = await createDocument({ title: 'Dismiss Excerpt', owner: 'dismiss-test', pages: PAGES });
  await whenAutoVerificationDone(doc.id);
  const target = (await getDocument(doc.id)).claims[0];
  assert.ok(target, 'a claim exists to dismiss');
  const dismissed = await dismissDocumentClaim(doc.id, target.id, true);
  assert.equal(dismissed.claim.dismissed, true);
  assert.equal(dismissed.claim.autoSelected, false);
  const stored = await getDocument(doc.id);
  assert.equal(stored.report.dismissed, 1);
  assert.equal(stored.report.totalClaims, stored.claims.filter((c) => !c.dismissed).length);
  const restored = await dismissDocumentClaim(doc.id, target.id, false);
  assert.equal(restored.claim.dismissed, false);
});

test('verifying a dismissed claim picks it back up', async () => {
  const { dismissDocumentClaim, verifyDocumentClaim } = await import('../lib/store.mjs');
  const doc = await createDocument({ title: 'Pick Excerpt', owner: 'dismiss-test', pages: PAGES });
  await whenAutoVerificationDone(doc.id);
  const target = (await getDocument(doc.id)).claims[0];
  assert.ok(target, 'a claim exists to pick');
  await dismissDocumentClaim(doc.id, target.id, true);
  const out = await verifyDocumentClaim(doc.id, target.id);
  assert.equal(out.claim.dismissed || false, false);
  assert.ok(out.claim.verdict, 'picked claim is checked');
});

test('website workbench offers manual pick and dismiss controls', () => {
  const src = readFileSync(new URL('../app/components/website.js', import.meta.url), 'utf8');
  assert.ok(src.includes('onVerify'), 'rail takes a pick/verify handler');
  assert.ok(src.includes('onDismiss'), 'rail takes a dismiss handler');
  assert.ok(src.includes('Dismiss'), 'dismiss control is labelled');
  assert.ok(src.includes('Restore'), 'dismissed claims can be restored');
});

test('library wires dismiss and restore to the dismiss route', () => {
  const page = readFileSync(new URL('../app/page.js', import.meta.url), 'utf8');
  assert.ok(page.includes('/dismiss'), 'page calls the dismiss endpoint');
  assert.ok(page.includes('dismissClaim') || page.includes('onDismiss'), 'page has a dismiss action');
});

test('dismiss route toggles a website claim', async () => {
  const route = await import('../app/api/documents/[id]/claims/[claimId]/dismiss/route.js');
  const doc = await createDocument({ title: 'Dismiss Route', owner: 'dismiss-test', pages: PAGES });
  await whenAutoVerificationDone(doc.id);
  const target = (await getDocument(doc.id)).claims[0];
  const req = (body) => new Request('http://t/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const res = await route.POST(req({ dismissed: true }), { params: { id: doc.id, claimId: target.id } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).claim.dismissed, true);
});
