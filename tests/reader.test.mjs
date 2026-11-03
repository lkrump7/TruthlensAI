import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'tl-reader-'));
process.env.TRUTHLENS_STORE_FILE = join(dir, 'documents.json');
process.env.AUTH_SECRET ||= 'test-secret-for-reader-suite';
delete process.env.META_MODEL_API_URL;
delete process.env.META_MODEL_API_KEY;

const { createDocument, getDocument, listDocuments, whenAutoVerificationDone, verifyDocumentClaim, assessDocumentClaim, challengeDocumentClaim, setAutoPaused, startAutoVerification, runAutoVerification, recheckDocument, setDocStatus, setClaimStatus } = await import('../lib/documents.mjs');
const assessRoute2 = await import('../app/api/documents/[id]/assess/route.js');
const { repository } = await import('../lib/repositories.mjs');
const challengeRoute = await import('../app/api/documents/[id]/claims/[claimId]/challenge/route.js');
const autoRoute = await import('../app/api/documents/[id]/auto/route.js');
const verifyClaimRoute = await import('../app/api/documents/[id]/claims/[claimId]/verify/route.js');
const assessRoute = await import('../app/api/documents/[id]/assess/route.js');
const eventsRoute = await import('../app/api/documents/[id]/events/route.js');
const { createSessionToken, authSecret } = await import('../lib/auth.mjs');
const { CONFIG } = await import('../lib/config.mjs');

const bigBook = () => {
  const pages = [];
  for (let p = 1; p <= 60; p++) pages.push({ page: p, text: `Chapter background on page ${p} explains general context and definitions for readers of this book at length today.` });
  pages[58] = { page: 59, text: 'The vaccine reduced hospitalisations by 80 percent among elderly residents in the trial.' };
  return pages;
};

test('createDocument preserves every extracted claim; only the top 20 are auto-selected', async () => {
  const doc = await createDocument({ title: 'Big Book', owner: 'reader', pages: bigBook() });
  assert.equal(doc.claims.length, doc.foundClaims);
  assert.ok(doc.foundClaims > 20, `found ${doc.foundClaims}`);
  const auto = doc.claims.filter((c) => c.autoSelected);
  assert.equal(auto.length, 20);
  assert.ok(doc.claims.some((c) => !c.autoSelected && c.status === 'unverified'));
  assert.ok(doc.claims.every((c) => c.source === 'auto'));
});

test('duplicate claim text does not break the auto-verify cap (TL-008)', async () => {
  const savedCap = CONFIG.MAX_CLAIMS_PER_DOCUMENT;
  CONFIG.MAX_CLAIMS_PER_DOCUMENT = 1;
  try {
    const text = 'Water boils at 100 degrees Celsius at sea level in kitchens.';
    // The real extractor dedupes exact text (lib/claims.mjs), so three
    // claim objects with one text reach createDocument only through the
    // deps seam. Pin the cap where createDocument applies it.
    const extractClaims = async () => [1, 2, 3].map((page) => ({ text, type: 'Scientific', page, pages: [page], internalContradiction: false }));
    const doc = await createDocument({ title: 'Duplicate Book', owner: 'reader', pages: [{ page: 1, text }] }, { extractClaims });
    assert.equal(doc.foundClaims, 3);
    assert.equal(doc.claims.filter((c) => c.autoSelected).length, 1);
    assert.equal(doc.claims[0].autoSelected, true);
    assert.equal(doc.deferredClaims, 2);
    assert.ok(doc.claims.slice(1).every((c) => !c.autoSelected && c.status === 'unverified'));
    await whenAutoVerificationDone(doc.id);
  } finally { CONFIG.MAX_CLAIMS_PER_DOCUMENT = savedCap; }
});

