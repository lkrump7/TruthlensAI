import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expandQueries, metaSearch } from '../lib/search.mjs';

test('expandQueries builds neutral variants: claim, keywords, study angle, criticism angle', () => {
  const qs = expandQueries('The vaccine reduced hospitalisations by 80 percent among elderly residents.');
  assert.equal(qs[0], 'The vaccine reduced hospitalisations by 80 percent among elderly residents.');
  assert.ok(qs.length >= 3 && qs.length <= 4);
  assert.match(qs[1], /vaccin/);
  assert.match(qs[1], /80/);
  assert.doesNotMatch(qs.join(' '), /myth|false|debunk|proven/i, 'no verdict words in any variant');
  assert.ok(qs.some((q) => /trial|study|evidence/i.test(q)), 'a primary-evidence angle exists');
  assert.ok(qs.some((q) => /criticism|limitations/i.test(q)), 'a contradicting angle exists, neutrally worded');
});

test('expandQueries keeps verdict words from the claim itself out of generated variants', () => {
  const qs = expandQueries('The brain myth was debunked by scientists last year.');
  assert.match(qs[0], /myth was debunked/);
  assert.doesNotMatch(qs.slice(1).join(' '), /myth|debunk/i);
});

test('metaSearch sends the expanded variants to Meta search grounding', async () => {
  const saved = { u: process.env.META_MODEL_API_URL, k: process.env.META_MODEL_API_KEY, f: globalThis.fetch };
  process.env.META_MODEL_API_URL = 'https://example.invalid/chat/completions';
  process.env.META_MODEL_API_KEY = 'k';
  let sent;
  globalThis.fetch = async (url, opts) => { sent = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ output: [] }) }; };
  try {
    await metaSearch('The vaccine reduced hospitalisations by 80 percent.');
    assert.match(sent.input, /criticism/i);
    assert.match(sent.input, /The vaccine reduced hospitalisations by 80 percent\./);
  } finally {
    if (saved.u === undefined) delete process.env.META_MODEL_API_URL; else process.env.META_MODEL_API_URL = saved.u;
    if (saved.k === undefined) delete process.env.META_MODEL_API_KEY; else process.env.META_MODEL_API_KEY = saved.k;
    globalThis.fetch = saved.f;
  }
});
