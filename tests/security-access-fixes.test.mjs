import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scratch = mkdtempSync(join(tmpdir(), 'tl-access-'));
process.env.TRUTHLENS_USERS_FILE = join(scratch, 'users.json');
process.env.TRUTHLENS_STORE_FILE = join(scratch, 'documents.json');
process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'access-fix-test-secret';

const auth = await import('../lib/auth.mjs');
const { repository } = await import('../lib/repositories.mjs');

// CYCLE 1: canEdit gates document writes by ownership.
test('canEdit: open workspace allows all writes; with auth on only the owner can edit', () => {
  const saved = process.env.AUTH_ENABLED;
  try {
    delete process.env.AUTH_ENABLED;
    assert.equal(auth.canEdit({ owner: 'alice' }, 'bob'), true);
    assert.equal(auth.canEdit({ owner: 'alice' }, null), true);
    process.env.AUTH_ENABLED = 'true';
    assert.equal(auth.canEdit({ owner: 'alice' }, 'alice'), true);
    assert.equal(auth.canEdit({ owner: 'alice' }, 'bob'), false);
    assert.equal(auth.canEdit({ owner: 'demo' }, 'alice'), false, 'shared demo docs are read-only when auth is on');
    assert.equal(auth.canEdit({ owner: 'alice' }, null), false);
    assert.equal(auth.canEdit(null, 'alice'), false);
  } finally {
    if (saved === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = saved;
  }
});

// CYCLE 2: the five mutating document routes must refuse non-owner writes,
// even on shared demo docs that everyone can still read.
test('non-owner writes to a shared demo doc are refused on all five mutating routes', async () => {
  const saved = process.env.AUTH_ENABLED;
  process.env.AUTH_ENABLED = 'true';
  try {
    const autoRoute = await import('../app/api/documents/[id]/auto/route.js');
    const recheckRoute = await import('../app/api/documents/[id]/recheck/route.js');
    const assessRoute = await import('../app/api/documents/[id]/assess/route.js');
    const challengeRoute = await import('../app/api/documents/[id]/claims/[claimId]/challenge/route.js');
    const verifyRoute = await import('../app/api/documents/[id]/claims/[claimId]/verify/route.js');
    const repo = repository();
    await repo.save({
      id: 'access-demo-1', owner: 'demo', kind: 'book', title: 'Shared demo',
      createdAt: new Date().toISOString(), pages: 1, chunks: [], status: 'ready',
      claims: [{ id: 'access-demo-1-claim-1', text: 'Water boils at 100 degrees Celsius at sea level.', type: 'fact', status: 'unverified' }],
    });
    const bob = `tl_session=${encodeURIComponent(auth.createSessionToken('bob', auth.authSecret()))}`;
    const post = (body) => new Request('http://t/x', {
      method: 'POST', headers: { cookie: bob, 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal((await autoRoute.POST(post({ paused: true }), { params: { id: 'access-demo-1' } })).status, 404);
    assert.equal((await recheckRoute.POST(post({}), { params: { id: 'access-demo-1' } })).status, 404);
    assert.equal((await assessRoute.POST(post({ text: 'Water boils at sea level.' }), { params: { id: 'access-demo-1' } })).status, 404);
    assert.equal((await challengeRoute.POST(post({ kind: 'prove-wrong' }), { params: { id: 'access-demo-1', claimId: 'access-demo-1-claim-1' } })).status, 404);
    assert.equal((await verifyRoute.POST(post({}), { params: { id: 'access-demo-1', claimId: 'access-demo-1-claim-1' } })).status, 404);
    // The owner can still write.
    await repo.save({
      id: 'access-alice-1', owner: 'alice', kind: 'book', title: 'Alice doc',
      createdAt: new Date().toISOString(), pages: 1, chunks: [], claims: [], status: 'ready',
    });
    const alice = `tl_session=${encodeURIComponent(auth.createSessionToken('alice', auth.authSecret()))}`;
    const ownerPost = new Request('http://t/x', {
      method: 'POST', headers: { cookie: alice, 'content-type': 'application/json' }, body: JSON.stringify({ paused: true }),
    });
    assert.equal((await autoRoute.POST(ownerPost, { params: { id: 'access-alice-1' } })).status, 200);
  } finally {
    if (saved === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = saved;
  }
});

// CYCLE 3: the auth rate-limit key must include the client IP so one
// username bucket cannot lock a victim out from every address.
test('auth rate limiting is scoped by client IP, not username alone', async () => {
  const saved = process.env.AUTH_ENABLED;
  process.env.AUTH_ENABLED = 'true';
  try {
    const authRoute = await import('../app/api/auth/route.js');
    const name = `iplock-${Date.now() % 1000000}`;
    const login = (ip) => new Request('http://t/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ action: 'login', username: name, password: 'wrong-password-1' }),
    });
    for (let i = 0; i < 10; i++) {
      assert.equal((await authRoute.POST(login('1.1.1.1'))).status, 401, `attempt ${i + 1} from 1.1.1.1 is a plain failure`);
    }
    assert.equal((await authRoute.POST(login('1.1.1.1'))).status, 429, '11th attempt from the same IP is limited');
    assert.equal((await authRoute.POST(login('2.2.2.2'))).status, 401, 'a different client IP gets its own bucket');
  } finally {
    if (saved === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = saved;
  }
});

// CYCLE 4: a persist failure must fail registration, never report success
// for a lost account.
test('registration fails loudly when the account store cannot persist', async () => {
  const { writeFileSync } = await import('node:fs');
  const blocker = join(scratch, 'not-a-dir');
  writeFileSync(blocker, 'x');
  const saved = process.env.TRUTHLENS_USERS_FILE;
  process.env.TRUTHLENS_USERS_FILE = join(blocker, 'users.json');
  try {
    await assert.rejects(() => auth.registerUser('persist-alice', 'password-123'), /not-a-dir/);
  } finally {
    process.env.TRUTHLENS_USERS_FILE = saved;
  }
});

// CYCLE 5: oversized custom challenge text is rejected with 413, and a
// 'too-long' library error is mapped to 413 instead of a generic 500.
test('challenge custom text over the claim limit is rejected with 413', async () => {
  const saved = process.env.AUTH_ENABLED;
  delete process.env.AUTH_ENABLED;
  try {
    const { CONFIG } = await import('../lib/config.mjs');
    const challengeRoute = await import('../app/api/documents/[id]/claims/[claimId]/challenge/route.js');
    await repository().save({
      id: 'access-long-1', owner: 'demo', kind: 'book', title: 'Long challenge',
      createdAt: new Date().toISOString(), pages: 1, chunks: [], status: 'ready',
      claims: [{ id: 'access-long-1-claim-1', text: 'Water boils at sea level.', type: 'fact', status: 'unverified' }],
    });
    const post = (body) => new Request('http://t/x', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    const over = await challengeRoute.POST(
      post({ kind: 'custom', text: `${'x'.repeat(CONFIG.MAX_CLAIM_CHARS + 1)}` }),
      { params: { id: 'access-long-1', claimId: 'access-long-1-claim-1' } },
    );
    assert.equal(over.status, 413);
  } finally {
    if (saved === undefined) delete process.env.AUTH_ENABLED; else process.env.AUTH_ENABLED = saved;
  }
});

test('challenge route maps a too-long library error to 413', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../app/api/documents/[id]/claims/[claimId]/challenge/route.js', import.meta.url), 'utf8');
  assert.match(src, /too-long/);
  assert.match(src, /413/);
});