test('background auto-verification settles the top 20 and leaves the rest unverified', async () => {
  const doc = await createDocument({ title: 'Settle Book', owner: 'reader', pages: bigBook() });
  await whenAutoVerificationDone(doc.id);
  const after = await getDocument(doc.id);
  const auto = after.claims.filter((c) => c.autoSelected);
  assert.ok(auto.every((c) => c.status === 'verified' && c.verdict && c.history?.length === 1));
  assert.ok(after.claims.filter((c) => !c.autoSelected).every((c) => c.status === 'unverified'));
  assert.equal(after.status, 'ready');
  assert.ok(after.report.autoVerified >= 1);
  assert.equal(after.report.readerInvestigated, 0);
});

test('reader can verify any not-yet-verified claim on demand', async () => {
  const doc = await createDocument({ title: 'Pick Book', owner: 'reader', pages: bigBook() });
  await whenAutoVerificationDone(doc.id);
  const settled = await getDocument(doc.id);
  const pick = settled.claims.find((c) => c.status === 'unverified');
  assert.ok(pick);
  const out = await verifyDocumentClaim(doc.id, pick.id);
  assert.equal(out.claim.status, 'verified');
  assert.ok(out.claim.verdict);
  assert.equal(out.claim.source, 'reader-pick');
  const after = await getDocument(doc.id);
  assert.equal(after.report.readerInvestigated, 1);
  assert.equal(await verifyDocumentClaim(doc.id, 'no-such-claim'), null);
  assert.equal(await verifyDocumentClaim('doc-999999', pick.id), null);
});

test('reader-pick marking does not erase a follow-up saved after the verdict (TL-020)', async () => {
  const doc = await createDocument({ title: 'Pick Race Book', owner: 'reader', pages: bigBook() });
  await whenAutoVerificationDone(doc.id);
  const pick = (await getDocument(doc.id)).claims.find((c) => c.status === 'unverified');
  assert.ok(pick);
  const repo = repository();
  const origSave = repo.save.bind(repo);
  const origLoadAll = repo.loadAll.bind(repo);
  let injected = false;
  repo.save = async (d) => {
    await origSave(d);
    if (!injected && d.id === doc.id && d.claims.find((c) => c.id === pick.id)?.status === 'verified') {
      injected = true;
      const stored = structuredClone((await origLoadAll()).find((x) => x.id === doc.id));
      const target = stored.claims.find((c) => c.id === pick.id);
      target.followups = [{ at: new Date().toISOString(), kind: 'custom', instruction: 'concurrent', verdict: target.verdict, judgedBy: target.judgedBy, explanation: '', supporting: [], contradicting: [] }];
      await origSave(stored);
    }
  };
  let out;
  try { out = await verifyDocumentClaim(doc.id, pick.id); } finally { repo.save = origSave; }
  assert.equal(out.claim.source, 'reader-pick');
  const saved = (await getDocument(doc.id)).claims.find((c) => c.id === pick.id);
  assert.equal(saved.source, 'reader-pick');
  assert.equal(saved.followups?.length, 1, 'follow-up saved after the verdict must survive reader-pick marking');
});

