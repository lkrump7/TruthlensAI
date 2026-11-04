import { repository, storeConflict } from './repositories.mjs';
import { liveFailedResult } from './errors.mjs';
import { buildReport } from './report.mjs';
import { emitDocumentChanged } from './events.mjs';
import { verifyClaim, DEMO_EVIDENCE } from './demo.mjs';
import { liveStatus, getModels } from './meta.mjs';
import { verifyResearchedClaim } from './pipeline.mjs';
import { CONFIG } from './config.mjs';
import { VectorIndex } from './vector.mjs';
import { numbersIn } from './nlp.mjs';
import { classifyClaim } from './claims.mjs';

// Comprehensive memory for every workflow. Excerpts, websites, and
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

const historyKeyLocks = new Map();
function runHistoryKeyLocked(key, fn) {
  const prior = historyKeyLocks.get(key);
  let run;
  if (!prior) {
    try { run = Promise.resolve(fn()); } catch (err) { run = Promise.reject(err); }
  } else {
    run = prior.then(fn, fn);
  }
  const tail = run.then(() => {}, () => {});
  historyKeyLocks.set(key, tail);
  tail.then(() => { if (historyKeyLocks.get(key) === tail) historyKeyLocks.delete(key); });
  return run;
}

const usableHistoryKey = (k) => {
  const s = String(k || '').trim();
  return s && s.length <= 255 ? s : null;
};

// One replay label for both verify routes. A stored verdict carries no
// mode of its own, so each replay stamps the mode the server is in now.
export function replayModeLabel() {
  return liveStatus().configured ? 'live' : 'demo';
}

export async function findHistoryByKey(owner = 'demo', key) {
  const usable = usableHistoryKey(key);
  if (!usable) return null;
  const who = owner || 'demo';
  const all = await repository().loadAll();
  const doc = all.find((d) => d.kind === 'history' && (d.owner || 'demo') === who);
  const claimId = doc?.idempotencyKeys?.[usable];
  if (!claimId) return null;
  const claim = (doc.claims || []).find((c) => c.id === claimId);
  if (!claim) return null;
  return { doc, claim };
}

// One empty history document per owner, created exactly once: the insert
// runs inside the file lock and conflicts when another writer created it
// first, so two racing processes never fork the history. Claim ids are
// minted from the freshly locked aggregate inside the same lock, so
// racing writers cannot mint the same claim id.
/** @param {{ owner?: string, workflow?: string, result?: any, idempotencyKey?: string }} input */
export async function recordInvestigation({ owner = 'demo', workflow = 'claim', result, idempotencyKey } = {}) {
  if (!result?.text || !result?.verdict) throw new Error('A finished verdict is needed to record an investigation.');
  const who = owner || 'demo';
  const usable = usableHistoryKey(idempotencyKey);
  const run = async () => runHistoryLocked(who, async () => {
    for (;;) {
      const all = await repository().loadAll();
      let doc = all.find((d) => d.kind === 'history' && (d.owner || 'demo') === who);
      if (!doc) {
        const draft = {
          id: `doc-${await repository().nextSeq()}`, owner: who, kind: 'history',
          title: HISTORY_TITLE, createdAt: new Date().toISOString(),
          pages: 0, chunks: [], claims: [], quarantined: 0, foundClaims: 0, deferredClaims: 0,
          status: 'ready', autoPaused: false, coverage: 0, report: null, idempotencyKeys: {},
        };
        try {
          await repository().insert(draft, {
            conflictIf: (docs) => [...docs.values()].some((d) => d.kind === 'history' && (d.owner || 'demo') === who)
              ? 'history document was initialised concurrently' : null,
          });
          doc = draft;
        } catch (e) {
          if (e?.code !== 'store-conflict') throw e;
          continue; // someone else initialised it; re-read and append to theirs
        }
      }
      let outcome = null;
      try {
        const res = await repository().update(doc.id, (fresh) => {
          if (!fresh || fresh.kind !== 'history') throw storeConflict('history document changed under write');
          if (usable && fresh.idempotencyKeys?.[usable]) {
            const existing = (fresh.claims || []).find((c) => c.id === fresh.idempotencyKeys[usable]);
            if (existing) {
              if (existing.text !== String(result.text)) {
                const err = /** @type {Error & { code?: string }} */ (new Error('Idempotency-Key conflict: this key was used for a different submission.'));
                err.code = 'idempotency-conflict';
                throw err;
              }
              outcome = { doc: fresh, claim: existing };
              return null;
            }
          }
          const used = (fresh.claims || []).map((c) => Number(String(c.id).split('-').pop()) || 0);
          const { mode: _m, models: _mo, missing: _mi, nliChecks: _n, historyClaimId: _hci, historyDocId: _hdi, ...verdictOnly } = result || {};
          const claim = {
            ...verdictOnly,
            id: `${fresh.id}-claim-${Math.max(0, ...used) + 1}`,
            text: String(result.text),
            source: workflow === 'question' ? 'reader-submitted' : 'standalone',
            workflow,
            status: 'verified',
            page: null, pages: [],
            history: [...(result.history || []), { at: new Date().toISOString(), verdict: result.verdict, judgedBy: result.judgedBy }],
          };
          const next = {
            ...fresh,
            claims: [...(fresh.claims || []), claim],
            idempotencyKeys: usable ? { ...(fresh.idempotencyKeys || {}), [usable]: claim.id } : (fresh.idempotencyKeys || {}),
          };
          next.report = buildReport(next.claims);
          next.coverage = next.report.evidenceCoverage;
          outcome = { doc: next, claim };
          return next;
        });
        if (!res.changed && !outcome) continue;
        if (res.changed) emitDocumentChanged(doc.id);
        return outcome;
      } catch (e) {
        if (e?.code === 'store-conflict') continue; // history doc replaced under us; re-read
        throw e;
      }
    }
  });
  if (!usable) return run();
  return runHistoryKeyLocked(`${who}\n${usable}`, run);
}

