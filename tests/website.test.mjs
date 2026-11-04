import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchWebsitePages, extractWebsiteTitle, MIN_WEBSITE_CHARS } from '../lib/website.mjs';

// Isolated store: the tests below create documents via dynamic imports and
// must not share data/documents.json with parallel test processes.
const websiteDir = mkdtempSync(join(tmpdir(), 'tl-website-'));
process.env.TRUTHLENS_STORE_FILE = join(websiteDir, 'documents.json');
process.env.TRUTHLENS_USERS_FILE = join(websiteDir, 'users.json');

const ARTICLE = `<html><head><title>Reservoir &amp; Safety Report</title><style>.x{color:red}</style></head>
<body><nav>Home About Sign up for our newsletter</nav><script>track()</script>
<h1>Reservoir findings</h1>
<p>The new reservoir reduced flooding deaths by 60 percent across the whole valley region over five years of records.</p>
<p>Water boils at 100 degrees Celsius at sea level in kitchens everywhere today, the report notes for comparison.</p>
<p>Engineers recorded rainfall and river levels every day during the study period across the valley.</p>
</body></html>`;

test('extractWebsiteTitle reads and decodes the title tag', () => {
  assert.equal(extractWebsiteTitle(ARTICLE), 'Reservoir & Safety Report');
  assert.equal(extractWebsiteTitle('<html><body>no title</body></html>'), null);
});

test('fetchWebsitePages returns one page with readable text, scripts and styles removed', async () => {
  const out = await fetchWebsitePages('https://news.example/reservoir', { fetchText: async () => ARTICLE });
  assert.equal(out.url, 'https://news.example/reservoir');
  assert.equal(out.title, 'Reservoir & Safety Report');
  assert.equal(out.pages.length, 1);
  assert.equal(out.pages[0].page, 1);
  assert.match(out.pages[0].text, /reservoir reduced flooding deaths by 60 percent/i);
  assert.ok(!out.pages[0].text.includes('track()'));
  assert.ok(!out.pages[0].text.includes('color:red'));
  assert.ok(!out.pages[0].text.includes('<p>'));
  assert.ok(!/Home About|Sign up for our newsletter/.test(out.pages[0].text), 'navigation boilerplate must not become document text');
});

test('fetchWebsitePages rejects private and non-http URLs before fetching', async () => {
  let fetched = false;
  const fetchText = async () => { fetched = true; return ARTICLE; };
  await assert.rejects(() => fetchWebsitePages('http://127.0.0.1/secret', { fetchText }), /Blocked private URL/);
  await assert.rejects(() => fetchWebsitePages('file:///etc/passwd', { fetchText }), /Blocked URL/);
  await assert.rejects(() => fetchWebsitePages('not a url', { fetchText }), /Blocked URL/);
  assert.equal(fetched, false);
});

test('fetchWebsitePages accepts a scheme-less address as https', async () => {
  let saw = null;
  const out = await fetchWebsitePages('www.wikipedia.com/drugs', { fetchText: async (u) => { saw = u; return ARTICLE; } });
  assert.equal(out.url, 'https://www.wikipedia.com/drugs');
  assert.equal(saw, 'https://www.wikipedia.com/drugs');
  assert.match(out.pages[0].text, /reservoir reduced flooding deaths/i);
});

test('fetchWebsitePages rejects pages with too little readable text', async () => {
  assert.ok(MIN_WEBSITE_CHARS >= 100);
  await assert.rejects(
    () => fetchWebsitePages('https://app.example/dashboard', { fetchText: async () => '<html><body><div id="root"></div><script>app()</script></body></html>' }),
    /too little readable text/i,
  );
});

test('website text becomes claims through createDocument with kind and sourceUrl kept', async () => {
  const { fetchWebsitePages: fwp } = await import('../lib/website.mjs');
  const { createDocument, whenAutoVerificationDone } = await import('../lib/store.mjs');
  const site = await fwp('https://news.example/reservoir', { fetchText: async () => ARTICLE });
  const doc = await createDocument({ title: site.title, pages: site.pages, kind: 'website', sourceUrl: site.url, owner: 'website-test' });
  await whenAutoVerificationDone(doc.id);
  assert.equal(doc.kind, 'website');
  assert.equal(doc.sourceUrl, 'https://news.example/reservoir');
  assert.ok(doc.claims.some((c) => /reservoir reduced flooding/i.test(c.text)), JSON.stringify(doc.claims));
});

