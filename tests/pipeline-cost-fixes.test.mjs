import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'tl-costfixes-'));
process.env.TRUTHLENS_STORE_FILE = join(dir, 'documents.json');

// Bug 1: SSRF DNS-rebinding — resolve once and pin.
test('fetchPageText pins DNS and fetches the IP literal with Host and SNI', async () => {
  const { fetchPageText } = await import('../lib/fetch.mjs');
  const seen = {};
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const getDispatcher = ({ servername }) => {
    seen.servername = servername;
    return { __dispatcherFor: servername };
  };
  const fetchImpl = async (url, init) => {
    seen.url = String(url);
    seen.init = init;
    return {
      status: 200, ok: true,
      headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? 'text/html' : null) },
      text: async () => '<html><body><p>Pinned fetch body.</p></body></html>',
    };
  };
  const out = await fetchPageText('https://example.com/article', { lookup, fetchImpl, getDispatcher });
  assert.match(out, /Pinned fetch/);
  assert.match(seen.url, /93\.184\.216\.34/, `must fetch IP literal, got ${seen.url}`);
  assert.ok(!seen.url.includes('example.com'), `must not fetch hostname, got ${seen.url}`);
  assert.equal(seen.init.headers.host, 'example.com');
  assert.equal(seen.servername, 'example.com');
  assert.ok(seen.init.dispatcher, 'dispatcher with SNI servername is passed to fetch');
});

test('fetchPageText blocks a hostname that resolves to a private address without fetching', async () => {
  const { fetchPageText } = await import('../lib/fetch.mjs');
  let fetched = false;
  await assert.rejects(
    () => fetchPageText('https://example.com/private', {
      lookup: async () => [{ address: '127.0.0.1', family: 4 }],
      fetchImpl: async () => { fetched = true; throw new Error('must not fetch'); },
    }),
    /private/i,
  );
  assert.equal(fetched, false);
});

// Bug 2: compound-claim fan-out cap.
test('verifyResearchedClaim caps atomic investigations and marks overflow Unverifiable', async () => {
  const { verifyResearchedClaim, MAX_ATOMIC_INVESTIGATIONS } = await import('../lib/pipeline.mjs');
  assert.equal(MAX_ATOMIC_INVESTIGATIONS, 8);
  const atoms = Array.from({ length: 12 }, (_, i) => `Brain myth number ${i} says humans use ten percent of brains`);
  const compound = atoms.join('; ');
  let searches = 0;
  const search = async () => {
    searches++;
    return { queries: ['q'], sources: [{ title: 'E', url: 'https://a.example/brain' }], citations: [] };
  };
  const fetchText = async () => '<body><p>Brain scans show activity throughout the brain every day, contradicting the ten percent myth about brains and mapping studies.</p></body>';
  const judge = async ({ evidence }) => ({
    verdict: 'Supported', citedIds: evidence.map((e) => e.id),
    stances: Object.fromEntries(evidence.map((e) => [e.id, 'supports'])), explanation: 'Yes.',
  });
  const out = await verifyResearchedClaim(compound, {
    search, fetchText, judge, cache: false, stabilityRuns: 1,
    challenge: null, nli: null,
  });
  assert.equal(searches, 8, `only 8 investigations run, got ${searches}`);
  assert.equal(out.subclaims.length, 12);
  assert.ok(out.subclaims.slice(0, 8).every((s) => s.verdict && s.verdict !== 'Unverifiable'), JSON.stringify(out.subclaims.slice(0, 8)));
  assert.ok(out.subclaims.slice(8).every((s) => s.verdict === 'Unverifiable'), JSON.stringify(out.subclaims.slice(8)));
  assert.ok((out.limitations || []).some((l) => /8|cap|overflow/i.test(l)) || /cap|overflow|exceed/i.test(out.explanation || ''));
});

