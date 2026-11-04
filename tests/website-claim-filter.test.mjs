import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refineWebsiteClaims } from '../lib/claims.mjs';

// Isolated store: creating documents here must not touch data/documents.json.
const filterDir = mkdtempSync(join(tmpdir(), 'tl-claim-filter-'));
process.env.TRUTHLENS_STORE_FILE = join(filterDir, 'documents.json');
process.env.TRUTHLENS_USERS_FILE = join(filterDir, 'users.json');

// Fake cheap LLM: keeps only entries whose text mentions reservoir or boils.
const fakeCompleteJson = async ({ system, user }) => {
  assert.match(system, /claim/i);
  const lines = String(user).split('\n').filter((l) => /^\d+\./.test(l));
  assert.ok(lines.length >= 2, `prompt must carry numbered candidates, got: ${user}`);
  return {
    keep: lines.filter((l) => /reservoir|boils/i.test(l)).map((l) => Number(l.match(/^(\d+)\./)[1])),
  };
};

test('cheap LLM filter keeps real claims and drops chrome', async () => {
  const candidates = [
    { text: 'The new reservoir reduced flooding deaths by 60 percent.', type: 'Statistical' },
    { text: 'Click here to continue reading right now today please.', type: 'Unclassified' },
    { text: 'Water boils at 100 degrees Celsius at sea level.', type: 'Scientific' },
  ];
  const out = await refineWebsiteClaims(candidates, { completeJson: fakeCompleteJson });
  assert.deepEqual(out.map((c) => c.text), [
    'The new reservoir reduced flooding deaths by 60 percent.',
    'Water boils at 100 degrees Celsius at sea level.',
  ]);
});

test('filter fails open when the model call throws', async () => {
  const candidates = [{ text: 'The new reservoir reduced flooding deaths by 60 percent.', type: 'Statistical' }];
  const out = await refineWebsiteClaims(candidates, {
    completeJson: async () => { throw new Error('no network'); },
  });
  assert.deepEqual(out, candidates);
});

test('filter returns input untouched for empty or non-list input', async () => {
  let called = 0;
  const counting = async () => { called++; return { keep: [] }; };
  assert.deepEqual(await refineWebsiteClaims([], { completeJson: counting }), []);
  assert.equal(called, 0);
});

test('website documents run the cheap filter in the pipeline before prioritising', async () => {
  const { createDocument } = await import('../lib/store.mjs');
  let seen = null;
  const doc = await createDocument(
    {
      title: 'Filter wiring',
      pages: [{ page: 1, text: 'The new reservoir reduced flooding deaths by 60 percent across the whole valley region over five years of records and daily river measurements. Engineers recorded rainfall and river levels every day during the study period across the valley for comparison.' }],
      kind: 'website',
      sourceUrl: 'https://news.example/filter',
      owner: 'filter-wiring',
    },
    {
      refineClaims: async (list) => {
        seen = list.map((c) => c.text);
        return list.slice(0, 1);
      },
    },
  );
  assert.ok(seen && seen.length >= 1, `filter saw no candidates: ${JSON.stringify(seen)}`);
  assert.equal(doc.claims.length, 1, JSON.stringify(doc.claims.map((c) => c.text)));
  assert.equal(doc.claims[0].text, seen[0]);
});

test('excerpt documents skip the cheap filter', async () => {
  const { createDocument } = await import('../lib/store.mjs');
  let called = 0;
  const doc = await createDocument(
    {
      title: 'No filter here',
      pages: [{ page: 1, text: 'The new reservoir reduced flooding deaths by 60 percent across the whole valley region over five years of records and daily river measurements.' }],
      kind: 'excerpt',
      owner: 'filter-wiring',
    },
    { refineClaims: async (_list) => { called++; return []; } },
  );
  assert.equal(called, 0, 'excerpt path must not call the website filter');
  assert.ok(doc.claims.length >= 1, JSON.stringify(doc.claims));
});
