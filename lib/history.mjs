import { repository } from './repositories.mjs';
import { buildReport } from './report.mjs';
import { emitDocumentChanged } from './events.mjs';
import { verifyClaim, DEMO_EVIDENCE } from './demo.mjs';
import { liveStatus, getModels } from './meta.mjs';
import { verifyResearchedClaim } from './pipeline.mjs';
import { CONFIG } from './config.mjs';
import { VectorIndex } from './vector.mjs';
import { numbersIn } from './nlp.mjs';

// Comprehensive memory for every workflow. Books, websites, and
// reader-submitted questions already persist on their documents. This
// module gives standalone claim checks the same home, and reads one
// unified history back across all of them.

export const MAX_BATCH_CLAIMS = 10;
// Similar-result grouping for history. Measured on the TF-IDF cosine
// this codebase uses: topically distinct claims score at most 0.603
// (docs/MATHEMATICS.md), while worded variants of one claim score
// 0.73 and up. 0.66 sits between those bands. Grouping is transitive
// through group members, and different numbers never group.
export const SIMILAR_RESULT_THRESHOLD = 0.66;
export const HISTORY_TITLE = 'Investigation history';

export function parseClaimBatch(input, limit = MAX_BATCH_CLAIMS) {
  const lines = Array.isArray(input)
    ? input.map((x) => String(x ?? ''))
    : String(input ?? '').split(/\r?\n/);
  const seen = new Set();
  const out = [];
  for (const line of lines) {
    const text = String(line).trim().replace(/\s+/g, ' ');
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= limit) break;
  }
  return out;
}

const visibleTo = (docs, owner) => (owner
  ? docs.filter((d) => (d.owner || 'demo') === owner || (d.owner || 'demo') === 'demo')
  : docs);

// Writes to one owner's history document are serialized, so two
// verdicts finishing together cannot overwrite each other.
const historyLocks = new Map();
function runHistoryLocked(owner, fn) {
  const key = owner || 'demo';
  const prior = historyLocks.get(key);
  let run;
  if (!prior) {
    try { run = Promise.resolve(fn()); } catch (err) { run = Promise.reject(err); }
  } else {
    run = prior.then(fn, fn);
  }
  const tail = run.then(() => {}, () => {});
  historyLocks.set(key, tail);
  tail.then(() => { if (historyLocks.get(key) === tail) historyLocks.delete(key); });
  return run;
}

async function saveHistoryDoc(doc) {
  await repository().save(doc);
  emitDocumentChanged(doc.id);
}

/** @param {{ owner?: string, workflow?: string, result?: any }} input */
export async function recordInvestigation({ owner = 'demo', workflow = 'claim', result } = {}) {
  if (!result?.text || !result?.verdict) throw new Error('A finished verdict is needed to record an investigation.');
  const who = owner || 'demo';
  return runHistoryLocked(who, async () => {
    const all = await repository().loadAll();
    let doc = all.find((d) => d.kind === 'history' && (d.owner || 'demo') === who);
    if (!doc) {
      doc = {
        id: `doc-${await repository().nextSeq()}`, owner: who, kind: 'history',
        title: HISTORY_TITLE, createdAt: new Date().toISOString(),
        pages: 0, chunks: [], claims: [], quarantined: 0, foundClaims: 0, deferredClaims: 0,
        status: 'ready', autoPaused: false, coverage: 0, report: null,
      };
    }
    const used = (doc.claims || []).map((c) => Number(String(c.id).split('-').pop()) || 0);
    const { mode: _m, models: _mo, missing: _mi, nliChecks: _n, ...verdictOnly } = result || {};
    const claim = {
      ...verdictOnly,
      id: `${doc.id}-claim-${Math.max(0, ...used) + 1}`,
      text: String(result.text),
      source: workflow === 'question' ? 'reader-submitted' : 'standalone',
      workflow,
      status: 'verified',
      page: null, pages: [],
      history: [...(result.history || []), { at: new Date().toISOString(), verdict: result.verdict, judgedBy: result.judgedBy }],
    };
    doc.claims = [...(doc.claims || []), claim];
    doc.report = buildReport(doc.claims);
    doc.coverage = doc.report.evidenceCoverage;
    await saveHistoryDoc(doc);
    return { doc, claim };
  });
}

function workflowOf(doc, claim) {
  if (claim.workflow) return claim.workflow;
  if (claim.source === 'reader-submitted') return 'question';
  if (doc.kind === 'history') return 'claim';
  if (doc.kind === 'website') return 'website';
  return 'book';
}

