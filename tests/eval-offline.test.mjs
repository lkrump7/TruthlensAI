import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Offline diverse eval: every category must be present so accuracy holds
// for different people and questions, with zero live credits.
const REQUIRED = ['supported', 'contradicted', 'misleading', 'conflicting', 'insufficient', 'non-verifiable', 'time-sensitive', 'failed-api', 'fabricated-citation', 'wrong-page'];

test('offline eval covers all required categories with valid verdicts', async () => {
  const cases = JSON.parse(readFileSync('eval/offline-cases.json', 'utf8'));
  const labels = new Set(cases.map((c) => c.label));
  for (const r of REQUIRED) assert.ok(labels.has(r), `missing category: ${r}`);
  const { VERDICTS } = await import('../lib/config.mjs');
  for (const c of cases) {
    assert.ok(c.claim && c.claim.length > 10, `claim text required: ${c.label}`);
    assert.ok(Array.isArray(c.expected) && c.expected.length > 0, `expected required: ${c.label}`);
    for (const v of c.expected) assert.ok(VERDICTS.includes(v), `bad verdict ${v} in ${c.label}`);
  }
});

test('offline eval scores verdict accuracy and citation validity without network', async () => {
  const { scoreOfflineEval } = await import('../lib/eval-offline.mjs');
  const cases = JSON.parse(readFileSync('eval/offline-cases.json', 'utf8'));
  const out = await scoreOfflineEval(cases);
  assert.ok(out.total >= 15, `need a real set, got ${out.total}`);
  assert.ok(out.accuracy >= 0 && out.accuracy <= 1);
  assert.ok(out.citationRate >= 0 && out.citationRate <= 1);
  assert.ok(out.coverage >= 0);
});
