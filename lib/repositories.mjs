import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

// Repository pattern: documents stored as whole aggregates, one row per document.
// Both backends honour loadAll() / nextSeq() / save(doc). The document service
// depends on that shape, never on which backend is active.
export class FileRepository {
  constructor(file) { this.file = file; this.docs = new Map(); this.seq = 0; this.load(); }
  load() {
    try {
      if (existsSync(this.file)) {
        for (const d of JSON.parse(readFileSync(this.file, 'utf8'))) { this.docs.set(d.id, d); this.seq = Math.max(this.seq, Number(String(d.id).split('-')[1]) || 0); }
      }
    } catch (e) { console.error(`[truthlens] store load failed, starting clean: ${e.message}`); }
  }
  async loadAll() { return [...this.docs.values()]; }
  async nextSeq() { return ++this.seq; }
  async save(doc) {
    this.docs.set(doc.id, doc);
    try { mkdirSync(dirname(this.file), { recursive: true }); writeFileSync(this.file, JSON.stringify([...this.docs.values()])); }
    catch (e) { console.error(`[truthlens] store persist failed (continuing in memory): ${e.message}`); }
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
