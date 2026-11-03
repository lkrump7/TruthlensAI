import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FileRepository } from '../lib/repositories.mjs';

function freshFile(contents = '[]') {
  const file = join(mkdtempSync(join(tmpdir(), 'tl-durability-')), 'docs.json');
  writeFileSync(file, contents);
  return file;
}

test('loadAll reloads from disk so a second reader sees another writer saves', async () => {
  const file = freshFile();
  const a = new FileRepository(file);
  const b = new FileRepository(file);
  await a.save({ id: 'doc-1', owner: 'demo', title: 'A', claims: [] });
  const seen = await b.loadAll();
  assert.equal(seen.length, 1, 'B must see A\'s save, not a stale in-memory map');
  assert.equal(seen[0].id, 'doc-1');
});

test('nextSeq never issues the same id twice across repository instances', async () => {
  const file = freshFile(JSON.stringify([{ id: 'doc-4', owner: 'demo' }]));
  const p1 = new FileRepository(file);
  const p2 = new FileRepository(file);
  const s1 = await p1.nextSeq();
  const s2 = await p2.nextSeq();
  assert.notEqual(s1, s2, `duplicate seq ${s1}==${s2}`);
  assert.ok(s2 > s1, `second claim must advance past the first (${s1} -> ${s2})`);
});

test('save rejects when nothing durable was written instead of resolving', async () => {
  const file = freshFile();
  const repo = new FileRepository(file);
  const doc = { id: 'doc-1', owner: 'demo', title: 'circular' };
  doc.self = doc; // JSON.stringify throws
  await assert.rejects(() => repo.save(doc), /persist/i);
  assert.equal(readFileSync(file, 'utf8'), '[]', 'failed save must leave the store file untouched');
});
