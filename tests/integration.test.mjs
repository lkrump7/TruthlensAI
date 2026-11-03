import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolate persistence before any route touches the store/auth singletons.
const dir = mkdtempSync(join(tmpdir(), 'tl-int-'));
process.env.TRUTHLENS_STORE_FILE = join(dir, 'documents.json');
process.env.TRUTHLENS_USERS_FILE = join(dir, 'users.json');
process.env.AUTH_SECRET ||= 'test-secret-for-integration-suite';
delete process.env.META_MODEL_API_URL;
delete process.env.META_MODEL_API_KEY;

const { POST: verifyPost } = await import('../app/api/verify/route.js');
const { POST: docsPost, GET: docsGet } = await import('../app/api/documents/route.js');
const { POST: authPost, GET: authGet } = await import('../app/api/auth/route.js');
const { GET: contradictionsGet } = await import('../app/api/contradictions/route.js');
const { POST: pdfPost } = await import('../app/api/documents/pdf/route.js');
const recheckRoute = await import('../app/api/documents/[id]/recheck/route.js');
const assessRoute = await import('../app/api/documents/[id]/assess/route.js');
const autoRoute = await import('../app/api/documents/[id]/auto/route.js');
const claimVerifyRoute = await import('../app/api/documents/[id]/claims/[claimId]/verify/route.js');
const challengeRoute = await import('../app/api/documents/[id]/claims/[claimId]/challenge/route.js');
const { createDocument, getDocument, listDocuments, recheckDocument, whenAutoVerificationDone } = await import('../lib/documents.mjs');
const { metaSearch } = await import('../lib/search.mjs');

const jsonReq = (url, body, headers = {}) => new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('integration: verify route rejects empty and oversized claims', async () => {
  const empty = await verifyPost(jsonReq('http://t/api/verify', { claim: '  ' }));
  assert.equal(empty.status, 400);
  const long = await verifyPost(jsonReq('http://t/api/verify', { claim: 'x'.repeat(2001) }));
  assert.equal(long.status, 413);
});

test('integration: verify route rejects non-string claims and measures length after trimming', async () => {
  const numeric = await verifyPost(jsonReq('http://t/api/verify', { claim: 123 }));
  assert.equal(numeric.status, 400);
  const object = await verifyPost(jsonReq('http://t/api/verify', { claim: { text: 'x' } }));
  assert.equal(object.status, 400);
  const padded = await verifyPost(jsonReq('http://t/api/verify', { claim: `  ${'Water boils at 100 degrees Celsius at sea level.'}${' '.repeat(2100)}` }));
  assert.equal(padded.status, 200, 'padding around a short claim is not part of the claim');
});

test('integration: documents route rejects a paste that is only page separators', async () => {
  const before = (await (await docsGet(new Request('http://t/api/documents'))).json()).documents.length;
  const res = await docsPost(jsonReq('http://t/api/documents', { title: 'Separators only', text: '--- page ---\n--- page ---' }));
  assert.equal(res.status, 400);
  const after = (await (await docsGet(new Request('http://t/api/documents'))).json()).documents.length;
  assert.equal(after, before, 'no empty document is created');
});

test('integration: verify route returns a demo verdict with citations in demo mode', async () => {
  const res = await verifyPost(jsonReq('http://t/api/verify', { claim: 'Humans only use 10% of their brains.' }));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.mode, 'demo');
  assert.equal(body.verdict, 'Contradicted');
  assert.ok(body.contradicting.length >= 1);
});

test('integration: documents route creates and lists a document without leaking chunks', async () => {
  const res = await docsPost(jsonReq('http://t/api/documents', { title: 'Int Doc', text: 'Water boils at 100 degrees Celsius at sea level in kitchens. Humans only use 10% of their brains each day.' }));
  assert.equal(res.status, 200);
  const { document } = await res.json();
  assert.equal(document.title, 'Int Doc');
  assert.ok(document.chunkCount >= 1);
  assert.equal(document.chunks, undefined);
  const list = await (await docsGet(new Request('http://t/api/documents'))).json();
  assert.ok(list.documents.some((d) => d.title === 'Int Doc'));
});