test('verify-claim route returns the verified claim and 404s unknown ids', async () => {
  const doc = await createDocument({ title: 'Route Book', owner: 'reader', pages: bigBook() });
  await whenAutoVerificationDone(doc.id);
  const pick = (await getDocument(doc.id)).claims.find((c) => c.status === 'unverified');
  const res = await verifyClaimRoute.POST(new Request('http://t/x', { method: 'POST' }), { params: { id: doc.id, claimId: pick.id } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.claim.id, pick.id);
  assert.equal(body.claim.status, 'verified');
  assert.equal((await verifyClaimRoute.POST(new Request('http://t/x', { method: 'POST' }), { params: { id: doc.id, claimId: 'nope' } })).status, 404);
  assert.equal((await verifyClaimRoute.POST(new Request('http://t/x', { method: 'POST' }), { params: { id: 'doc-999999', claimId: pick.id } })).status, 404);
});

test('reader-submitted theory is investigated against the book and external evidence', async () => {
  const doc = await createDocument({ title: 'Reservoir Book', owner: 'reader', pages: [
    { page: 1, text: 'The committee concluded that the new reservoir, built over five years,' },
    { page: 2, text: 'reduced flooding deaths by 60 percent across the whole valley region.' },
    { page: 3, text: 'Water boils at 100 degrees Celsius at sea level in kitchens everywhere today.' },
  ] });
  await whenAutoVerificationDone(doc.id);
  const stance = async () => ({ stance: 'supports', reason: 'The author states the reduction directly.' });
  const out = await assessDocumentClaim(doc.id, 'The reservoir reduced flooding deaths by 60 percent.', { stance });
  assert.equal(out.claim.source, 'reader-submitted');
  assert.equal(out.claim.status, 'verified');
  assert.ok(out.claim.verdict);
  assert.ok(out.claim.bookPassages.length >= 1);
  assert.deepEqual(out.claim.bookPassages.map((p) => p.page).sort(), [1, 2]);
  assert.match(out.claim.bookPassages.map((p) => p.passage).join(' '), /reservoir/i);
  assert.equal(out.claim.authorStance.stance, 'supports');
  const after = await getDocument(doc.id);
  assert.ok(after.report.readerInvestigated >= 1);
  assert.equal(await assessDocumentClaim('doc-999999', 'Anything at all.'), null);
});

test('a compound reader theory surfaces per-proposition passages, stance, and verdicts', async () => {
  const doc = await createDocument({ title: 'Theory Book', owner: 'reader', pages: [
    { page: 1, text: 'The reservoir reduced flooding deaths across the valley. Water boils at 100 degrees Celsius at sea level in kitchens.' },
    { page: 2, text: 'Flooding deaths fell sharply after the reservoir opened, the report says.' },
  ] });
  await whenAutoVerificationDone(doc.id);
  const stance = async (text) => ({ stance: 'discusses', reason: `stance for: ${text}` });
  const verify = async ({ text }) => ({
    text, verdict: 'Partially supported', judgedBy: 'Muse Spark 1.3', supporting: [], contradicting: [], explanation: 'rollup',
    subclaims: [
      { text: 'The reservoir reduced flooding deaths', verdict: 'Supported', judgedBy: 'Muse Spark 1.3' },
      { text: 'it was built in 1998', verdict: 'Contradicted', judgedBy: 'Muse Wonder' },
    ],
  });
  const out = await assessDocumentClaim(doc.id, 'The reservoir reduced flooding deaths and it was built in 1998.', { stance, verify });
  assert.ok(out.claim.propositions, 'compound submissions must carry propositions');
  assert.equal(out.claim.propositions.length, 2);
  assert.equal(out.claim.propositions[0].verdict, 'Supported');
  assert.equal(out.claim.propositions[1].verdict, 'Contradicted');
  assert.ok(Array.isArray(out.claim.propositions[0].passages));
  assert.match(out.claim.propositions[1].authorStance.reason, /built in 1998/);
  const single = await assessDocumentClaim(doc.id, 'Water boils at 100 degrees Celsius at sea level.', { stance, verify: async ({ text }) => ({ text, verdict: 'Supported', judgedBy: 'Muse Spark 1.3', supporting: [], contradicting: [], explanation: '' }) });
  assert.equal(single.claim.propositions, undefined, 'single claims gain no proposition machinery');
});

test('assess route validates input and 404s unknown documents', async () => {
  const doc = await createDocument({ title: 'Assess Route', owner: 'reader', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }] });
  const req = (body) => new Request('http://t/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await assessRoute.POST(req({ text: '  ' }), { params: { id: doc.id } })).status, 400);
  assert.equal((await assessRoute.POST(req({ text: 'Water boils at sea level.' }), { params: { id: 'doc-999999' } })).status, 404);
  const res = await assessRoute.POST(req({ text: 'Water boils at 100 degrees Celsius at sea level.' }), { params: { id: doc.id } });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.claim.source, 'reader-submitted');
  assert.ok(body.claim.bookPassages.length >= 1);
});

