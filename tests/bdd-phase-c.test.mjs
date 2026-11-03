import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'tl-bdd-c-'));
process.env.TRUTHLENS_STORE_FILE = join(dir, 'documents.json');
process.env.TRUTHLENS_USERS_FILE = join(dir, 'users.json');
process.env.AUTH_SECRET ||= 'test-secret-for-bdd-suite';
delete process.env.META_MODEL_API_URL;
delete process.env.META_MODEL_API_KEY;
delete process.env.AUTH_ENABLED;

const { givenWhenThen, jsonReq } = await import('./bdd-helper.mjs');

test('BDD website ingest: missing and unreachable addresses fail with guidance, never an empty document', async () => {
  const { POST: urlPost } = await import('../app/api/documents/url/route.js');
  const { GET: docsGet } = await import('../app/api/documents/route.js');
  await givenWhenThen(
    'a reader pasting a bad website address',
    'the reader loads the page for checking',
    'a 400/422 explanation and no document',
    async () => {
      const count = async () => (await (await docsGet(new Request('http://t/api/documents'))).json()).documents.length;
      const before = await count();
      assert.equal((await urlPost(jsonReq('http://t/api/documents/url', { url: '   ' }))).status, 400);
      const unreachable = await urlPost(jsonReq('http://t/api/documents/url', { url: 'http://unreachable.invalid/page' }));
      assert.ok([400, 422].includes(unreachable.status), `got ${unreachable.status}`);
      assert.equal(await count(), before, 'failed page loads create no document');
    },
  );
});

test('BDD ask-a-theory: empty and oversized theories are rejected; a real question returns a judged claim', async () => {
  const { createDocument } = await import('../lib/documents.mjs');
  const assessRoute = await import('../app/api/documents/[id]/assess/route.js');
  await givenWhenThen(
    'a reader questioning a book with their own theory',
    'the reader submits the theory',
    'validation for bad input and a judged claim for good input',
    async () => {
      const doc = await createDocument({ title: 'BDD Theory', owner: 'demo', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens around the world.' }] });
      const empty = await assessRoute.POST(jsonReq('http://t/x', { text: '   ' }), { params: { id: doc.id } });
      assert.equal(empty.status, 400);
      const big = await assessRoute.POST(jsonReq('http://t/x', { text: 'x'.repeat(2001) }), { params: { id: doc.id } });
      assert.equal(big.status, 413);
      const missing = await assessRoute.POST(jsonReq('http://t/x', { text: 'Was the dam built for votes?' }), { params: { id: 'doc-999999' } });
      assert.equal(missing.status, 404);
      const good = await assessRoute.POST(jsonReq('http://t/x', { text: 'Was the dam built for votes, not safety?' }), { params: { id: doc.id } });
      assert.equal(good.status, 200);
      const body = await good.json();
      assert.ok(body.claim?.text);
      assert.ok(body.claim?.verdict, 'a submitted theory comes back judged');
    },
  );
});

test('BDD recheck: a new evidence run appends to claim history', async () => {
  const { createDocument, whenAutoVerificationDone } = await import('../lib/documents.mjs');
  const recheckRoute = await import('../app/api/documents/[id]/recheck/route.js');
  await givenWhenThen(
    'a document with settled claims',
    'the reader checks again with new evidence',
    'claim history grows by one run',
    async () => {
      assert.equal((await recheckRoute.POST(new Request('http://t/x', { method: 'POST' }), { params: { id: 'doc-999999' } })).status, 404);
      const doc = await createDocument({ title: 'BDD Recheck', owner: 'demo', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens around the world.' }] });
      await whenAutoVerificationDone(doc.id);
      const { getDocument } = await import('../lib/documents.mjs');
      const before = (await getDocument(doc.id)).claims[0].history.length;
      const res = await recheckRoute.POST(new Request('http://t/x', { method: 'POST' }), { params: { id: doc.id } });
      assert.equal(res.status, 200);
      const after = (await res.json()).document.claims[0].history.length;
      assert.equal(after, before + 1);
    },
  );
});

test('BDD delete: removing a document takes it out of the library', async () => {
  const { createDocument } = await import('../lib/documents.mjs');
  const docRoute = await import('../app/api/documents/[id]/route.js');
  const { GET: docsGet } = await import('../app/api/documents/route.js');
  await givenWhenThen(
    'a reader removing a file from the library',
    'the reader confirms removal',
    'the document is gone from reads and lists',
    async () => {
      const doc = await createDocument({ title: 'BDD Doomed', owner: 'demo', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }] });
      assert.equal((await docRoute.DELETE(new Request('http://t/x', { method: 'DELETE' }), { params: { id: doc.id } })).status, 200);
      assert.equal((await docRoute.GET(new Request('http://t/x'), { params: { id: doc.id } })).status, 404);
      const list = (await (await docsGet(new Request('http://t/api/documents'))).json()).documents;
      assert.ok(!list.some((d) => d.id === doc.id));
      assert.equal((await docRoute.DELETE(new Request('http://t/x', { method: 'DELETE' }), { params: { id: 'doc-999999' } })).status, 404);
    },
  );
});

test('BDD history filters: verdict and text narrow past checks', async () => {
  const { GET: historyGet } = await import('../app/api/history/route.js');
  const { POST: verifyPost } = await import('../app/api/verify/route.js');
  await givenWhenThen(
    'a history with mixed past checks',
    'the reader filters by verdict and text',
    'only matching entries come back',
    async () => {
      await verifyPost(jsonReq('http://t/api/verify', { claim: 'Humans only use 10% of their brains.' }));
      const all = await (await historyGet(new Request('http://t/api/history'))).json();
      assert.ok(all.entries.length >= 1);
      const filtered = await (await historyGet(new Request('http://t/api/history?verdict=Contradicted'))).json();
      assert.ok(filtered.entries.every((e) => e.claim?.verdict === 'Contradicted' || e.verdict === 'Contradicted'));
      const queried = await (await historyGet(new Request('http://t/api/history?q=zzzz-no-such-claim'))).json();
      assert.equal(queried.entries.length, 0);
    },
  );
});

test('BDD accounts: when enabled, registration gates documents per owner', async () => {
  const { POST: authPost } = await import('../app/api/auth/route.js');
  const { POST: docsPost } = await import('../app/api/documents/route.js');
  await givenWhenThen(
    'a deployment with accounts switched on',
    'two readers register and add books',
    'each library shows only its own books',
    async () => {
      process.env.AUTH_ENABLED = 'true';
      try {
        const reg = await authPost(jsonReq('http://t/api/auth', { action: 'register', username: 'readerone', password: 'correct-horse' }));
        assert.equal(reg.status, 200);
        const cookie = reg.headers.get('set-cookie');
        assert.match(cookie, /tl_session=/);
        const anon = await docsPost(jsonReq('http://t/api/documents', { title: 'Anon', text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }));
        assert.equal(anon.status, 401);
        const mine = await docsPost(jsonReq('http://t/api/documents', { title: 'Mine', text: 'Water boils at 100 degrees Celsius at sea level in kitchens.' }, { cookie }));
        assert.equal(mine.status, 200);
      } finally {
        delete process.env.AUTH_ENABLED;
      }
    },
  );
});
