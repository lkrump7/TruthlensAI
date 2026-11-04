// Small pure helpers for the page: hash routes, claim filtering, debounce.
// Kept free of JSX and DOM access so node --test can run them directly.

const TABS = ['home', 'check', 'library', 'claims', 'history'];
const TOOLS = ['claim', 'document', 'website'];
const LEGACY_TOOLS = { question: 'document' };

/**
 * @param {{ tab?: string, tool?: string, docId?: string, claimId?: string }} [state]
 * @returns {string}
 */
export function buildHash({ tab, tool, docId, claimId } = {}) {
  const normalized = LEGACY_TOOLS[tool] || tool;
  if (tab === 'check') return `#/check/${TOOLS.includes(normalized) ? normalized : 'claim'}`;
  if (tab === 'library') {
    if (docId && claimId) return `#/library/${encodeURIComponent(docId)}/${encodeURIComponent(claimId)}`;
    if (docId) return `#/library/${encodeURIComponent(docId)}`;
    return '#/library';
  }
  return `#/${TABS.includes(tab) ? tab : 'home'}`;
}

function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function parseHash(hash) {
  if (typeof hash !== 'string' || !hash.startsWith('#/')) return null;
  const parts = hash.slice(2).split('/').filter((p) => p !== '');
  const [tab, second, third] = parts;
  if (!TABS.includes(tab) || parts.length > 3) return null;
  if (tab === 'check') {
    if (second === undefined) return { tab, tool: 'claim' };
    if (LEGACY_TOOLS[second]) return { tab, tool: LEGACY_TOOLS[second] };
    return TOOLS.includes(second) ? { tab, tool: second } : null;
  }
  if (tab === 'library') {
    if (second === undefined) return { tab };
    const docId = decodeSegment(second);
    if (docId === null) return null;
    if (third === undefined) return { tab, docId };
    const claimId = decodeSegment(third);
    if (claimId === null) return null;
    return { tab, docId, claimId };
  }
  return second === undefined ? { tab } : null;
}

export function filterClaims(claims, { query = '', verdict = '', includeDismissed = false } = {}) {
  if (!Array.isArray(claims)) return [];
  const q = String(query).trim().toLowerCase();
  return claims.filter((c) => {
    if (c?.dismissed && !includeDismissed && verdict !== 'dismissed') return false;
    if (verdict === 'dismissed') return !!c?.dismissed;
    if (q && !String(c.text || '').toLowerCase().includes(q)) return false;
    if (verdict === 'unchecked') return !c.verdict;
    if (verdict) return c.verdict === verdict;
    return true;
  });
}

const MB = 1024 * 1024;
const UPLOAD_LIMITS = [
  { re: /\.pdf$/i, bytes: 15 * MB, error: 'PDF is larger than 15 MB.' },
  { re: /\.docx$/i, bytes: 15 * MB, error: 'DOCX is larger than 15 MB.' },
  { re: /\.(png|jpe?g|webp|gif)$/i, bytes: 10 * MB, error: 'Image is larger than 10 MB.' },
  { re: /\.(mp4|mov|webm|mkv)$/i, bytes: 100 * MB, error: 'Video is larger than 100 MB.' },
  { re: /\.(mp3|wav|m4a|ogg|oga|opus|flac|aac)$/i, bytes: 50 * MB, error: 'Audio is larger than 50 MB.' },
  { re: /\.(txt|md|markdown)$/i, bytes: 15 * MB, error: 'Text is larger than 15 MB.' },
];

export function uploadSizeError(file) {
  if (!file || !Number.isFinite(Number(file.size))) return null;
  const limit = UPLOAD_LIMITS.find((l) => l.re.test(String(file.name || '')));
  if (!limit) return null;
  return Number(file.size) > limit.bytes ? limit.error : null;
}

/**
 * Parse a fetch Response as JSON without throwing on HTML error pages.
 * Upload handlers use this so a 413/500 HTML body shows the server
 * message instead of a raw SyntaxError.
 * @param {{ json?: () => Promise<any> } | null | undefined} res
 */
export async function safeResponseJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

/**
 * Route one input box: a bare page address goes to the website checker,
 * a very long paste goes to the document checker, anything else is a claim.
 * @param {{ text?: string }} [input]
 * @returns {'claim' | 'website' | 'document'}
 */
export function detectCheckInput({ text } = {}) {
  const value = String(text || '').trim();
  if (/^https?:\/\/\S+$/i.test(value)) return 'website';
  if (value.length >= 1500) return 'document';
  return 'claim';
}

/**
 * Short recency label for vault dates. Same day and yesterday keep the
 * time, the past week counts days, older dates show month, day, year.
 * @param {string} iso
 * @param {number} [nowMs]
 * @returns {string}
 */