test('reader can challenge a verdict; the follow-up is recorded and the original verdict stands', async () => {
  const doc = await createDocument({ title: 'Challenge Book', owner: 'reader', pages: [{ page: 1, text: 'Humans only use 10% of their brains each day, waiting to be unlocked.' }] });
  await whenAutoVerificationDone(doc.id);
  const claim = (await getDocument(doc.id)).claims[0];
  const original = claim.verdict;
  const out = await challengeDocumentClaim(doc.id, claim.id, { kind: 'prove-wrong' });
  assert.equal(out.followup.kind, 'prove-wrong');
  assert.match(out.followup.instruction, /prove.*wrong/i);
  assert.ok(out.followup.verdict);
  const after = await getDocument(doc.id);
  const saved = after.claims.find((c) => c.id === claim.id);
  assert.equal(saved.verdict, original);
  assert.equal(saved.followups.length, 1);
  const custom = await challengeDocumentClaim(doc.id, claim.id, { kind: 'custom', text: 'Investigate whether sleep changes the picture.' });
  assert.match(custom.followup.instruction, /sleep/);
  assert.equal((await getDocument(doc.id)).claims.find((c) => c.id === claim.id).followups.length, 2);
  await assert.rejects(() => challengeDocumentClaim(doc.id, claim.id, { kind: 'nonsense' }), /unknown challenge/i);
  assert.equal(await challengeDocumentClaim(doc.id, 'nope', { kind: 'prove-wrong' }), null);
});

test('challenge kinds do different work, not the same rerun in three labels', async () => {
  const doc = await createDocument({ title: 'Kinds Book', owner: 'reader', pages: [{ page: 1, text: 'Humans only use 10% of their brains each day, waiting to be unlocked.' }] });
  await whenAutoVerificationDone(doc.id);
  const claim = (await getDocument(doc.id)).claims[0];

  const compare = await challengeDocumentClaim(doc.id, claim.id, { kind: 'compare-author' });
  assert.ok(compare.followup.comparison, 'compare-author must attach a comparison, not a fresh verdict');
  assert.ok(Array.isArray(compare.followup.comparison.passages));
  assert.ok(compare.followup.comparison.authorStance);
  assert.equal(compare.followup.verdict, claim.verdict, 'comparison reports the standing verdict, never a new one');

  const stronger = await challengeDocumentClaim(doc.id, claim.id, { kind: 'stronger-contrary' });
  assert.ok(Array.isArray(stronger.followup.contradicting));
  assert.equal(typeof stronger.followup.opposingDomains, 'number');
  assert.ok(Array.isArray(stronger.followup.newOpposing));

  const prove = await challengeDocumentClaim(doc.id, claim.id, { kind: 'prove-wrong' });
  assert.match(prove.followup.falsifier, /contradict/i);
  assert.equal(typeof prove.followup.falsifierFound, 'boolean');
  assert.equal(prove.followup.falsifierFound, prove.followup.contradicting.length > 0);

  const support = await challengeDocumentClaim(doc.id, claim.id, { kind: 'stronger-support' });
  assert.ok(Array.isArray(support.followup.supporting));
  assert.equal(typeof support.followup.supportingDomains, 'number');
  assert.ok(Array.isArray(support.followup.newSupporting), 'stronger-support names the supporting evidence that is new');

  const confirm = await challengeDocumentClaim(doc.id, claim.id, { kind: 'prove-right' });
  assert.match(confirm.followup.confirmer, /supporting/i);
  assert.equal(typeof confirm.followup.confirmerFound, 'boolean');
  assert.equal(confirm.followup.confirmerFound, confirm.followup.supporting.length > 0);
});