// Bug 3: abort propagation through batch -> verifyOne and pipeline -> graph.
test('verifyClaimBatch passes an AbortSignal to verifyOne and stops scheduling after abort', async () => {
  const { verifyClaimBatch } = await import('../lib/history.mjs');
  const seenSignals = [];
  const started = [];
  const controller = new AbortController();
  const out = await verifyClaimBatch(
    ['Alpha reservoir levels rose sharply during June.', 'Beta reservoir levels fell sharply during July.', 'Gamma reservoir levels held steady during August.'],
    {
      owner: `reader-abort-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      signal: controller.signal,
      verifyOne: async (text, opts) => {
        started.push(text);
        seenSignals.push(opts?.signal);
        if (started.length === 1) controller.abort();
        await new Promise((r) => setTimeout(r, 20));
        return { text, type: 'Scientific', verdict: 'Supported', judgedBy: 'Muse Spark 1.3', supporting: [], contradicting: [], explanation: 'ok', limitations: [] };
      },
    },
  );
  assert.ok(seenSignals[0] instanceof AbortSignal, 'verifyOne receives an AbortSignal');
  assert.ok(started.length < 3, `no new items scheduled after abort, started ${started.length}`);
  assert.ok(Array.isArray(out));
});

test('verifyResearchedClaim forwards its signal to search and fetch collaborators', async () => {
  const { verifyResearchedClaim } = await import('../lib/pipeline.mjs');
  const controller = new AbortController();
  let searchSignal;
  let fetchSignal;
  const search = async (claim, opts) => {
    searchSignal = opts?.signal;
    return { queries: ['q'], sources: [{ title: 'E', url: 'https://a.example/brain' }], citations: [] };
  };
  const fetchText = async (url, opts) => {
    fetchSignal = opts?.signal;
    return '<body><p>Brain scans show activity throughout the brain every day, contradicting the ten percent myth about brains and mapping studies.</p></body>';
  };
  const judge = async ({ evidence }) => ({
    verdict: 'Supported', citedIds: evidence.map((e) => e.id),
    stances: Object.fromEntries(evidence.map((e) => [e.id, 'supports'])), explanation: 'Yes.',
  });
  await verifyResearchedClaim('Brain myth says humans use ten percent of brains.', {
    search, fetchText, judge, cache: false, stabilityRuns: 1, challenge: null, nli: null, signal: controller.signal,
  });
  assert.ok(searchSignal instanceof AbortSignal, 'search receives the AbortSignal');
  assert.ok(fetchSignal instanceof AbortSignal, 'fetch receives the AbortSignal');
});

test('verifyResearchedClaim with an already-aborted signal runs no search', async () => {
  const { verifyResearchedClaim } = await import('../lib/pipeline.mjs');
  const controller = new AbortController();
  controller.abort(new Error('stop now'));
  let searches = 0;
  await assert.rejects(
    () => verifyResearchedClaim('Brain myth says humans use ten percent of brains.', {
      search: async () => { searches++; return { queries: [], sources: [], citations: [] }; },
      fetchText: async () => '', judge: async () => ({ verdict: 'Supported', citedIds: [] }),
      cache: false, signal: controller.signal,
    }),
    /stop now|abort/i,
  );
  assert.equal(searches, 0);
});

// Bug 6: history has no pagination and unclamped limit.
test('listHistory clamps limit to 1..200 and supports offset', async () => {
  const { recordInvestigation, listHistory } = await import('../lib/history.mjs');
  const owner = `reader-pag-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const verdictFor = (text) => ({ text, type: 'Scientific', verdict: 'Supported', judgedBy: 'Muse Spark 1.3', supporting: [], contradicting: [], explanation: 'ok', limitations: [] });
  for (let i = 1; i <= 5; i++) {
    await recordInvestigation({ owner, workflow: 'claim', result: verdictFor(`Paginated reservoir claim number ${i} stands here.`) });
    await new Promise((r) => setTimeout(r, 2));
  }
  const first2 = await listHistory(owner, { limit: 2 });
  assert.equal(first2.length, 2, 'limit 2 returns 2');
  const next2 = await listHistory(owner, { limit: 2, offset: 2 });
  assert.equal(next2.length, 2, 'offset 2 returns the next page');
  assert.ok(!first2.some((e) => next2.some((n) => n.claimId === e.claimId)), 'pages do not overlap');
  const one = await listHistory(owner, { limit: 0 });
  assert.equal(one.length, 1, 'limit 0 clamps to 1');
  const all = await listHistory(owner, { limit: 500 });
  assert.ok(all.length <= 200 && all.length === 5, `limit 500 clamps but keeps all 5, got ${all.length}`);
});

test('listHistory caps a large store at 200', async () => {
  const { repository } = await import('../lib/repositories.mjs');
  const { listHistory } = await import('../lib/history.mjs');
  const owner = `reader-big-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const repo = repository();
  const docId = `doc-${await repo.nextSeq()}`;
  const at = new Date().toISOString();
  const claims = Array.from({ length: 210 }, (_, i) => ({
    id: `${docId}-claim-${i + 1}`, text: `Large store claim number ${i} with distinct wording ${'x'.repeat(10 + (i % 20))}.`,
    verdict: 'Supported', judgedBy: 'Muse Spark 1.3', supporting: [], contradicting: [], explanation: 'ok', limitations: [],
    status: 'verified', workflow: 'claim', source: 'standalone', history: [{ at, verdict: 'Supported', judgedBy: 'Muse Spark 1.3' }],
  }));
  await repo.save({ id: docId, owner, kind: 'history', title: 'Investigation history', createdAt: at, claims, report: null, coverage: 0 });
  const capped = await listHistory(owner, { limit: 500 });
  assert.equal(capped.length, 200, `large store caps at 200, got ${capped.length}`);
  const def = await listHistory(owner);
  assert.equal(def.length, 100, `default limit 100 preserved, got ${def.length}`);
});

test('getHistoryEntry scans directly without the 1000-entry cap', async () => {
  const { repository } = await import('../lib/repositories.mjs');
  const { getHistoryEntry } = await import('../lib/history.mjs');
  const owner = `reader-direct-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const repo = repository();
  const docId = `doc-${await repo.nextSeq()}`;
  const at = new Date().toISOString();
  const claims = Array.from({ length: 1005 }, (_, i) => ({
    id: `${docId}-claim-${i + 1}`, text: `Direct scan claim number ${i} with unique wording ${'y'.repeat(10 + (i % 20))}.`,
    verdict: 'Supported', judgedBy: 'Muse Spark 1.3', supporting: [], contradicting: [], explanation: 'ok', limitations: [],
    status: 'verified', workflow: 'claim', source: 'standalone', history: [{ at, verdict: 'Supported', judgedBy: 'Muse Spark 1.3' }],
  }));
  await repo.save({ id: docId, owner, kind: 'history', title: 'Investigation history', createdAt: at, claims, report: null, coverage: 0 });
  const oldest = claims[0];
  const folded = await getHistoryEntry(owner, `${docId}-claim-500`);
  assert.ok(folded, 'a middle entry resolves by direct scan');
  const found = await getHistoryEntry(owner, oldest.id);
  assert.ok(found, 'the oldest entry past the old 1000 cap still resolves');
  assert.equal(found.claimId, oldest.id);
});

test('history route passes offset through and keeps default limit 100', async () => {
  const { recordInvestigation } = await import('../lib/history.mjs');
  const { GET } = await import('../app/api/history/route.js');
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  for (let i = 1; i <= 3; i++) {
    await recordInvestigation({
      owner: 'demo', workflow: 'claim',
      result: { text: `Route offset probe ${tag} number ${i} stands here.`, type: 'Scientific', verdict: 'Supported', judgedBy: 'Muse Spark 1.3', supporting: [], contradicting: [], explanation: 'ok', limitations: [] },
    });
    await new Promise((r) => setTimeout(r, 5));
  }
  const first = await (await GET(new Request(`http://x/api/history?query=${encodeURIComponent(tag)}&limit=1&offset=0`))).json();
  const second = await (await GET(new Request(`http://x/api/history?query=${encodeURIComponent(tag)}&limit=1&offset=1`))).json();
  assert.equal(first.entries.length, 1);
  assert.equal(second.entries.length, 1);
  assert.notEqual(second.entries[0].claimId, first.entries[0].claimId, 'offset 1 returns the next entry');
  const def = await (await GET(new Request('http://x/api/history'))).json();
  assert.ok(Array.isArray(def.entries));
  assert.ok(def.entries.length <= 200, 'route respects the 200 cap');
});

// Bug 5: OCR has no page cap.
test('ocrPdfPages throws too-many-pages past the default cap without calling vision', async () => {
  const { ocrPdfPages } = await import('../lib/ocr.mjs');
  const pages = Array.from({ length: 13 }, (_, i) => ({ page: i + 1, imageBase64: `IMG${i}` }));
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ pages }) });
  let visions = 0;
  const vision = async () => { visions++; return 'text'; };
  try {
    await ocrPdfPages(Buffer.from('%PDF-fake'), { sidecarUrl: 'http://sidecar:8100', fetchImpl, vision });
    assert.fail('expected too-many-pages');
  } catch (e) {
    assert.equal(e.code, 'too-many-pages');
    assert.match(e.message, /13|cap|12/i);
  }
  assert.equal(visions, 0, 'no billed vision calls past the cap');
});