export function timeAgo(iso, nowMs = Date.now()) {
  const at = new Date(String(iso || ''));
  if (Number.isNaN(at.getTime())) return '';
  const dayNum = (d) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000;
  const days = Math.round(dayNum(new Date(nowMs)) - dayNum(at));
  const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (days <= 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  if (days < 7) return `${days} days ago`;
  return at.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Vault tab for a document. Websites read as web papers, images,
 * video and audio as scans, everything else as excerpts and manuscripts.
 * @param {{ kind?: string } | null | undefined} doc
 * @returns {'excerpt' | 'paper' | 'scan'}
 */
export function claimCategory(doc) {
  const kind = String(doc?.kind || '');
  if (kind === 'website') return 'paper';
  if (kind === 'image' || kind === 'video' || kind === 'audio') return 'scan';
  return 'excerpt';
}
// Legacy alias: pre-rename category name. Do not use in new code.
export const BOOK_CATEGORY = 'book';

export const THEME_STORAGE_KEY = 'truthlens-theme';

/**
 * Pick the theme to render. A stored light/dark choice wins, anything
 * else follows the system preference, defaulting to dark.
 * @param {string | null | undefined} stored
 * @param {boolean} [prefersLight]
 * @returns {'light' | 'dark'}
 */
export function resolveTheme(stored, prefersLight = false) {
  if (stored === 'light' || stored === 'dark') return stored;
  return prefersLight ? 'light' : 'dark';
}

/**
 * Flip the current theme for the toggle button.
 * @param {string | null | undefined} current
 * @returns {'light' | 'dark'}
 */
export function oppositeTheme(current) {
  return current === 'light' ? 'dark' : 'light';
}

const DOSSIER_EMPTY = { total: 0, supported: 0, contradicted: 0, partial: 0, unverifiable: 0, supportedPct: 0, contradictedPct: 0, partialPct: 0, unverifiablePct: 0 };

/**
 * Bucket verdicts into the four dashboard cards: Supported, Contradicted,
 * Partially supported, Unverifiable. Misleading and Outdated read as
 * partial; unchecked and non-factual claims read as unverifiable.
 * @param {Array<{ verdict?: string | null }>} [claims]
 */
export function dossierBuckets(claims) {
  if (!Array.isArray(claims) || claims.length === 0) return { ...DOSSIER_EMPTY };
  const out = { total: claims.length, supported: 0, contradicted: 0, partial: 0, unverifiable: 0 };
  for (const c of claims) {
    const v = String(c?.verdict || '');
    if (v === 'Supported') out.supported += 1;
    else if (v === 'Contradicted') out.contradicted += 1;
    else if (v === 'Partially supported' || v === 'Misleading' || v === 'Outdated') out.partial += 1;
    else out.unverifiable += 1;
  }
  const pct = (n) => (out.total > 0 ? Math.round((n / out.total) * 1000) / 10 : 0);
  return { ...out, supportedPct: pct(out.supported), contradictedPct: pct(out.contradicted), partialPct: pct(out.partial), unverifiablePct: pct(out.unverifiable) };
}

/**
 * Spread a page number across N chapters (1-based). Missing or
 * out-of-range pages fall back to the first or last chapter.
 * @param {number | null | undefined} page
 * @param {number} [totalPages]
 * @param {number} [chapters]
 * @returns {number}
 */
export function chapterIndexForPage(page, totalPages = 0, chapters = 8) {
  const span = Math.max(1, Math.floor(Number(chapters) || 8));
  const p = Number(page);
  const total = Number(totalPages);
  if (!Number.isFinite(p) || p < 1 || !Number.isFinite(total) || total <= 0) return 1;
  const size = total / span;
  return Math.min(span, Math.max(1, Math.ceil(p / size)));
}

/**
 * Narrow dossier claims by dashboard bucket and chapter at once.
 * @param {Array} [claims]
 * @param {{ bucket?: string, chapter?: number | string, totalPages?: number, chapters?: number }} [opts]
 */
export function filterDossierClaims(claims, { bucket = 'all', chapter = 'all', totalPages = 0, chapters = 8 } = {}) {
  if (!Array.isArray(claims)) return [];
  return claims.filter((c) => {
    if (bucket !== 'all') {
      const single = dossierBuckets([c]);
      const hit = (bucket === 'supported' && single.supported === 1)
        || (bucket === 'contradicted' && single.contradicted === 1)
        || (bucket === 'partially' && single.partial === 1)
        || (bucket === 'unverifiable' && single.unverifiable === 1);
      if (!hit) return false;
    }
    if (chapter !== 'all' && Number(chapter) !== chapterIndexForPage(c?.page ?? c?.pages?.[0], totalPages, chapters)) return false;
    return true;
  });
}

/**
 * Allow-list URLs for rendering as links. Only http(s) schemes survive,
 * so javascript:, data:, protocol-relative and bare values become null
 * and callers render plain text instead.
 * @param {unknown} value
 * @returns {string | null}
 */
export function safeHttpUrl(value) {
  const s = String(value ?? '').trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s)) return s;
  return null;
}

/**
 * Date Checked for one Past-checks row. Single checks carry it on the
 * history entry; file claims use their latest verification, falling back
 * to the file's upload date. Missing dates sort as the oldest.
 * @param {{ doc?: any, claim?: any, single?: boolean } | null | undefined} row
 * @returns {string}
 */
export function historyRowAt(row) {
  if (!row) return '';
  if (row.single) return row.claim?._entry?.at || row.doc?.createdAt || '';
  const h = row.claim?.history;
  if (Array.isArray(h) && h.length) return h[h.length - 1]?.at || '';
  return row.doc?.createdAt || '';
}

/**
 * Past checks show the most recent items first, matching the history API.
 * Returns a new array; the input order is left alone.
 * @param {Array} [rows]
 * @returns {Array}
 */
export function sortHistoryRowsNewestFirst(rows) {
  if (!Array.isArray(rows)) return [];
  return [...rows].sort((a, b) => (
    String(historyRowAt(b)).localeCompare(String(historyRowAt(a)))
    || String(b?.claim?.id || '').localeCompare(String(a?.claim?.id || ''))
    || String(b?.doc?.id || '').localeCompare(String(a?.doc?.id || ''))
  ));
}

export function createDebounced(fn, delayMs) {
  let timer = null;
  const run = (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, delayMs);
  };
  run.cancel = () => { if (timer) clearTimeout(timer); timer = null; };
  return run;
}