test('challenge route validates kind and 404s unknown claims', async () => {
  const doc = await createDocument({ title: 'Challenge Route', owner: 'reader', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }] });
  await whenAutoVerificationDone(doc.id);
  const claim = (await getDocument(doc.id)).claims[0];
  const req = (body) => new Request('http://t/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await challengeRoute.POST(req({ kind: 'nonsense' }), { params: { id: doc.id, claimId: claim.id } })).status, 400);
  assert.equal((await challengeRoute.POST(req({ kind: 'custom' }), { params: { id: doc.id, claimId: claim.id } })).status, 400);
  assert.equal((await challengeRoute.POST(req({ kind: 'prove-wrong' }), { params: { id: doc.id, claimId: 'nope' } })).status, 404);
  const res = await challengeRoute.POST(req({ kind: 'stronger-contrary' }), { params: { id: doc.id, claimId: claim.id } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).followup.kind, 'stronger-contrary');
});

test('pause halts the automatic pass and resume finishes it', async () => {
  const doc = await createDocument({ title: 'Pause Book', owner: 'reader', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }] });
  await whenAutoVerificationDone(doc.id);
  // The repository has copy semantics: reset the claim on a fresh copy and
  // persist it, so the next pass sees a pending claim.
  const reset = await getDocument(doc.id);
  const claim = reset.claims[0];
  claim.status = 'pending'; claim.autoSelected = true; delete claim.verdict;
  await repository().save(reset);
  await setAutoPaused(doc.id, true);
  await startAutoVerification(await getDocument(doc.id));
  assert.equal((await getDocument(doc.id)).claims[0].status, 'pending');
  assert.equal((await getDocument(doc.id)).status, 'paused');
  await setAutoPaused(doc.id, false);
  await whenAutoVerificationDone(doc.id);
  assert.equal((await getDocument(doc.id)).claims[0].status, 'verified');
  assert.equal(await setAutoPaused('doc-999999', true), null);
});

test('auto-verification re-reads state between claims, so pause wins over a stale copy', async () => {
  const doc = await createDocument({ title: 'Copy Pause', owner: 'reader', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens. Humans only use 10% of their brains each day.' }] });
  await whenAutoVerificationDone(doc.id);
  const stored = await getDocument(doc.id);
  assert.ok(stored.claims.length >= 2);
  for (const c of stored.claims.slice(0, 2)) { c.status = 'pending'; c.autoSelected = true; delete c.verdict; }
  await repository().save(stored);
  // A Postgres-backed load hands the loop a copy, not the stored object.
  // Pausing after the loop starts must still stop it before claim two.
  const staleCopy = structuredClone(await getDocument(doc.id));
  const job = runAutoVerification(staleCopy);
  await setAutoPaused(doc.id, true);
  await job;
  const after = await getDocument(doc.id);
  const settled = after.claims.slice(0, 2).filter((c) => c.status === 'verified').length;
  assert.ok(settled < 2, `pause lost: ${settled} of 2 claims verified after pausing`);
  assert.equal(after.status, 'paused');
  assert.equal(after.autoPaused, true, 'the loop must not overwrite the pause flag with its stale copy');
});

test('auto route toggles pause and 404s unknown documents', async () => {
  const doc = await createDocument({ title: 'Auto Route', owner: 'reader', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }] });
  const req = (body) => new Request('http://t/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const res = await autoRoute.POST(req({ paused: true }), { params: { id: doc.id } });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).document.autoPaused, true);
  assert.equal((await autoRoute.POST(req({ paused: false }), { params: { id: 'doc-999999' } })).status, 404);
});

test('concurrent reader submissions get distinct claim ids and both survive', async () => {
  const doc = await createDocument({ title: 'Race Book', owner: 'reader', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }] });
  await whenAutoVerificationDone(doc.id);
  const stance = async () => ({ stance: 'discusses', reason: 'x' });
  const verify = async ({ text }) => { await new Promise((r) => setTimeout(r, 10)); return { text, verdict: 'Supported', judgedBy: 'Muse Spark 1.3', supporting: [], contradicting: [], explanation: '' }; };
  // Copy semantics, as Postgres gives: each load is a separate object,
  // so a stale copy cannot see the other submission land.
  const repo = repository();
  const origLoadAll = repo.loadAll.bind(repo);
  repo.loadAll = async () => structuredClone(await origLoadAll());
  let a, b;
  try {
    [a, b] = await Promise.all([
      assessDocumentClaim(doc.id, 'The reservoir reduced flooding deaths by 60 percent.', { stance, verify }),
      assessDocumentClaim(doc.id, 'The reservoir reduced flooding deaths by 20 percent.', { stance, verify }),
    ]);
  } finally { repo.loadAll = origLoadAll; }
  assert.notEqual(a.claim.id, b.claim.id);
  const after = await getDocument(doc.id);
  assert.ok(after.claims.some((c) => c.id === a.claim.id && /60 percent/.test(c.text)));
  assert.ok(after.claims.some((c) => c.id === b.claim.id && /20 percent/.test(c.text)));
});

