import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Isolated store so this file never touches data/documents.json.
const dir = mkdtempSync(join(tmpdir(), 'tl-errdis-'));
process.env.TRUTHLENS_STORE_FILE = join(dir, 'documents.json');
process.env.TRUTHLENS_USERS_FILE = join(dir, 'users.json');

const { verifyStandalone, recordInvestigation } = await import('../lib/history.mjs');
const { createDocument, assessDocumentClaim, whenAutoVerificationDone } = await import('../lib/documents.mjs');

// Marker for raw backend internals. It must reach server logs only,
// never user-facing verdict output.
const SECRET = 'SECRET-RAW-9f2c7d1e5b';

const savedUrl = process.env.META_MODEL_API_URL;
const savedKey = process.env.META_MODEL_API_KEY;
const realFetch = globalThis.fetch;
const realConsoleError = console.error;

// Error.message is non-enumerable, so JSON.stringify hides it. Read it
// through .message like a log aggregator would.
const loggedText = (logged) => logged.flatMap((args) => args.map((a) => String(a?.message ?? a))).join('\n');

// Force the live path, then fail every live call without touching the
// network: the stubbed fetch throws a marker error carrying SECRET.
function failLive(logged) {
  process.env.META_MODEL_API_URL = 'https://live.example.invalid/v1';
  process.env.META_MODEL_API_KEY = 'test-key';
  globalThis.fetch = async () => { throw new Error(`connection reset ${SECRET}`); };
  console.error = (...args) => { logged.push(args); };
}

function restoreLive() {
  if (savedUrl === undefined) delete process.env.META_MODEL_API_URL; else process.env.META_MODEL_API_URL = savedUrl;
  if (savedKey === undefined) delete process.env.META_MODEL_API_KEY; else process.env.META_MODEL_API_KEY = savedKey;
  globalThis.fetch = realFetch;
  console.error = realConsoleError;
}

test('verifyStandalone hides raw live-failure internals from the reader', async () => {
  const logged = [];
  failLive(logged);
  try {
    const out = await verifyStandalone('Water boils at 100 degrees Celsius at sea level.');
    assert.equal(out.verdict, 'Unverifiable');
    assert.ok(!JSON.stringify(out).includes(SECRET), 'user-facing output must not contain raw error internals');
    assert.deepEqual(out.limitations, ['Live research failed. Retry the claim.']);
    assert.ok(loggedText(logged).includes(SECRET), 'raw detail still goes to the server log');
  } finally {
    restoreLive();
  }
});

test('document verification hides raw live-failure internals from the reader', async () => {
  const doc = await createDocument({
    title: 'Leak excerpt', owner: 'leak-test',
    pages: [{ page: 1, text: 'Honey never spoils in sealed jars kept cool and dry for years.' }],
  });
  await whenAutoVerificationDone(doc.id);
  const logged = [];
  failLive(logged);
  try {
    const { claim } = await assessDocumentClaim(
      doc.id,
      'Honey never spoils in sealed jars kept cool and dry.',
      { stance: async () => ({ stance: 'unknown', reason: 'stubbed stance' }) },
    );
    assert.equal(claim.verdict, 'Unverifiable');
    assert.ok(!JSON.stringify({ limitations: claim.limitations, explanation: claim.explanation }).includes(SECRET), 'user-facing output must not contain raw error internals');
    assert.deepEqual(claim.limitations, ['Live research failed. Retry the claim.']);
    assert.ok(loggedText(logged).includes(SECRET), 'raw detail still goes to the server log');
  } finally {
    restoreLive();
  }
});

test('author-stance fallback hides raw live-failure internals from the reader', async () => {
  const doc = await createDocument({
    title: 'Stance excerpt', owner: 'leak-stance-test',
    pages: [{ page: 1, text: 'Oats keep a person full for hours after a morning bowl with milk.' }],
  });
  await whenAutoVerificationDone(doc.id);
  const logged = [];
  failLive(logged);
  try {
    const text = 'Oats keep a person full for hours after a morning bowl.';
    const { claim } = await assessDocumentClaim(doc.id, text, {
      verify: async () => ({
        text, type: 'Scientific', verdict: 'Supported', judgedBy: 'Muse Spark 1.3',
        supporting: [], contradicting: [], explanation: 'Canned for the stance test.', limitations: [],
      }),
    });
    assert.ok(!JSON.stringify(claim.authorStance).includes(SECRET), 'reader-visible stance reason must not contain raw error internals');
    assert.equal(claim.authorStance.stance, 'unknown');
    assert.ok(loggedText(logged).includes(SECRET), 'raw detail still goes to the server log');
  } finally {
    restoreLive();
  }
});

test('idempotency conflicts still raise instead of recording twice', async () => {
  const verdictFor = (text) => ({
    text, type: 'Scientific', verdict: 'Supported', judgedBy: 'Muse Spark 1.3',
    supporting: [], contradicting: [], explanation: 'Checked.', limitations: [],
  });
  const key = `errdis-${Date.now()}-${Math.random()}`;
  await recordInvestigation({ owner: 'leak-idem', workflow: 'claim', result: verdictFor('Honey never spoils in sealed jars.'), idempotencyKey: key });
  await assert.rejects(
    recordInvestigation({ owner: 'leak-idem', workflow: 'claim', result: verdictFor('A different submission entirely here.'), idempotencyKey: key }),
    (err) => err?.code === 'idempotency-conflict',
    'same key with a different body must still conflict',
  );
});