test('integration: auth route is closed by default and reports accounts disabled', async () => {
  delete process.env.AUTH_ENABLED;
  const res = await authPost(jsonReq('http://t/api/auth', { action: 'register', username: 'zoe', password: 'long-enough' }));
  assert.equal(res.status, 403);
  const me = await (await authGet(new Request('http://t/api/auth'))).json();
  assert.equal(me.authEnabled, false);
  assert.equal(me.user, null);
});

test('integration: auth route registers, logs in, and rejects bad credentials', async () => {
  process.env.AUTH_ENABLED = 'true';
  const bad = await authPost(jsonReq('http://t/api/auth', { action: 'login', username: 'alice', password: 'wrong-password' }));
  assert.equal(bad.status, 401);
  const reg = await authPost(jsonReq('http://t/api/auth', { action: 'register', username: 'alice', password: 'correct-horse' }));
  assert.equal(reg.status, 200);
  const cookie = reg.headers.get('set-cookie');
  assert.match(cookie, /tl_session=/);
  const me = await (await authGet(new Request('http://t/api/auth', { headers: { cookie } }))).json();
  assert.equal(me.user, 'alice');
  const anon = await (await authGet(new Request('http://t/api/auth'))).json();
  assert.equal(anon.user, null);
  delete process.env.AUTH_ENABLED;
});

test('integration: document creation requires sign-in when accounts are on', async () => {
  process.env.AUTH_ENABLED = 'true';
  try {
    const res = await docsPost(jsonReq('http://t/api/documents', { title: 'Anon', text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }));
    assert.equal(res.status, 401);
  } finally {
    delete process.env.AUTH_ENABLED;
  }
});

test('integration: contradiction map surfaces opposing documents as unverified disagreement', async () => {
  await docsPost(jsonReq('http://t/api/documents', { title: 'AI Jobs A', text: 'Artificial intelligence increases employment across the whole economy for many workers today.' }));
  await docsPost(jsonReq('http://t/api/documents', { title: 'AI Jobs B', text: 'Artificial intelligence reduces employment across the whole economy for many workers today.' }));
  const body = await (await contradictionsGet(new Request('http://t/api/contradictions'))).json();
  const entry = body.entries.find((e) => e.topic.includes('employment'));
  assert.ok(entry, JSON.stringify(body.entries));
  assert.equal(entry.positions.length >= 2, true);
  assert.equal(entry.verifiedDisagreement, false);
});

test('integration: document service owner filtering, get and recheck history', async () => {
  const doc = await createDocument({ title: 'Owned', owner: 'carol', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }] });
  assert.equal((await getDocument(doc.id)).title, 'Owned');
  assert.ok((await listDocuments('carol')).some((d) => d.id === doc.id));
  assert.ok(!(await listDocuments('dave')).some((d) => d.id === doc.id));
  const before = doc.claims[0].history.length;
  const rechecked = await recheckDocument(doc.id);
  assert.equal(rechecked.claims[0].history.length, before + 1);
  assert.equal(await recheckDocument('doc-999999'), null);
});

test('integration: pdf route rejects missing and non-PDF uploads, accepts a text-layer PDF', async () => {
  const noFile = await pdfPost(new Request('http://t/api/documents/pdf', { method: 'POST', body: new FormData() }));
  assert.equal(noFile.status, 400);
  const badForm = new FormData();
  badForm.set('file', new File(['not a pdf'], 'x.pdf', { type: 'application/pdf' }));
  const bad = await pdfPost(new Request('http://t/api/documents/pdf', { method: 'POST', body: badForm }));
  assert.equal(bad.status, 400);
  const content = 'BT /F1 12 Tf (Water boils at 100 degrees Celsius at sea level.) Tj ET';
  const pdf = '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n2 0 obj\n<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream\nendobj\ntrailer\n%%EOF\n';
  const goodForm = new FormData();
  goodForm.set('file', new File([Buffer.from(pdf, 'latin1')], 'boil.pdf', { type: 'application/pdf' }));
  const good = await pdfPost(new Request('http://t/api/documents/pdf', { method: 'POST', body: goodForm }));
  assert.equal(good.status, 200);
  const { document } = await good.json();
  assert.ok(document.claims.some((c) => /boils/i.test(c.text)));
});