test('a verdict apply does not erase a follow-up saved during its slow verify (TL-007)', async () => {
  const doc = await createDocument({ title: 'Verdict Race', owner: 'reader', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }] });
  await whenAutoVerificationDone(doc.id);
  const claim = (await getDocument(doc.id)).claims[0];
  const repo = repository();
  const origLoadAll = repo.loadAll.bind(repo);
  // Copy semantics, as Postgres gives. Paired loads snapshot at arrival and
  // wait for each other, so the verdict load and the follow-up load both
  // read pre-save state. A lone load (the locked path serializes them)
  // proceeds after the timeout with its snapshot.
  let waiters = [];
  let timer = null;
  const release = () => { const ws = waiters; waiters = []; if (timer) { clearTimeout(timer); timer = null; } for (const w of ws) w(); };
  repo.loadAll = async () => {
    const snapshot = structuredClone(await origLoadAll());
    await new Promise((resolve) => {
      waiters.push(resolve);
      if (waiters.length >= 2) release();
      else if (!timer) timer = setTimeout(release, 100);
    });
    return snapshot;
  };
  const stance = async () => ({ stance: 'discusses', reason: 'x' });
  const verify = async ({ text }) => { await new Promise((r) => setTimeout(r, 20)); return { text, verdict: 'Supported', judgedBy: 'Muse Spark 1.3', supporting: [], contradicting: [], explanation: '' }; };
  let assessed, challenged;
  try {
    [assessed, challenged] = await Promise.all([
      assessDocumentClaim(doc.id, 'The reservoir reduced flooding deaths by 60 percent.', { stance, verify }),
      challengeDocumentClaim(doc.id, claim.id, { kind: 'prove-wrong' }),
    ]);
  } finally { repo.loadAll = origLoadAll; }
  assert.ok(assessed.claim.id);
  assert.equal(challenged.followup.kind, 'prove-wrong');
  const after = await getDocument(doc.id);
  const savedClaim = after.claims.find((c) => c.id === assessed.claim.id);
  assert.ok(savedClaim, 'verdict claim must survive');
  assert.equal(savedClaim.status, 'verified');
  assert.equal(savedClaim.verdict, 'Supported');
  const target = after.claims.find((c) => c.id === claim.id);
  assert.equal(target.followups?.length, 1, 'follow-up saved during the verdict apply must survive');
  assert.equal(target.followups[0].kind, 'prove-wrong');
});

test('starting auto-verification twice runs one loop, not two', async () => {
  const doc = await createDocument({ title: 'Guard Book', owner: 'reader', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }] });
  await whenAutoVerificationDone(doc.id);
  const stored = await getDocument(doc.id);
  stored.claims[0].status = 'pending'; stored.claims[0].autoSelected = true; stored.claims[0].history = [];
  await repository().save(stored);
  const fresh = await getDocument(doc.id);
  startAutoVerification(fresh);
  startAutoVerification(fresh);
  await whenAutoVerificationDone(doc.id);
  const after = await getDocument(doc.id);
  assert.equal(after.claims[0].status, 'verified');
  assert.equal(after.claims[0].history.length, 1);
});

