import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractClaimsFromText } from '../lib/claims.mjs';

const allowAll = async (arr) => arr.map(() => ({ action: 'allow' }));
const texts = async (list) => (await extractClaimsFromText(list.join(' '), { screenTexts: allowAll })).map((c) => c.text);

test('website boilerplate and vague one-liners never become claims', async () => {
  const junk = [
    'Click here.',
    'Welcome to our site.',
    'Learn more about us today!',
    'Subscribe to our newsletter for updates.',
    'Copyright 2024 All rights reserved.',
    'Borders are nice.',
    'This view is beautiful.',
    'Home About Contact.',
  ];
  const out = await texts(junk);
  for (const j of junk) {
    assert.ok(!out.some((t) => t.includes(j.replace(/\.$/, ''))), `junk leaked through: ${j} -> ${JSON.stringify(out)}`);
  }
});

test('website text keeps block breaks so headings cannot fuse into one claim', async () => {
  const { fetchWebsitePages } = await import('../lib/website.mjs');
  const html = '<html><head><title>Test Page</title></head><body><h1>Welcome to our site</h1><p>Read more</p><p>The new reservoir reduced flooding deaths by 60 percent across the whole valley region over five years of records and daily river measurements.</p><p>Engineers recorded rainfall and river levels every day during the study period across the valley for comparison.</p></body></html>';
  const site = await fetchWebsitePages('https://news.example/fused', { fetchText: async () => html });
  assert.ok(site.pages[0].text.includes('\n'), `blocks fused: ${JSON.stringify(site.pages[0].text)}`);
  const claims = await extractClaimsFromText(site.pages[0].text, { screenTexts: allowAll });
  assert.ok(!claims.some((c) => /Welcome/.test(c.text) && /reservoir/i.test(c.text)), `fused claim: ${JSON.stringify(claims.map((c) => c.text))}`);
  assert.ok(claims.some((c) => /reservoir reduced flooding deaths by 60 percent/i.test(c.text)), JSON.stringify(claims.map((c) => c.text)));
});

test('short factual claims still survive the junk filter', async () => {
  const out = await texts(['Earth is round.', 'Water is wet.', 'The reservoir reduced flooding deaths by 60 percent.']);
  assert.ok(out.some((t) => /Earth is round/.test(t)), JSON.stringify(out));
  assert.ok(out.some((t) => /Water is wet/.test(t)), JSON.stringify(out));
  assert.ok(out.some((t) => /reservoir reduced flooding deaths by 60 percent/.test(t)), JSON.stringify(out));
});