test('sad: documents route rejects empty and oversized text', async () => {
  assert.equal((await docsPost(jsonReq('http://t/api/documents', { text: '   ' }))).status, 400);
  assert.equal((await docsPost(jsonReq('http://t/api/documents', { text: 'x'.repeat(200001) }))).status, 413);
  assert.equal((await docsPost(new Request('http://t/api/documents', { method: 'POST', body: 'not json' }))).status, 400);
});

test('sad: auth route rejects unknown actions, weak passwords and duplicates; logout clears the session', async () => {
  process.env.AUTH_ENABLED = 'true';
  assert.equal((await authPost(jsonReq('http://t/api/auth', { action: 'dance', username: 'bob', password: 'long-enough' }))).status, 400);
  assert.equal((await authPost(jsonReq('http://t/api/auth', { action: 'register', username: 'bob', password: 'short' }))).status, 400);
  assert.equal((await authPost(jsonReq('http://t/api/auth', { action: 'register', username: 'b b', password: 'long-enough' }))).status, 400);
  assert.equal((await authPost(jsonReq('http://t/api/auth', { action: 'register', username: 'bob', password: 'long-enough' }))).status, 200);
  assert.equal((await authPost(jsonReq('http://t/api/auth', { action: 'register', username: 'bob', password: 'long-enough' }))).status, 400);
  const out = await authPost(jsonReq('http://t/api/auth', { action: 'logout' }));
  assert.equal(out.status, 200);
  assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
  delete process.env.AUTH_ENABLED;
});

test('sad+happy: recheck route 404s unknown documents and rechecks known ones', async () => {
  assert.equal((await recheckRoute.POST(new Request('http://t/x', { method: 'POST' }), { params: { id: 'doc-999999' } })).status, 404);
  const doc = await createDocument({ title: 'Recheck Route', owner: 'demo', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }] });
  await whenAutoVerificationDone(doc.id);
  const res = await recheckRoute.POST(new Request('http://t/x', { method: 'POST' }), { params: { id: doc.id } });
  assert.equal(res.status, 200);
  const { document } = await res.json();
  assert.equal(document.claims[0].history.length, 2);
  assert.equal(document.chunks, undefined);
});

test('happy: pdf route OCRs a scanned PDF when sidecar and vision are available', async () => {
  const savedFetch = globalThis.fetch;
  const saved = { f: process.env.FAISS_SERVICE_URL, u: process.env.META_MODEL_API_URL, k: process.env.META_MODEL_API_KEY };
  process.env.FAISS_SERVICE_URL = 'http://sidecar.test';
  process.env.META_MODEL_API_URL = 'https://example.invalid/chat/completions';
  process.env.META_MODEL_API_KEY = 'test-key';
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/render')) return { ok: true, status: 200, json: async () => ({ pages: [{ page: 1, imageBase64: 'AAA' }] }) };
    if (u.endsWith('/responses')) return { ok: true, status: 200, json: async () => ({ output: [] }) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'Humans only use 10% of their brains each day, waiting to be unlocked.' } }] }) };
  };
  try {
    const form = new FormData();
    form.set('file', new File(['%PDF-1.4\ntrailer\n%%EOF\n'], 'scan.pdf', { type: 'application/pdf' }));
    const res = await pdfPost(new Request('http://t/api/documents/pdf', { method: 'POST', body: form }));
    assert.equal(res.status, 200);
    const { document } = await res.json();
    assert.equal(document.ocr, true);
    assert.ok(document.claims.some((c) => /brains/i.test(c.text)));
  } finally {
    globalThis.fetch = savedFetch;
    if (saved.f === undefined) delete process.env.FAISS_SERVICE_URL; else process.env.FAISS_SERVICE_URL = saved.f;
    if (saved.u === undefined) delete process.env.META_MODEL_API_URL; else process.env.META_MODEL_API_URL = saved.u;
    if (saved.k === undefined) delete process.env.META_MODEL_API_KEY; else process.env.META_MODEL_API_KEY = saved.k;
  }
});

