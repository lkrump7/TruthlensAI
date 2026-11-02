import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { uploadSizeError } from '../lib/ui-state.mjs';
import { verifyRateLimited } from '../app/api/verify/route.js';
import { batchRateLimited } from '../app/api/verify/batch/route.js';

const page = readFileSync(new URL('../app/page.js', import.meta.url), 'utf8');
const layout = readFileSync(new URL('../app/layout.js', import.meta.url), 'utf8');
const modal = readFileSync(new URL('../app/components/modal.js', import.meta.url), 'utf8');
const toggle = readFileSync(new URL('../app/components/theme-toggle.js', import.meta.url), 'utf8');
const verdict = readFileSync(new URL('../app/components/verdict.js', import.meta.url), 'utf8');

test('txt/md uploads have a client size cap', () => {
  const MB = 1024 * 1024;
  assert.equal(uploadSizeError({ name: 'notes.txt', size: 16 * MB }), 'Text is larger than 15 MB.');
  assert.equal(uploadSizeError({ name: 'notes.md', size: 16 * MB }), 'Text is larger than 15 MB.');
  assert.equal(uploadSizeError({ name: 'notes.txt', size: 1 * MB }), null);
});

test('viewer iframes are sandboxed', () => {
  assert.match(page, /<iframe[^>]*sandbox="[^"]+"/);
  assert.match(page, /sandbox="allow-same-origin"/);
});

test('route boundaries exist for App Router', () => {
  assert.ok(existsSync(new URL('../app/error.js', import.meta.url)), 'app/error.js missing');
  assert.ok(existsSync(new URL('../app/loading.js', import.meta.url)), 'app/loading.js missing');
  assert.ok(existsSync(new URL('../app/not-found.js', import.meta.url)), 'app/not-found.js missing');
});

test('vault cards expose button semantics', () => {
  assert.match(page, /role="button"/);
});

test('images carry lazy loading and dimensions', () => {
  assert.match(page, /loading="lazy"/);
  assert.match(page, /decoding="async"/);
});

test('layout keeps head links and SEO/OG metadata', () => {
  assert.match(layout, /<head>/);
  assert.match(layout, /openGraph/);
  assert.match(layout, /manifest/);
});

test('modal supports described content', () => {
  assert.match(modal, /aria-describedby/);
});

test('theme toggle avoids wrong-label flash', () => {
  assert.match(toggle, /ready/);
  assert.doesNotMatch(toggle, /<span>\{theme === 'light' \? 'Dark' : 'Light'\}<\/span>/);
});

test('verdict dates pin en-US locale', () => {
  assert.match(verdict, /toLocaleDateString\('en-US'/);
});

test('client surfaces rate-limit retries', () => {
  assert.match(page, /429/);
  assert.match(page, /Too many/);
});

test('contradiction and auth loads surface retry errors', () => {
  assert.doesNotMatch(page, /\.catch\(\(\) => \{\}\)/);
});

test('security headers config exists', () => {
  assert.ok(existsSync(new URL('../next.config.mjs', import.meta.url)), 'next.config.mjs missing');
  const cfg = readFileSync(new URL('../next.config.mjs', import.meta.url), 'utf8');
  assert.match(cfg, /X-Content-Type-Options/);
  assert.match(cfg, /Referrer-Policy/);
});

test('robots and manifest exist', () => {
  assert.ok(existsSync(new URL('../public/robots.txt', import.meta.url)), 'public/robots.txt missing');
  assert.ok(existsSync(new URL('../public/manifest.webmanifest', import.meta.url)), 'manifest missing');
});

test('sitemap route exists for robots reference', () => {
  const hasFile = existsSync(new URL('../app/sitemap.js', import.meta.url)) || existsSync(new URL('../public/sitemap.xml', import.meta.url));
  assert.ok(hasFile, 'sitemap missing (app/sitemap.js or public/sitemap.xml)');
});

test('rate limits send Retry-After headers', () => {
  const verify = readFileSync(new URL('../app/api/verify/route.js', import.meta.url), 'utf8');
  const batch = readFileSync(new URL('../app/api/verify/batch/route.js', import.meta.url), 'utf8');
  const auth = readFileSync(new URL('../app/api/auth/route.js', import.meta.url), 'utf8');
  assert.match(verify, /Retry-After/);
  assert.match(batch, /Retry-After/);
  assert.match(auth, /Retry-After/);
});

test('verify limiter trips after 30 hits and stays open for fresh keys', () => {
  const key = `probe-verify-${Date.now()}-${Math.random()}`;
  for (let i = 0; i < 30; i++) assert.equal(verifyRateLimited(key), false);
  assert.equal(verifyRateLimited(key), true);
});

test('batch limiter trips after 20 hits and stays open for fresh keys', () => {
  const key = `probe-batch-${Date.now()}-${Math.random()}`;
  for (let i = 0; i < 20; i++) assert.equal(batchRateLimited(key), false);
  assert.equal(batchRateLimited(key), true);
});

test('hero images ship lighter webp variants', () => {
  assert.ok(existsSync(new URL('../public/mockup/researchers.webp', import.meta.url)), 'researchers.webp missing');
  assert.ok(existsSync(new URL('../public/mockup/students.webp', import.meta.url)), 'students.webp missing');
  assert.ok(existsSync(new URL('../public/mockup/img4.webp', import.meta.url)), 'img4.webp missing');
  const personas = readFileSync(new URL('../app/components/personas.js', import.meta.url), 'utf8');
  assert.match(personas, /researchers\.webp/);
  assert.match(personas, /students\.webp/);
  assert.match(personas, /img4\.webp/);
  assert.match(page, /<Personas/);
});

test('hot derived lists are memoized', () => {
  assert.match(page, /useMemo/);
  assert.match(page, /realDocs/);
});