test('ocrPdfPages honors an explicit maxPages override', async () => {
  const { ocrPdfPages } = await import('../lib/ocr.mjs');
  const pages = Array.from({ length: 3 }, (_, i) => ({ page: i + 1, imageBase64: `IMG${i}` }));
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ pages }) });
  await assert.rejects(
    () => ocrPdfPages(Buffer.from('%PDF-fake'), { sidecarUrl: 'http://sidecar:8100', fetchImpl, vision: async () => 't', maxPages: 2 }),
    (e) => e.code === 'too-many-pages',
  );
  const ok = await ocrPdfPages(Buffer.from('%PDF-fake'), {
    sidecarUrl: 'http://sidecar:8100', fetchImpl, vision: async () => 'hello', maxPages: 3,
  });
  assert.equal(ok.length, 3);
});

// Bug 4: FileRepository.loadAll serves stale cross-process data without a reload.
test('FileRepository.loadAll reloads from disk so cross-process writes are visible', async () => {
  const { FileRepository } = await import('../lib/repositories.mjs');
  const { mkdtempSync, writeFileSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const file = join(mkdtempSync(join(tmpdir(), 'tl-repo-')), 'documents.json');
  const repo = new FileRepository(file);
  await repo.save({ id: 'doc-1', kind: 'history', owner: 'demo', claims: [] });
  const before = await repo.loadAll();
  assert.ok(before.some((d) => d.id === 'doc-1'));
  const onDisk = JSON.parse(readFileSync(file, 'utf8'));
  onDisk.push({ id: 'doc-2', kind: 'history', owner: 'demo', claims: [] });
  writeFileSync(file, JSON.stringify(onDisk));
  const after = await repo.loadAll();
  assert.ok(after.some((d) => d.id === 'doc-2'), 'externally written doc is visible after loadAll reload');
});

test('fetchPageText re-validates redirects and still blocks hex IP literals', async () => {
  const { fetchPageText, assertPublicUrl } = await import('../lib/fetch.mjs');
  assert.throws(() => assertPublicUrl('http://0x7f.0.0.1/admin'), /blocked|private/i);
  const lookup = async (host) => (host === 'example.com' ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '10.0.0.5', family: 4 }]);
  await assert.rejects(
    () => fetchPageText('https://example.com/start', {
      lookup,
      fetchImpl: async (url) => {
        if (String(url).includes('93.184.216.34')) {
          return { status: 302, ok: false, headers: { get: (k) => (String(k).toLowerCase() === 'location' ? 'https://evil.example/steal' : 'text/html') }, body: { cancel: async () => {} } };
        }
        throw new Error('redirect target must never be fetched');
      },
    }),
    /private|blocked/i,
  );
});