test('sad: pdf route rejects oversized files and PDFs with no readable text', async () => {
  const bigForm = new FormData();
  bigForm.set('file', new File(['x'.repeat(15 * 1024 * 1024 + 1)], 'big.pdf', { type: 'application/pdf' }));
  assert.equal((await pdfPost(new Request('http://t/api/documents/pdf', { method: 'POST', body: bigForm }))).status, 413);
  const emptyForm = new FormData();
  emptyForm.set('file', new File(['%PDF-1.4\ntrailer\n%%EOF\n'], 'empty.pdf', { type: 'application/pdf' }));
  const res = await pdfPost(new Request('http://t/api/documents/pdf', { method: 'POST', body: emptyForm }));
  assert.equal(res.status, 422);
});

test('happy: an empty document is stored with zero claims and zero coverage', async () => {
  const doc = await createDocument({ title: 'Empty', owner: 'demo', pages: [] });
  assert.deepEqual(doc.claims, []);
  assert.equal(doc.coverage, 0);
  assert.equal(doc.report.totalClaims, 0);
});

test('integration: metaSearch parses grounded sources through a stubbed transport', async () => {
  const savedFetch = globalThis.fetch;
  const savedEnv = { u: process.env.META_MODEL_API_URL, k: process.env.META_MODEL_API_KEY };
  process.env.META_MODEL_API_URL = 'https://example.invalid/chat/completions';
  process.env.META_MODEL_API_KEY = 'test-key';
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ output: [
      { type: 'web_search_call', action: { query: 'brain myth evidence' }, results: [{ title: 'Brain', url: 'https://nih.gov/brain' }] },
      { type: 'message', content: [{ text: 'See source', annotations: [{ type: 'url_citation', url: 'https://nih.gov/brain', title: 'Brain', start_index: 0, end_index: 3 }] }] },
    ] }),
  });
  try {
    const out = await metaSearch('Humans only use 10% of their brains.');
    assert.deepEqual(out.queries, ['brain myth evidence']);
    assert.equal(out.sources[0].url, 'https://nih.gov/brain');
    assert.equal(out.citations.length, 1);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedEnv.u === undefined) delete process.env.META_MODEL_API_URL; else process.env.META_MODEL_API_URL = savedEnv.u;
    if (savedEnv.k === undefined) delete process.env.META_MODEL_API_KEY; else process.env.META_MODEL_API_KEY = savedEnv.k;
  }
});

const withMetaEnv = async (fn) => {
  const savedFetch = globalThis.fetch;
  const saved = { u: process.env.META_MODEL_API_URL, k: process.env.META_MODEL_API_KEY };
  process.env.META_MODEL_API_URL = 'https://example.invalid/chat/completions';
  process.env.META_MODEL_API_KEY = 'test-key';
  try { return await fn(); } finally {
    globalThis.fetch = savedFetch;
    if (saved.u === undefined) delete process.env.META_MODEL_API_URL; else process.env.META_MODEL_API_URL = saved.u;
    if (saved.k === undefined) delete process.env.META_MODEL_API_KEY; else process.env.META_MODEL_API_KEY = saved.k;
  }
};

test('happy: verify route live path researches, judges and returns a live verdict', async () => {
  await withMetaEnv(async () => {
    globalThis.fetch = async (url, opts) => {
      const u = String(url);
      if (u.endsWith('/responses')) return { ok: true, status: 200, json: async () => ({ output: [{ type: 'web_search_call', action: { query: 'brain evidence' }, results: [{ title: 'A', url: 'https://a.example/brain' }, { title: 'B', url: 'https://b.example/brain' }] }] }) };
      if (u.endsWith('/chat/completions')) {
        const body = JSON.parse(opts.body);
        const isChallenger = body.messages[0].content.includes('Challenger');
        const content = isChallenger ? '{"material":false}' : JSON.stringify({ verdict: 'Supported', citedIds: ['ev-web-1', 'ev-web-2'], stances: { 'ev-web-1': 'supports', 'ev-web-2': 'supports' }, explanation: 'Fetched passages support it.' });
        return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) };
      }
      const passage = u.includes('b.example')
        ? 'Neuroscience mapping of brains shows activity across the whole brain daily; the ten percent myth about brains fails under imaging.'
        : 'Brain scans show activity throughout the brain every day, and the ten percent myth about brains has no basis in mapping.';
      return new Response(`<html><body><p>${passage}</p></body></html>`, { status: 200, headers: { 'content-type': 'text/html' } });
    };
    const res = await verifyPost(jsonReq('http://t/api/verify', { claim: 'Humans only use 10% of their brains.' }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.mode, 'live');
    assert.equal(body.verdict, 'Supported');
    assert.equal(body.supporting.length, 2);
  });
});

