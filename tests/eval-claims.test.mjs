import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Live eval set guard: diverse general coverage that grows toward 30 cases,
// every entry well-formed so a live run spends credits only on valid items.
test('claims.json holds a diverse set with valid verdicts and labels', async () => {
  const { VERDICTS } = await import('../lib/config.mjs');
  const claims = JSON.parse(readFileSync('eval/claims.json', 'utf8'));
  assert.ok(claims.length >= 20, `live set should grow toward 30, got ${claims.length}`);
  const labels = new Set(claims.map((c) => c.label));
  for (const need of ['supported', 'contradicted', 'misleading', 'non-factual', 'unverifiable']) {
    assert.ok([...labels].some((l) => l.includes(need)), `missing label family: ${need}`);
  }
  for (const c of claims) {
    assert.ok(c.claim && c.claim.length > 10, `claim text required: ${c.label}`);
    assert.ok(Array.isArray(c.expected) && c.expected.length > 0, `expected required: ${c.label}`);
    for (const v of c.expected) assert.ok(VERDICTS.includes(v), `bad verdict ${v} in ${c.label}`);
  }
});
