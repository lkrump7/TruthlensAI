import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, openSync, fsyncSync, closeSync, statSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const LOCK_STALE_MS = 10000;
const lockDirFor = (file) => `${file}.lock`;
async function acquireFileLock(file, timeoutMs = 5000) {
  const dir = lockDirFor(file);
  const start = Date.now();
  for (;;) {
    try {
      mkdirSync(dir);
      return;
    } catch (e) {
      if (e?.code !== 'EEXIST') throw e;
      try {
        const age = Date.now() - statSync(dir).mtimeMs;
        if (age > LOCK_STALE_MS) rmSync(dir, { recursive: true, force: true });
      } catch { /* race or missing; retry */ }
    }
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for the document store lock for ${file}.`);
    await new Promise((r) => setTimeout(r, 10));
  }
}
function releaseFileLock(file) {
  try { rmSync(lockDirFor(file), { recursive: true, force: true }); } catch { /* best-effort */ }
}

const fileLocks = new Map();
function runFileLocked(file, fn) {
  const prior = fileLocks.get(file) || Promise.resolve();
  const run = prior.then(async () => {
    await acquireFileLock(file);
    try {
      return await fn();
    } finally {
      releaseFileLock(file);
    }
  });
  const tail = run.then(() => {}, () => {});
  fileLocks.set(file, tail);
  tail.then(() => { if (fileLocks.get(file) === tail) fileLocks.delete(file); });
  return run;
}

// Repository pattern: documents stored as whole aggregates, one row per document.
// Both backends honour loadAll() / nextSeq() / save(doc). The document service
// depends on that shape, never on which backend is active.
export class FileRepository {
  constructor(file) { this.file = file; this.docs = new Map(); this.seq = 0; this.corrupt = false; this.load(); }
  load() {
    try {
      if (existsSync(this.file)) {
        for (const d of JSON.parse(readFileSync(this.file, 'utf8'))) { this.docs.set(d.id, d); this.seq = Math.max(this.seq, Number(String(d.id).split('-')[1]) || 0); }
      }
      this.corrupt = false;
    } catch (e) {
      const aside = `${this.file}.corrupt-${Date.now()}`;
      try { copyFileSync(this.file, aside); } catch { /* quarantine is best-effort */ }
      console.error(`[truthlens] store load failed, corrupt file preserved at ${aside}: ${e.message}`);
      this.docs = new Map();
      this.corrupt = true;
    }
  }
  async loadAll() { return [...this.docs.values()]; }
  reloadFromDisk() {
    try {
      if (!existsSync(this.file)) {
        this.corrupt = false;
        return;
      }
      const fresh = new Map();
      let maxSeq = this.seq;
      for (const d of JSON.parse(readFileSync(this.file, 'utf8'))) {
        fresh.set(d.id, d);
        maxSeq = Math.max(maxSeq, Number(String(d.id).split('-')[1]) || 0);
      }
      this.docs = fresh;
      this.seq = maxSeq;
      this.corrupt = false;
    } catch (e) {
      const aside = `${this.file}.corrupt-${Date.now()}`;
      try { copyFileSync(this.file, aside); } catch { /* quarantine is best-effort */ }
      console.error(`[truthlens] store load failed, corrupt file preserved at ${aside}: ${e.message}`);
      this.corrupt = true;
    }
  }
  assertWritable() {
    if (this.corrupt) throw new Error(`Document store is corrupt (${this.file}). Restore from a backup or the preserved corrupt copy before writing.`);
  }
  async nextSeq() {
    return runFileLocked(this.file, () => {
      this.reloadFromDisk();
      this.assertWritable();
      return ++this.seq;
    });
  }
  persist() {
    this.assertWritable();
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp-${process.pid}-${randomUUID()}`;
      writeFileSync(tmp, JSON.stringify([...this.docs.values()]));
      const fd = openSync(tmp, 'r');
      try { fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(tmp, this.file);
    } catch (e) { console.error(`[truthlens] store persist failed (continuing in memory): ${e.message}`); }
  }
  async save(doc) {
    return runFileLocked(this.file, () => {
      this.reloadFromDisk();
      this.assertWritable();
      this.docs.set(doc.id, doc);
      this.persist();
    });
  }
  async remove(id) {
    return runFileLocked(this.file, () => {
      this.reloadFromDisk();
      this.assertWritable();
      if (!this.docs.delete(id)) return false;
      this.persist();
      return true;
    });
  }
}

export class PostgresRepository {
  constructor(url) { this.url = url; this.pool = null; this.seq = 0; }
  async init() {
    if (this.pool) return;
    const { default: pg } = await import('pg');
    this.pool = new pg.Pool({ connectionString: this.url });
    await this.pool.query('CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, owner TEXT NOT NULL DEFAULT \'demo\', data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    await this.pool.query("CREATE SEQUENCE IF NOT EXISTS documents_seq");
    const { rows } = await this.pool.query("SELECT COALESCE(MAX((split_part(id, '-', 2))::int), 0) AS maxseq FROM documents WHERE id LIKE 'doc-%'");
    this.seq = rows[0]?.maxseq || 0;
    await this._alignSequence(this.seq);
  }
  // Raise the sequence past existing ids, but never rewind it: another
  // instance may already have issued ids beyond the current table max.
  async _alignSequence(maxSeq) {
    const { rows } = await this.pool.query('SELECT last_value, is_called FROM documents_seq');
    const cur = rows[0] || { last_value: 1, is_called: false };
    const issued = cur.is_called ? Number(cur.last_value) : Number(cur.last_value) - 1;
    if (maxSeq > issued) await this.pool.query("SELECT setval('documents_seq', $1, true)", [maxSeq]);
  }
  async loadAll() {
    await this.init();
    const { rows } = await this.pool.query('SELECT data FROM documents ORDER BY created_at ASC');
    return rows.map((r) => r.data);
  }
  async nextSeq() {
    await this.init();
    const { rows } = await this.pool.query("SELECT nextval('documents_seq') AS seq");
    return Number(rows[0].seq);
  }
  async save(doc) {
    await this.init();
    await this.pool.query('INSERT INTO documents (id, owner, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET owner = EXCLUDED.owner, data = EXCLUDED.data', [doc.id, doc.owner || 'demo', JSON.stringify(doc)]);
  }
  async remove(id) {
    await this.init();
    const { rowCount } = await this.pool.query('DELETE FROM documents WHERE id = $1', [id]);
    return rowCount > 0;
  }
  async close() { if (this.pool) { await this.pool.end(); this.pool = null; } }
}

let repo = null;
export function repository() {
  if (repo) return repo;
  repo = process.env.DATABASE_URL
    ? new PostgresRepository(process.env.DATABASE_URL)
    : new FileRepository(process.env.TRUTHLENS_STORE_FILE || 'data/documents.json');
  return repo;
}
export function storeBackend() { return process.env.DATABASE_URL ? 'postgres' : 'file'; }
