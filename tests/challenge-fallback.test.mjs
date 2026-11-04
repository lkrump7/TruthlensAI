import test from 'node:test';
import assert from 'node:assert/strict';

const { createDocument, getDocument, whenAutoVerificationDone, challengeDocumentClaim } = await import('../lib/documents.mjs');

test('a failed fresh re-check saves an Unverifiable follow-up instead of throwing (no HTTP 500)', async () => {
  const doc = await createDocument({ title: 'Fallback Excerpt', owner: 'challenge-fallback', pages: [{ page: 1, text: 'Humans only use 10% of their brains each day, waiting to be unlocked.' }] });
  await whenAutoVerificationDone(doc.id);
  const claim = (await getDocument(doc.id)).claims[0];
  const failingVerify = async () => { throw new Error('simulated fresh-source timeout'); };
  const out = await challengeDocumentClaim(doc.id, claim.id, { kind: 'stronger-contrary' }, { verify: failingVerify });
  assert.equal(out.followup.kind, 'stronger-contrary');
  assert.equal(out.followup.verdict, 'Unverifiable');
  assert.ok((out.followup.limitations || []).length > 0 || /retry|failed|live/i.test(out.followup.explanation || ''));
  const saved = (await getDocument(doc.id)).claims.find((c) => c.id === claim.id);
  assert.equal(saved.followups.length, 1);
  assert.equal(saved.followups[0].verdict, 'Unverifiable');
});