export async function listHistory(owner = 'demo', { query = '', verdict = '', workflow = '', limit = 100 } = {}) {
  const all = visibleTo(await repository().loadAll(), owner || 'demo');
  const words = String(query || '').trim().toLowerCase();
  const entries = [];
  for (const doc of all) {
    for (const claim of doc.claims || []) {
      if (!claim.verdict) continue;
      if (claim.status && claim.status !== 'verified') continue;
      const wf = workflowOf(doc, claim);
      if (workflow && wf !== workflow) continue;
      if (verdict && claim.verdict !== verdict) continue;
      if (words && !String(claim.text || '').toLowerCase().includes(words)) continue;
      entries.push({
        claimId: claim.id, docId: doc.id, docTitle: doc.title, docKind: doc.kind,
        workflow: wf, text: claim.text, verdict: claim.verdict, judgedBy: claim.judgedBy,
        at: claim.history?.[claim.history.length - 1]?.at || doc.createdAt || '',
        claim,
      });
    }
  }
  entries.sort((a, b) => String(b.at).localeCompare(String(a.at)) || String(b.claimId).localeCompare(String(a.claimId)));
  // Deduplicate similar results. The same claim checked again in
  // slightly different words is one result, shown by its newest run.
  // Repeats stay on the kept row so nothing is silently lost, and a
  // claim with different numbers is never folded into another.
  // Grouping stays inside one workflow. The same words checked as a
  // standalone claim and as a question about a book are two results.
  const indexes = new Map();
  const groupOf = new Map();
  const kept = [];
  for (const entry of entries) {
    if (!indexes.has(entry.workflow)) indexes.set(entry.workflow, new VectorIndex());
    const index = indexes.get(entry.workflow);
    const hit = index.search(entry.text, 1)[0];
    const match = hit && hit.score > SIMILAR_RESULT_THRESHOLD ? groupOf.get(hit.id) : null;
    if (match && numbersIn(match.text).join(',') === numbersIn(entry.text).join(',')) {
      match.duplicateCount += 1;
      match.duplicates.push({ claimId: entry.claimId, text: entry.text, verdict: entry.verdict, at: entry.at, docTitle: entry.docTitle });
      index.add(entry.claimId, entry.text);
      groupOf.set(entry.claimId, match);
      continue;
    }
    const row = { ...entry, duplicateCount: 1, duplicates: [] };
    kept.push(row);
    index.add(row.claimId, row.text);
    groupOf.set(row.claimId, row);
  }
  return kept.slice(0, Math.max(1, limit));
}

export async function getHistoryEntry(owner = 'demo', claimId) {
  const entries = await listHistory(owner, { limit: 1000 });
  const kept = entries.find((e) => e.claimId === claimId);
  if (kept) return kept;
  for (const e of entries) {
    const dup = (e.duplicates || []).find((d) => d.claimId === claimId);
    if (dup) return { ...e, claimId: dup.claimId, text: dup.text, verdict: dup.verdict, at: dup.at, docTitle: dup.docTitle, foldedInto: e.claimId };
  }
  return null;
}

// One standalone check, with the same honesty rules as the verify
// routes. Demo verdicts are labelled demo. A live failure is left
// Unverifiable. Nothing falls back to a canned verdict.
export async function verifyStandalone(text) {
  const clean = String(text || '').trim();
  const status = liveStatus();
  if (!status.configured) {
    const base = await verifyClaim({ text: clean }, DEMO_EVIDENCE);
    return { ...base, mode: 'demo', models: getModels(), missing: status.missing };
  }
  try {
    const live = await verifyResearchedClaim(clean);
    return { ...live, models: getModels() };
  } catch (err) {
    return {
      text: clean, type: 'Unclassified', verdict: 'Unverifiable', judgedBy: 'Muse Spark 1.3',
      supporting: [], contradicting: [], mode: 'live-failed', models: getModels(),
      explanation: 'Live research failed, so no verdict was produced rather than falling back to a canned one.',
      limitations: [`Live research failed (${err.message}). Retry the claim.`],
    };
  }
}

/** @param {string | string[]} input @param {{ owner?: string, verifyOne?: (text: string) => Promise<any> }} [opts] */
export async function verifyClaimBatch(input, { owner = 'demo', verifyOne = verifyStandalone } = {}) {
  const texts = parseClaimBatch(input);
  const results = new Array(texts.length);
  let next = 0;
  const worker = async () => {
    while (next < texts.length) {
      const i = next++;
      const text = texts[i];
      try {
        if (text.length > CONFIG.MAX_CLAIM_CHARS) throw new Error(`Claim is longer than ${CONFIG.MAX_CLAIM_CHARS} characters.`);
        const result = await verifyOne(text);
        const saved = await recordInvestigation({ owner, workflow: 'claim', result });
        results[i] = { text, ok: true, result, claimId: saved.claim.id, docId: saved.doc.id };
      } catch (err) {
        results[i] = { text, ok: false, error: err?.message || 'Verification failed.' };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONFIG.DOCUMENT_CLAIM_CONCURRENCY, texts.length) || 0 }, worker));
  return results;
}