test('pinned fetch serves through a real dispatcher with the original Host header', async () => {
  // Regression: npm undici v8 agents are rejected by Node's built-in
  // fetch ("invalid onRequestStart"), so the pinned path must fetch with
  // the same undici copy that built the dispatcher.
  const { fetchFor } = await import('../lib/fetch.mjs');
  const { Agent } = await import('undici');
  const { default: http } = await import('node:http');
  const seen = {};
  const srv = http.createServer((req, res) => { seen.host = req.headers.host; res.setHeader('content-type', 'text/html'); res.end('<html><body>pinned ok</body></html>'); });
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  const dispatcher = new Agent({ connect: { servername: 'example.com' } });
  try {
    const fetchFn = await fetchFor(dispatcher, fetch);
    assert.notEqual(fetchFn, fetch, 'a real dispatcher selects a pinned transport, not global fetch');
    const res = await fetchFn(`http://127.0.0.1:${srv.address().port}/`, { dispatcher, headers: { host: 'example.com' }, signal: AbortSignal.timeout(10000) });
    assert.equal(res.status, 200);
    assert.equal(seen.host, 'example.com', 'origin host header survives pinning');
    const reader = res.body.getReader();
    const chunks = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
    assert.match(Buffer.concat(chunks).toString(), /pinned ok/, 'adapted body streams through the reader');
  } finally {
    await dispatcher.close().catch(() => {});
    await new Promise((resolve) => srv.close(resolve));
  }
});