test('website route rejects missing, private and unreadable URLs and creates nothing', async () => {
  const route = await import('../app/api/documents/url/route.js');
  const { listDocuments } = await import('../lib/store.mjs');
  const req = (body) => new Request('http://t/api/documents/url', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const before = (await listDocuments('website-route')).length;
  assert.equal((await route.POST(req({}))).status, 400);
  assert.equal((await route.POST(req({ url: 'http://127.0.0.1/secret' }))).status, 400);
  assert.equal((await route.POST(req({ url: 'https://app.example/shell' }))).status, 422);
  assert.equal((await listDocuments('website-route')).length, before);
});

test('a reader can ask about claims on a website and get page passages with the source kept', async () => {
  const { createDocument, whenAutoVerificationDone, assessDocumentClaim } = await import('../lib/store.mjs');
  const site = await fetchWebsitePages('https://news.example/reservoir', { fetchText: async () => ARTICLE });
  const doc = await createDocument({ title: site.title, pages: site.pages, kind: 'website', sourceUrl: site.url, owner: 'website-ask' });
  await whenAutoVerificationDone(doc.id);
  const stance = async () => ({ stance: 'supports', reason: 'The page states the reduction directly.' });
  const out = await assessDocumentClaim(doc.id, 'The reservoir reduced flooding deaths by 60 percent.', { stance });
  assert.ok(out, 'assess must work for website documents');
  assert.equal(out.claim.source, 'reader-submitted');
  assert.ok(out.claim.verdict);
  assert.ok(out.claim.excerptPassages.length >= 1, JSON.stringify(out.claim.excerptPassages));
  assert.match(out.claim.excerptPassages.map((p) => p.passage).join(' '), /reservoir/i);
  assert.equal(out.claim.sourceUrl, 'https://news.example/reservoir');
  assert.equal(out.claim.excerptPassages[0].url, 'https://news.example/reservoir');
});

test('asking about a website claim still answers when the live stance call fails', async () => {
  const { createDocument, whenAutoVerificationDone, assessDocumentClaim } = await import('../lib/store.mjs');
  const site = await fetchWebsitePages('https://news.example/reservoir', { fetchText: async () => ARTICLE });
  const doc = await createDocument({ title: site.title, pages: site.pages, kind: 'website', sourceUrl: site.url, owner: 'website-ask-fail' });
  await whenAutoVerificationDone(doc.id);
  const saved = { u: process.env.META_MODEL_API_URL, k: process.env.META_MODEL_API_KEY };
  process.env.META_MODEL_API_URL = 'https://example.invalid/chat';
  process.env.META_MODEL_API_KEY = 'k';
  try {
    const out = await assessDocumentClaim(doc.id, 'The reservoir reduced flooding deaths by 60 percent.');
    assert.ok(out, 'assess must not throw when the live stance call fails');
    assert.equal(out.claim.authorStance.stance, 'unknown');
    assert.match(out.claim.authorStance.reason, /stance/i);
    assert.equal(out.claim.excerptPassages[0].url, 'https://news.example/reservoir');
    assert.ok(out.claim.verdict, 'a verdict (or an honest Unverifiable) must still be recorded');
  } finally {
    if (saved.u === undefined) delete process.env.META_MODEL_API_URL; else process.env.META_MODEL_API_URL = saved.u;
    if (saved.k === undefined) delete process.env.META_MODEL_API_KEY; else process.env.META_MODEL_API_KEY = saved.k;
  }
});

test('excerpts keep kind excerpt by default', async () => {
  const { createDocument } = await import('../lib/store.mjs');
  const doc = await createDocument({ title: 'Plain Excerpt', owner: 'website-test', pages: [{ page: 1, text: 'Water boils at 100 degrees Celsius at sea level in kitchens everywhere today.' }] });
  assert.equal(doc.kind, 'excerpt');
  assert.equal(doc.sourceUrl, undefined);
});