test('sad: verify route live failure abstains instead of falling back to canned evidence', async () => {
  await withMetaEnv(async () => {
    globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
    const res = await verifyPost(jsonReq('http://t/api/verify', { claim: 'Pluto is the ninth planet of the solar system.' }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.mode, 'live-failed');
    assert.equal(body.verdict, 'Unverifiable');
    assert.deepEqual(body.supporting, []);
    assert.ok(body.limitations.some((l) => /Live research failed/.test(l)));
  });
});

test('integration: document action routes hide another owner document when accounts are on (TL-023)', async () => {
  process.env.AUTH_ENABLED = 'true';
  try {
    const register = async (username) => {
      const res = await authPost(jsonReq('http://t/api/auth', { action: 'register', username, password: 'correct-horse' }));
      assert.equal(res.status, 200);
      return res.headers.get('set-cookie');
    };
    const aliceCookie = await register('tl023-alice');
    const bobCookie = await register('tl023-bob');
    const doc = await createDocument({ title: 'TL-023 private', owner: 'tl023-alice', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }] });
    await whenAutoVerificationDone(doc.id);
    const claimId = (await getDocument(doc.id)).claims[0]?.id || 'claim-1';
    const asBob = (path, body) => jsonReq(`http://t${path}`, body, { cookie: bobCookie });
    const bobAssess = await assessRoute.POST(asBob('/x', { text: 'Water boils at 100 degrees Celsius at sea level.' }), { params: { id: doc.id } });
    assert.equal(bobAssess.status, 404, 'assess hides another owner document');
    const bobAuto = await autoRoute.POST(asBob('/x', { paused: true }), { params: { id: doc.id } });
    assert.equal(bobAuto.status, 404, 'auto hides another owner document');
    const bobRecheck = await recheckRoute.POST(asBob('/x', {}), { params: { id: doc.id } });
    assert.equal(bobRecheck.status, 404, 'recheck hides another owner document');
    const bobVerify = await claimVerifyRoute.POST(asBob('/x', {}), { params: { id: doc.id, claimId } });
    assert.equal(bobVerify.status, 404, 'claim verify hides another owner document');
    const bobChallenge = await challengeRoute.POST(asBob('/x', { kind: 'prove-wrong' }), { params: { id: doc.id, claimId } });
    assert.equal(bobChallenge.status, 404, 'challenge hides another owner document');
    const aliceRecheck = await recheckRoute.POST(jsonReq('http://t/x', {}, { cookie: aliceCookie }), { params: { id: doc.id } });
    assert.notEqual(aliceRecheck.status, 404, 'owner still reaches their own document');
  } finally {
    delete process.env.AUTH_ENABLED;
  }
});

test('integration: live-configured document creation records live-failed claims instead of canned verdicts', async () => {
  const savedFetch = globalThis.fetch;
  process.env.META_MODEL_API_URL = 'https://example.invalid/chat/completions';
  process.env.META_MODEL_API_KEY = 'test-key';
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  try {
    const doc = await createDocument({ title: 'Live Fail', owner: 'demo', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }] });
    await whenAutoVerificationDone(doc.id);
    const settled = await getDocument(doc.id);
    assert.ok(settled.claims.length >= 1);
    assert.ok(settled.claims.every((c) => c.mode === 'live-failed' && c.verdict === 'Unverifiable'));
  } finally {
    globalThis.fetch = savedFetch;
    delete process.env.META_MODEL_API_URL;
    delete process.env.META_MODEL_API_KEY;
  }
});
