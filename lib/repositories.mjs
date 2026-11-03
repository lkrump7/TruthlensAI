import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, openSync, fsyncSync, closeSync, statSync, rmSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';

export const LOCK_STALE_MS = 10000;
const lockDirFor = (file) => `${file}.lock`;
const ownerFileFor = (file) => `${lockDirFor(file)}/owner`;
// A lock holder is identified by a fencing token (pid + uuid) written
// into the lock dir. The token does two jobs: a release only removes the
// dir when the owner file still names its own token, so a slow holder
// whose live lock was preempted as "stale" cannot delete the new owner's
// lock on its way out; and stale recovery keeps working for ownerless
// (legacy or crashed-before-write) lock dirs.
export async function acquireFileLock(file, timeoutMs = 5000) {
  const dir = lockDirFor(file);
  const start = Date.now();
  for (;;) {
    try {
      mkdirSync(dir);
      const token = `${process.pid}-${randomUUID()}`;
      try { writeFileSync(ownerFileFor(file), token); } catch { /* best-effort; release treats a missing owner as ours */ }
      return token;
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
export function releaseFileLock(file, token) {
  try {
    if (token) {
      let owner = null;
      try { owner = readFileSync(ownerFileFor(file), 'utf8'); } catch { owner = null; }
      if (owner !== null && owner !== token) return; // preempted: someone else owns the live lock
    }
    rmSync(lockDirFor(file), { recursive: true, force: true });
  } catch { /* best-effort */ }
}

const fileLocks = new Map();
function runFileLocked(file, fn) {
  const prior = fileLocks.get(file) || Promise.resolve();
  const run = prior.then(async () => {
    const token = await acquireFileLock(file);
    try {
      return await fn(token);
    } finally {
      releaseFileLock(file, token);
    }
  });
  const tail = run.then(() => {}, () => {});
  fileLocks.set(file, tail);
  tail.then(() => { if (fileLocks.get(file) === tail) fileLocks.delete(file); });
  return run;
}

// Conflict between a stale aggregate and the store: the writer must
// re-read and retry (or surface it), never blindly overwrite.
export function storeConflict(message) {
  return Object.assign(new Error(message), { code: 'store-conflict' });
}

// Repository pattern: documents stored as whole aggregates, one row per document.
// Both backends honour loadAll() / nextSeq() / save(doc). The document service
// depends on that shape, never on which backend is active.
export class FileRepository {
  constructor(file) { this.file = file; this.seqFile = `${file}.seq`; this.docs = new Map(); this.seq = 0; this.corrupt = false; this.load(); }
  // Highest sequence number claimed so far, across processes: the largest
  // doc-N suffix on disk, or the durable sidecar left behind by nextSeq().
  // Never throws; an unreadable sidecar simply contributes 0.
  readSeqHint() {
    try {
      if (!existsSync(this.seqFile)) return 0;
      const n = Number(String(readFileSync(this.seqFile, 'utf8')).trim());
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    } catch { return 0; }
  }
  // Durably claim a sequence number so a second process on the same file
  // cannot issue it again. Throws on failure; the sequence is only treated
  // as claimed once this returns.
  writeSeqHint(seq) {
    mkdirSync(dirname(this.seqFile), { recursive: true });
    const tmp = `${this.seqFile}.tmp-${process.pid}-${randomUUID()}`;
    try {
      writeFileSync(tmp, String(seq));
      const fd = openSync(tmp, 'r');
      try { fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(tmp, this.seqFile);
    } catch (e) {
      try { rmSync(tmp, { force: true }); } catch { /* best-effort */ }
      throw new Error(`Document store sequence persist failed for ${this.seqFile}: ${e.message}`, { cause: e });
    }
  }
  trackSeq(id) {
    const n = Number(String(id).split('-')[1]);
    if (Number.isFinite(n) && n > this.seq) this.seq = Math.floor(n);
  }
  // Durable sequence reservations: `${seqFile}.res-N` files created with
  // O_EXCL. The winning creator owns N; a concurrent claimer that loses
  // the creation race moves on to N+1, so two instances cannot mint the
  // same doc-N even if the file lock was preempted from under a slow
  // holder. Reservation files survive sidecar loss and restarts; files at
  // or below the highest persisted doc-N are pruned as they become gaps.
  resFileFor(n) { return `${this.seqFile}.res-${n}`; }
  readReservationsMax() {
    let max = 0;
    try {
      const dir = dirname(this.seqFile);
      const base = basename(this.seqFile);
      for (const f of readdirSync(dir)) {
        if (!f.startsWith(`${base}.res-`)) continue;
        const n = Number(f.slice(`${base}.res-`.length));
        if (Number.isFinite(n)) max = Math.max(max, Math.floor(n));
      }
    } catch { /* unreadable dir contributes nothing */ }
    return max;
  }
  claimReservation(from) {
    let candidate = from;
    for (;;) {
      candidate += 1;
      try {
        writeFileSync(this.resFileFor(candidate), `${process.pid}-${randomUUID()}`, { flag: 'wx' });
        return candidate;
      } catch (e) {
        if (e?.code !== 'EEXIST') throw e;
      }
    }
  }
  pruneReservations(through) {
    try {
      const dir = dirname(this.seqFile);
      const base = basename(this.seqFile);
      for (const f of readdirSync(dir)) {
        if (!f.startsWith(`${base}.res-`)) continue;
        const n = Number(f.slice(`${base}.res-`.length));
        if (Number.isFinite(n) && Math.floor(n) <= through) {
          try { rmSync(join(dir, f), { force: true }); } catch { /* best-effort */ }
        }
      }
    } catch { /* best-effort */ }
  }
  // Lock-held sequence claim: reload first (the caller holds the file
  // lock), then persist the reservation (sidecar + O_EXCL file) before
  // returning, so the id is taken before any doc is saved under it.
  _nextSeqLocked() {
    this.assertWritable();
    const hint = this.readSeqHint();
    const resMax = this.readReservationsMax();
    const claimed = this.claimReservation(Math.max(this.seq, hint, resMax));
    this.writeSeqHint(claimed);
    let docMax = 0;
    for (const d of this.docs.values()) {
      const n = Number(String(d.id).split('-')[1]);
      if (Number.isFinite(n)) docMax = Math.max(docMax, Math.floor(n));
    }
    this.pruneReservations(docMax);
    this.seq = Math.max(this.seq, claimed);
    return claimed;
  }
  load() {
    try {
      if (existsSync(this.file)) {
        for (const d of JSON.parse(readFileSync(this.file, 'utf8'))) { this.docs.set(d.id, d); this.trackSeq(d.id); }
      }
      this.seq = Math.max(this.seq, this.readSeqHint());
      this.corrupt = false;
    } catch (e) {
      const aside = `${this.file}.corrupt-${Date.now()}`;
      try { copyFileSync(this.file, aside); } catch { /* quarantine is best-effort */ }
      console.error(`[truthlens] store load failed, corrupt file preserved at ${aside}: ${e.message}`);
      this.docs = new Map();
      this.corrupt = true;
    }
  }
  // Fresh read on every call: another process may have written since we
  // last looked. Reads stay available on a corrupt store (empty view, flag
  // kept); writes still fail closed via assertWritable().
  async loadAll() {
    return runFileLocked(this.file, () => {
      this.reloadFromDisk();
      return [...this.docs.values()];
    });
  }
  reloadFromDisk() {
    try {
      if (!existsSync(this.file)) {
        this.seq = Math.max(this.seq, this.readSeqHint());
        this.corrupt = false;
        return;
      }
      const fresh = new Map();
      let maxSeq = Math.max(this.seq, this.readSeqHint(), this.readReservationsMax());
      for (const d of JSON.parse(readFileSync(this.file, 'utf8'))) {
        fresh.set(d.id, d);
        const n = Number(String(d.id).split('-')[1]);
        if (Number.isFinite(n)) maxSeq = Math.max(maxSeq, Math.floor(n));
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
      return this._nextSeqLocked();
    });
  }
  // Atomic read-modify-write inside the file lock: the mutator runs on a
  // fresh copy of the stored aggregate and its result is persisted before
  // the lock is released, so a concurrent writer in another process cannot
  // slip between the read and the write. The mutator must be pure (no
  // repository calls: the lock is already held). Returning null/undefined
  // writes nothing. Corrupt stores stay fail-closed.
  async update(id, mutator) {
    return runFileLocked(this.file, () => {
      this.reloadFromDisk();
      this.assertWritable();
      const current = this.docs.get(id);
      const fresh = current === undefined ? null : JSON.parse(JSON.stringify(current));
      const next = mutator(fresh);
      if (next === null || next === undefined) return { doc: current === undefined ? null : fresh, changed: false };
      if (!next.id) throw new Error(`Repository update for ${id} must return a document with an id.`);
      const had = this.docs.has(next.id);
      const prev = this.docs.get(next.id);
      this.trackSeq(next.id);
      this.docs.set(next.id, next);
      try {
        this.persist();
      } catch (e) {
        if (had) this.docs.set(next.id, prev); else this.docs.delete(next.id);
        throw e;
      }
      return { doc: next, changed: true };
    });
  }
  // inserts a new document, failing with a store-conflict instead of
  // overwriting when the id (or the conflictIf predicate over the fresh
  // store) says someone else got there first. Corrupt stores stay
  // fail-closed.
  /** @param {any} doc @param {{ conflictIf?: (docs: Map<string, any>) => string|undefined }} [opts] */
  async insert(doc, { conflictIf } = /** @type {{ conflictIf?: (docs: Map<string, any>) => string|undefined }} */ ({}) ) {
    return runFileLocked(this.file, () => {
      this.reloadFromDisk();
      this.assertWritable();
      if (!doc || !doc.id) throw new Error('Repository insert needs a document with an id.');
      if (this.docs.has(doc.id)) throw storeConflict(`Document ${doc.id} already exists.`);
      if (typeof conflictIf === 'function') {
        const reason = conflictIf(this.docs);
        if (reason) throw storeConflict(typeof reason === 'string' ? reason : `Insert of ${doc.id} conflicts with the stored state.`);
      }
      this.trackSeq(doc.id);
      this.docs.set(doc.id, doc);
      try {
        this.persist();
      } catch (e) {
        this.docs.delete(doc.id);
        throw e;
      }
      return doc;
    });
  }
  persist() {
    this.assertWritable();
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp-${process.pid}-${randomUUID()}`;
    try {
      writeFileSync(tmp, JSON.stringify([...this.docs.values()]));
      const fd = openSync(tmp, 'r');
      try { fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(tmp, this.file);
    } catch (e) {
      try { rmSync(tmp, { force: true }); } catch { /* best-effort */ }
      throw new Error(`Document store persist failed for ${this.file}: ${e.message}`, { cause: e });
    }
  }
  async save(doc) {
    return runFileLocked(this.file, () => {
      this.reloadFromDisk();
      this.assertWritable();
      const had = this.docs.has(doc.id);
      const prev = this.docs.get(doc.id);
      this.docs.set(doc.id, doc);
      try {
        this.persist();
      } catch (e) {
        if (had) this.docs.set(doc.id, prev); else this.docs.delete(doc.id);
        throw e;
      }
    });
  }
  async remove(id) {
    return runFileLocked(this.file, () => {
      this.reloadFromDisk();
      this.assertWritable();
      if (!this.docs.has(id)) return false;
      const prev = this.docs.get(id);
      this.docs.delete(id);
      try {
        this.persist();
      } catch (e) {
        this.docs.set(id, prev);
        throw e;
      }
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
  // Same atomicity contract as the file backend: the mutator runs on the
  // freshly locked row inside a transaction. Returning null writes nothing.
  async update(id, mutator) {
    await this.init();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT data FROM documents WHERE id = $1 FOR UPDATE', [id]);
      const current = rows[0]?.data ?? null;
      const fresh = current === null ? null : JSON.parse(JSON.stringify(current));
      const next = await mutator(fresh);
      if (next === null || next === undefined) {
        await client.query('ROLLBACK');
        return { doc: current, changed: false };
      }
      if (!next.id) throw new Error(`Repository update for ${id} must return a document with an id.`);
      await client.query('INSERT INTO documents (id, owner, data) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET owner = EXCLUDED.owner, data = EXCLUDED.data', [next.id, next.owner || 'demo', JSON.stringify(next)]);
      await client.query('COMMIT');
      return { doc: next, changed: true };
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* best-effort */ }
      throw e;
    } finally {
      client.release();
    }
  }
  /** @param {any} doc @param {{ conflictIf?: (docs: Map<string, any>) => string|undefined }} [opts] */
  async insert(doc, { conflictIf } = /** @type {{ conflictIf?: (docs: Map<string, any>) => string|undefined }} */ ({}) ) {
    if (!doc || !doc.id) throw new Error('Repository insert needs a document with an id.');
    await this.init();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT data FROM documents WHERE id = $1 FOR UPDATE', [doc.id]);
      if (rows.length) throw storeConflict(`Document ${doc.id} already exists.`);
      if (typeof conflictIf === 'function') {
        const all = await client.query('SELECT data FROM documents');
        const docs = new Map(all.rows.map((r) => [r.data.id, r.data]));
        const reason = conflictIf(docs);
        if (reason) throw storeConflict(typeof reason === 'string' ? reason : `Insert of ${doc.id} conflicts with the stored state.`);
      }
      await client.query('INSERT INTO documents (id, owner, data) VALUES ($1, $2, $3)', [doc.id, doc.owner || 'demo', JSON.stringify(doc)]);
      await client.query('COMMIT');
      return doc;
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch { /* best-effort */ }
      throw e;
    } finally {
      client.release();
    }
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