test('idempotency key replays an assess request instead of investigating twice', async () => {
  const doc = await createDocument({ title: 'Idem Book', owner: 'reader', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }] });
  await whenAutoVerificationDone(doc.id);
  let verifies = 0;
  const stance = async () => ({ stance: 'discusses', reason: 'x' });
  const verify = async ({ text }) => { verifies++; return { text, verdict: 'Supported', judgedBy: 'Muse Spark 1.3', supporting: [], contradicting: [], explanation: '' }; };
  const deps = { stance, verify, idempotencyKey: 'assess-key-1' };
  const a = await assessDocumentClaim(doc.id, 'The reservoir reduced flooding deaths by 60 percent.', deps);
  const b = await assessDocumentClaim(doc.id, 'The reservoir reduced flooding deaths by 60 percent.', deps);
  assert.equal(a.claim.id, b.claim.id);
  assert.equal(verifies, 1);
  await assert.rejects(() => assessDocumentClaim(doc.id, 'A completely different theory about flooding.', deps), /conflict/i);
  const req = (text, key) => new Request('http://t/x', { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) }, body: JSON.stringify({ text }) });
  const r1 = await assessRoute2.POST(req('Water boils at 100 degrees Celsius at sea level.', 'route-key-1'), { params: { id: doc.id } });
  const r2 = await assessRoute2.POST(req('Water boils at 100 degrees Celsius at sea level.', 'route-key-1'), { params: { id: doc.id } });
  assert.equal(r1.status, 200); assert.equal(r2.status, 200);
  assert.equal((await r1.json()).claim.id, (await r2.json()).claim.id);
  assert.equal((await assessRoute2.POST(req('Another theory entirely about reservoirs.', 'route-key-1'), { params: { id: doc.id } })).status, 409);
});

test('status guards allow the legal cycles and reject illegal jumps', () => {
  const doc = { status: 'ready' };
  setDocStatus(doc, 'verifying'); setDocStatus(doc, 'paused'); setDocStatus(doc, 'verifying'); setDocStatus(doc, 'ready');
  assert.equal(doc.status, 'ready');
  assert.throws(() => setDocStatus(doc, 'verified'), /illegal document status/i);
  const claim = { status: 'pending' };
  setClaimStatus(claim, 'verified');
  assert.throws(() => setClaimStatus(claim, 'unverified'), /illegal claim status/i);
});

test('events route streams the document snapshot as SSE', async () => {
  const doc = await createDocument({ title: 'Stream Book', owner: 'reader', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }] });
  const res = await eventsRoute.GET(new Request('http://t/x'), { params: { id: doc.id } });
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const reader = res.body.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), new RegExp(doc.id));
  await reader.cancel();
  assert.equal((await eventsRoute.GET(new Request('http://t/x'), { params: { id: 'doc-999999' } })).status, 404);
});