export function normalizeWorkflow(wf) {
  if (wf === 'book') return 'excerpt';
  return wf;
}
function workflowOf(doc, claim) {
  if (claim.workflow) return normalizeWorkflow(claim.workflow);
  if (claim.source === 'reader-submitted') return 'question';
  if (doc.kind === 'history') return 'claim';
  if (doc.kind === 'website') return 'website';
  return 'excerpt';
}

export async function listHistory(owner = 'demo', { query = '', verdict = '', workflow = '', limit = 100, offset = 0 } = {}) {
  const rawLimit = Number(limit);
  const lim = !Number.isFinite(rawLimit) ? 100 : Math.min(200, Math.max(1, Math.trunc(rawLimit)));
  const rawOffset = Number(offset);
  const off = !Number.isFinite(rawOffset) ? 0 : Math.max(0, Math.trunc(rawOffset));
  const all = visibleTo(await repository().loadAll(), owner || 'demo');
  const words = String(query || '').trim().toLowerCase();
  const entries = [];
  for (const doc of all) {
    for (const claim of doc.claims || []) {
      if (!claim.verdict) continue;
      if (claim.status && claim.status !== 'verified') continue;
      const wf = workflowOf(doc, claim);
      if (workflow && wf !== normalizeWorkflow(workflow)) continue;
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
  // standalone claim and as a question about an excerpt are two results.
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
  return kept.slice(off, off + lim);
}

export async function deleteHistoryEntries(owner = 'demo', claimIds = []) {
  const ids = [...new Set(
    (Array.isArray(claimIds) ? claimIds : [claimIds])
      .map((x) => String(x ?? '').trim())
      .filter(Boolean),
  )];
  if (!ids.length) return { deleted: [], docIds: [] };
  const who = owner || 'demo';
  const wanted = new Set(ids);
  const all = await repository().loadAll();
  const visible = visibleTo(all, who);
  const targets = new Map();
  for (const doc of visible) {
    if (!doc || doc.kind === 'tombstone' || doc.kind === 'seed-marker') continue;
    const hit = (doc.claims || []).filter((c) => wanted.has(c.id)).map((c) => c.id);
    if (hit.length) targets.set(doc.id, hit);
  }
  if (!targets.size) return { deleted: [], docIds: [] };
  const deleted = [];
  const docIds = [];
  for (const [docId, docWanted] of targets) {
    const res = await repository().update(docId, (fresh) => {
      if (!fresh || fresh.kind === 'tombstone' || fresh.kind === 'seed-marker') return null;
      const freshOwner = fresh.owner || 'demo';
      if (!(freshOwner === who || freshOwner === 'demo')) return null;
      const nextClaims = (fresh.claims || []).filter((c) => !wanted.has(c.id));
      if (nextClaims.length === (fresh.claims || []).length) return null;
      const nextKeys = Object.fromEntries(
        Object.entries(fresh.idempotencyKeys || {}).filter(([, v]) => !wanted.has(v)),
      );
      const next = { ...fresh, claims: nextClaims, idempotencyKeys: nextKeys };
      next.report = buildReport(nextClaims);
      next.coverage = next.report.evidenceCoverage;
      return next;
    });
    if (!res.changed || !res.doc) continue;
    docIds.push(docId);
    for (const id of docWanted) {
      if (!(res.doc.claims || []).some((c) => c.id === id)) deleted.push(id);
    }
    emitDocumentChanged(docId);
  }
  return { deleted: [...new Set(deleted)], docIds };
}

export async function deleteHistoryEntry(owner = 'demo', claimId) {
  const id = String(claimId ?? '').trim();
  if (!id) return null;
  const out = await deleteHistoryEntries(owner, [id]);
  if (!out.deleted.length) return null;
  return { claimId: out.deleted[0], docId: out.docIds[0] || null };
}

export async function getHistoryEntry(owner = 'demo', claimId) {
  if (!claimId) return null;
  const all = visibleTo(await repository().loadAll(), owner || 'demo');
  for (const doc of all) {
    for (const claim of doc.claims || []) {
      if (claim?.id !== claimId) continue;
      if (!claim.verdict) return null;
      if (claim.status && claim.status !== 'verified') return null;
      const wf = workflowOf(doc, claim);
      return {
        claimId: claim.id, docId: doc.id, docTitle: doc.title, docKind: doc.kind,
        workflow: wf, text: claim.text, verdict: claim.verdict, judgedBy: claim.judgedBy,
        at: claim.history?.[claim.history.length - 1]?.at || doc.createdAt || '',
        claim, duplicateCount: 1, duplicates: [],
      };
    }
  }
  return null;
}

// One standalone check, with the same honesty rules as the verify
// routes. Demo verdicts are labelled demo. A live failure is left
// Unverifiable. Nothing falls back to a canned verdict.
function signalOf(opts) {
  if (!opts) return undefined;
  if (typeof AbortSignal !== 'undefined' && opts instanceof AbortSignal) return opts;
  if (typeof opts === 'object' && opts.signal instanceof AbortSignal) return opts.signal;
  return undefined;
}

export async function verifyStandalone(text, opts) {
  const clean = String(text || '').trim();
  const signal = signalOf(opts);
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Verification aborted before it started.');
  const status = liveStatus();
  if (!status.configured) {
    const base = await verifyClaim({ text: clean }, DEMO_EVIDENCE);
    return { ...base, mode: 'demo', models: getModels(), missing: status.missing };
  }
  try {
    const live = await verifyResearchedClaim(clean, { signal });
    return { ...live, models: getModels() };
  } catch (err) {
    return { ...liveFailedResult(clean, err), models: getModels() };
  }
}

/** @param {string | string[]} input @param {{ owner?: string, verifyOne?: (text: string, opts?: { signal?: AbortSignal }) => Promise<any>, signal?: AbortSignal, timeoutMs?: number }} [opts] */
export async function verifyClaimBatch(input, { owner = 'demo', verifyOne = verifyStandalone, signal, timeoutMs } = {}) {
  const texts = parseClaimBatch(input);
  if (signal?.aborted) return [];
  const results = new Array(texts.length);
  let next = 0;
  // Reject in-flight work as soon as the caller aborts, instead of
  // awaiting a slow verifyOne to completion and recording it anyway.
  let abortReject;
  const abortPromise = signal ? new Promise((_, reject) => { abortReject = reject; }) : null;
  const onAbort = () => abortReject?.(Object.assign(new Error('Batch verification was aborted.'), { name: 'AbortError' }));
  signal?.addEventListener('abort', onAbort, { once: true });
  const combinedForTask = () => {
    const timeoutSignal = timeoutMs && timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : null;
    if (signal && timeoutSignal && typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeoutSignal]);
    return signal || timeoutSignal || undefined;
  };
  const runOne = (text) => {
    const task = verifyOne(text, { signal: combinedForTask() });
    // A late-settling orphan must not surface as an unhandled rejection
    // once the race has moved on without it.
    Promise.resolve(task).catch(() => {});
    if ((!timeoutMs || timeoutMs <= 0) && !abortPromise) return task;
    let timer;
    const racers = [task];
    if (abortPromise) racers.push(abortPromise);
    if (timeoutMs && timeoutMs > 0) {
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`That check timed out after ${Math.round(timeoutMs / 1000)} seconds, so it was left unverified instead of stalling the batch.`)), timeoutMs);
        timer.unref?.();
      });
      racers.push(timeout);
    }
    return Promise.race(racers).finally(() => clearTimeout(timer));
  };
  const worker = async () => {
    while (next < texts.length) {
      if (signal?.aborted) break;
      const i = next++;
      const text = texts[i];
      try {
        if (text.length > CONFIG.MAX_CLAIM_CHARS) throw new Error(`Claim is longer than ${CONFIG.MAX_CLAIM_CHARS} characters.`);
        let result;
        try {
          result = await runOne(text);
        } catch (err) {
          if (signal?.aborted) break;
          if (/timed out/.test(err?.message || '')) {
            const timedOut = {
              text, type: classifyClaim(text), verdict: 'Unverifiable', judgedBy: 'Muse Spark 1.3',
              supporting: [], contradicting: [],
              explanation: 'That check timed out, so it was left unverified rather than stalling the batch.',
              limitations: [err.message],
            };
            const saved = await recordInvestigation({ owner, workflow: 'claim', result: timedOut });
            results[i] = { text, ok: true, result: timedOut, claimId: saved.claim.id, docId: saved.doc.id };
            continue;
          }
          throw err;
        }
        if (signal?.aborted) break;
        const saved = await recordInvestigation({ owner, workflow: 'claim', result });
        results[i] = { text, ok: true, result, claimId: saved.claim.id, docId: saved.doc.id };
      } catch (err) {
        results[i] = { text, ok: false, error: err?.message || 'Verification failed.' };
      }
    }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(CONFIG.DOCUMENT_CLAIM_CONCURRENCY, texts.length) || 0 }, worker));
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
  if (signal?.aborted) {
    return results.filter(Boolean);
  }
  return results;
}
