// Client for the Python FAISS sidecar (services/sidecar.py).
// Used when FAISS_SERVICE_URL is set; lib/vector.mjs remains the in-process default.
export class FaissClient {
  constructor(baseUrl, fetchImpl, timeoutMs = 30000) {
    this.baseUrl = String(baseUrl || '').replace(/\/$/, '');
    this.fetchImpl = fetchImpl || fetch;
    this.timeoutMs = timeoutMs;
  }
  async #post(path, body) {
    const res = await this.fetchImpl(this.baseUrl + path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`FAISS sidecar returned ${res.status} for ${path}`);
    return res.json();
  }
  async add(namespace, items, { reset = false } = {}) { return this.#post('/faiss/add', { namespace, items, reset }); }
  async search(namespace, vector, k = 5) { return (await this.#post('/faiss/search', { namespace, vector, k })).hits || []; }
  async renderPdf(pdfBuffer) { return this.#post('/render', { pdfBase64: Buffer.from(pdfBuffer).toString('base64') }); }
  async health() {
    const res = await this.fetchImpl(this.baseUrl + '/health', { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`FAISS sidecar health ${res.status}`);
    return res.json();
  }
}
export function faissSidecarUrl(env = process.env) {
  return env.FAISS_SERVICE_URL || env.SIDECAR_URL || '';
}
