import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'tl-batch-abort-'));
process.env.TRUTHLENS_STORE_FILE = join(dir, 'documents.json');
delete process.env.META_MODEL_API_URL;
delete process.env.META_MODEL_API_KEY;

const { verifyClaimBatch, listHistory } = await import('../lib/history.mjs');

const verdictFor = (text, verdict = 'Supported') => ({
  text, type: 'Scientific', verdict, judgedBy: 'Muse Spark 1.3',
  supporting: [], contradicting: [], explanation: 'Checked.', limitations: [],
});

test('aborted batch returns promptly and records nothing for the in-flight claim', async () => {
  const owner = 'reader-batch-abort-inflight';
  const controller = new AbortController();
  const slowMs = 2000;
  setTimeout(() => controller.abort(), 100);
  const start = Date.now();
  const out = await verifyClaimBatch(['Slow inflight reservoir claim stalls far too long here.'], {
    owner,
    signal: controller.signal,
    verifyOne: async (text) => {
      await new Promise((r) => setTimeout(r, slowMs));
      return verdictFor(text, 'Supported');
    },
  });
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 1000, `aborted batch returns without awaiting the slow claim, took ${elapsed}ms`);
  const entries = await listHistory(owner);
  assert.equal(entries.length, 0, `aborted in-flight claim is not recorded, got ${entries.map((e) => e.text)}`);
  assert.ok(Array.isArray(out), 'batch still resolves to a results array');
});