test('events route owner-checks the stream when accounts are on (TL-003)', async () => {
  const aliceDoc = await createDocument({ title: 'Alice Stream', owner: 'alice', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }] });
  const bobDoc = await createDocument({ title: 'Bob Stream', owner: 'bob', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }] });
  const demoDoc = await createDocument({ title: 'Demo Stream', owner: 'demo', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }] });
  const cookie = `tl_session=${encodeURIComponent(createSessionToken('alice', authSecret()))}`;
  const asAlice = () => new Request('http://t/x', { headers: { cookie } });
  const readFirst = async (res) => {
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'text/event-stream');
    const reader = res.body.getReader();
    const first = await reader.read();
    assert.match(new TextDecoder().decode(first.value), /data: /);
    await reader.cancel();
  };
  const saved = process.env.AUTH_ENABLED;
  try {
    process.env.AUTH_ENABLED = 'true';
    const denied = await eventsRoute.GET(asAlice(), { params: { id: bobDoc.id } });
    if (denied.status !== 404) await denied.body?.cancel().catch(() => {});
    assert.equal(denied.status, 404);
    assert.deepEqual(await denied.json(), { error: 'Document not found.' });
    const anonDenied = await eventsRoute.GET(new Request('http://t/x'), { params: { id: bobDoc.id } });
    if (anonDenied.status !== 404) await anonDenied.body?.cancel().catch(() => {});
    assert.equal(anonDenied.status, 404);
    await readFirst(await eventsRoute.GET(asAlice(), { params: { id: aliceDoc.id } }));
    await readFirst(await eventsRoute.GET(asAlice(), { params: { id: demoDoc.id } }));
    delete process.env.AUTH_ENABLED;
    await readFirst(await eventsRoute.GET(new Request('http://t/x'), { params: { id: bobDoc.id } }));
  } finally {
    if (saved === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = saved;
  }
});

test('a document orphaned mid-verification resumes when listed again', async () => {
  const doc = await createDocument({ title: 'Orphan Book', owner: 'reader', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }] });
  await whenAutoVerificationDone(doc.id);
  const stored = await getDocument(doc.id);
  stored.claims[0].status = 'pending'; stored.claims[0].autoSelected = true; stored.status = 'verifying'; delete stored.claims[0].verdict;
  await repository().save(stored);
  await listDocuments('reader');
  await whenAutoVerificationDone(doc.id);
  const after = await getDocument(doc.id);
  assert.equal(after.claims[0].status, 'verified');
  assert.equal(after.status, 'ready');
});

test('a failed auto-verification job does not leave the document verifying forever', async () => {
  const doc = await createDocument({ title: 'Fail Book', owner: 'reader', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }] });
  await whenAutoVerificationDone(doc.id);
  const stored = await getDocument(doc.id);
  stored.claims[0].status = 'pending'; stored.claims[0].autoSelected = true;
  const repo = repository();
  const origSave = repo.save.bind(repo);
  await origSave(stored);
  repo.save = async () => { throw new Error('disk full'); };
  try { startAutoVerification(await getDocument(doc.id)); await whenAutoVerificationDone(doc.id); }
  finally { repo.save = origSave; }
  assert.notEqual((await getDocument(doc.id)).status, 'verifying');
});

test('recheck preserves a follow-up that lands while it runs', async () => {
  const doc = await createDocument({ title: 'Recheck Book', owner: 'reader', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens. Humans only use 10% of their brains each day.' }] });
  await whenAutoVerificationDone(doc.id);
  const repo = repository();
  const origLoadAll = repo.loadAll.bind(repo);
  let armed = true;
  repo.loadAll = async () => {
    const docs = structuredClone(await origLoadAll());
    if (armed) {
      armed = false;
      const stored = (await origLoadAll()).find((d) => d.id === doc.id);
      stored.claims[0].followups = [{ at: new Date().toISOString(), kind: 'custom', instruction: 'concurrent', verdict: stored.claims[0].verdict, judgedBy: stored.claims[0].judgedBy, explanation: '', supporting: [], contradicting: [] }];
      await repo.save(stored);
    }
    return docs;
  };
  try { await recheckDocument(doc.id); } finally { repo.loadAll = origLoadAll; }
  const after = await getDocument(doc.id);
  assert.equal(after.claims[0].followups?.length, 1);
});

test('a small document auto-verifies all of its claims in the background', async () => {
  const doc = await createDocument({ title: 'Small', owner: 'reader', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens. Humans only use 10% of their brains each day.' }] });
  await whenAutoVerificationDone(doc.id);
  const after = await getDocument(doc.id);
  assert.ok(after.claims.length >= 2);
  assert.ok(after.claims.every((c) => c.status === 'verified'));
});
