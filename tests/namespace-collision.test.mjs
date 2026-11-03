import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backendForClaim } from '../lib/rank.mjs';

// Regression test: the FAISS sidecar namespace must derive from the FULL
// claim text, not just its first 12 bytes. These two claims share the
// prefix "The vaccine " (hex 7468652076616363696e6520) and collided under
// the old scheme, so concurrent ranks overwrote each other's evidence.
test('backendForClaim gives different sidecar namespaces to claims sharing a 12-char prefix', async () => {
  const savedFetch = globalThis.fetch;
  const namespaces = [];
  globalThis.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (String(url).endsWith('/faiss/add')) namespaces.push(body.namespace);
    return { ok: true, status: 200, json: async () => ({ added: 1 }) };
  };
  try {
    const a = backendForClaim('The vaccine reduces infection risk substantially', 'http://sidecar.test');
    const b = backendForClaim('The vaccine reduces hospital stays overall', 'http://sidecar.test');
    await a.reset([]);
    await b.reset([]);
  } finally {
    globalThis.fetch = savedFetch;
  }
  assert.equal(namespaces.length, 2);
  assert.ok(namespaces[0].startsWith('evidence-'), `namespace keeps prefix, got: ${namespaces[0]}`);
  assert.notEqual(namespaces[0], namespaces[1], `same-prefix claims must not share a namespace, both got ${namespaces[0]}`);
});
