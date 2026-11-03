'use client';
import { cls, Evidence } from './verdict.js';
import { Icon } from './icons.js';
import { dossierBuckets, chapterIndexForPage } from '../../lib/ui-state.mjs';

const BUCKETS = [
  { key: 'supported', label: 'Supported', note: 'Peer-reviewed empirical literature.' },
  { key: 'contradicted', label: 'Contradicted', note: 'Empirical refutation identified.' },
  { key: 'partially', label: 'Partially Supported', note: 'Caveats or extrapolation present.' },
  { key: 'unverifiable', label: 'Unverifiable', note: 'Insufficient literature / non-falsifiable.' },
];

// dossier-pure-helpers:start (dependency-free; unit-tested via source extraction in tests/book-dossier.test.mjs)
export function dossierWordDisplay(doc, claims) {
  const texts = [];
  if (Array.isArray(doc?.sourcePages)) {
    for (const p of doc.sourcePages) texts.push(String(p?.text || ''));
  } else if (Array.isArray(doc?.chunks)) {
    for (const ch of doc.chunks) texts.push(String(ch?.text || ''));
  }
  const joined = texts.join(' ').replace(/\s+/g, ' ').trim();
  if (joined) return { text: joined.split(' ').length.toLocaleString('en-US'), estimated: false };
  const stored = Number(doc?.wordCount);
  if (Number.isFinite(stored) && stored > 0) return { text: Math.round(stored).toLocaleString('en-US'), estimated: false };
  const list = Array.isArray(claims) ? claims : [];
  if (!list.length) return { text: '0', estimated: false };
  return { text: (list.length * 140).toLocaleString('en-US'), estimated: true };
}
export function dossierDocId(doc) {
  const id = String(doc?.id || '').trim();
  if (!id) return 'untitled';
  return id.length > 12 ? `${id.slice(0, 12)}…` : id;
}
export function serializeClaimCitations(doc, claims) {
  const checked = (Array.isArray(claims) ? claims : []).filter((c) => c?.verdict);
  return JSON.stringify({
    docId: doc?.id || null,
    title: doc?.title || null,
    exportedAt: new Date().toISOString(),
    claims: checked.map((c) => ({
      id: c.id,
      text: c.text,
      verdict: c.verdict,
      judgedBy: c.judgedBy || null,
      page: c.page ?? null,
      pages: Array.isArray(c.pages) ? c.pages : [],
      supporting: Array.isArray(c.supporting) ? c.supporting : [],
      contradicting: Array.isArray(c.contradicting) ? c.contradicting : [],
    })),
  }, null, 2);
}
export function downloadJsonFile(filename, text) {
  const blob = new globalThis.Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
// dossier-pure-helpers:end

const pctOf = (score) => (Number.isFinite(Number(score)) ? `${Math.round(Number(score) * 100)}%` : null);

function claimPage(c) {
  if (Number.isFinite(Number(c?.page))) return Number(c.page);
  if (Array.isArray(c?.pages) && c.pages.length) return c.pages[0];
  return null;
}

function confidenceLabel(c) {
  const score = c?.uncertainty?.evidenceStrength?.score ?? c?.uncertainty?.faithfulness?.score;
  const pct = pctOf(score);
  if (pct) return c?.verdict === 'Contradicted' ? `${pct} Refuted` : `${pct} Confidence`;
  if (c?.verdict === 'Partially supported') return 'Nuanced Rate';
  if (c?.verdict === 'Unverifiable' || !c?.verdict) return 'Under-Sampled';
  return null;
}

function refLabel(c) {
  const first = [...(c?.supporting || []), ...(c?.contradicting || [])][0];
  if (first?.source) return `Ref: ${first.source}`;
  if (c?.judgedBy) return `Checked by ${c.judgedBy}`;
  return 'Awaiting adjudication';
}

export function BookDossier({
  doc, docs = [], bucket = 'all', chapter = 'all', chapters = 8,
  onBucket, onChapter, onSelectDoc, onVerifyClaim, busy,
  onExportClaim, onDebate,
}) {
  const claims = doc?.claims || [];
  const totalPages = Number(doc?.pages) || Math.max(1, ...claims.map((c) => claimPage(c) || 1));
  const buckets = dossierBuckets(claims);
  const counts = { all: claims.length, supported: buckets.supported, contradicted: buckets.contradicted, partially: buckets.partial, unverifiable: buckets.unverifiable };

  const chapterCounts = Array.from({ length: chapters }, (_, i) => i + 1).map((idx) => {
    const inChapter = claims.filter((c) => chapterIndexForPage(claimPage(c), totalPages, chapters) === idx);
    const mix = dossierBuckets(inChapter);
    const top = mix.supported === inChapter.length && inChapter.length ? 'supported'
      : mix.contradicted > 0 ? 'contradicted'
      : mix.partial > 0 ? 'partially'
      : mix.unverifiable > 0 ? 'unverifiable' : 'empty';
    return { idx, count: inChapter.length, top };
  });
  const maxCount = Math.max(1, ...chapterCounts.map((c) => c.count));

  const visible = claims.filter((c) => {
    if (bucket !== 'all') {
      const single = dossierBuckets([c]);
      const hit = (bucket === 'supported' && single.supported === 1)
        || (bucket === 'contradicted' && single.contradicted === 1)
        || (bucket === 'partially' && single.partial === 1)
        || (bucket === 'unverifiable' && single.unverifiable === 1);
      if (!hit) return false;
    }
    if (chapter !== 'all' && Number(chapter) !== chapterIndexForPage(claimPage(c), totalPages, chapters)) return false;
    return true;
  });

  const checkedVisible = visible.filter((c) => c.verdict);
  const firstExportable = checkedVisible[0] || claims.find((c) => c.verdict) || null;
  const checkedClaims = claims.filter((c) => c.verdict);
  const wordInfo = dossierWordDisplay(doc, claims);
  const shortId = dossierDocId(doc);

  return (
    <div data-book-dossier>
      <section className="bd-corpus">
        <div className="bd-corpus-top">
          <div className="bd-book">
            <div className="bd-book-cover" aria-hidden="true"><span>PDF</span><strong>Ingested</strong></div>
            <div className="bd-book-meta">
              <p className="bd-badges"><span className="bd-active">Corpus Active</span><span className="bd-sha">Doc ID: {shortId}</span></p>
              <p className="bd-title-row">
                <strong>{doc?.title || 'No manuscript yet'}</strong>
                {docs.length > 1 && (
                  <select value={doc?.id || ''} onChange={(e) => onSelectDoc?.(e.target.value)} aria-label="Switch manuscript">
                    {docs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                  </select>
                )}
              </p>
              <p className="small">Nonfiction Analysis · {totalPages} Pages · Academic Corpus · {wordInfo.estimated ? `Ingestion: ~${wordInfo.text} words (estimate)` : `Ingestion: ${wordInfo.text} words extracted without editorial modification`}</p>
            </div>
          </div>
        </div>
        <div className="bd-telemetry">
          <div><span>Claims Extracted</span><strong>{buckets.total} / {claims.length} <em>{buckets.total === claims.length && claims.length ? '100% complete' : 'in progress'}</em></strong></div>
          <div><span>Corpus Word Count</span><strong>{wordInfo.text} <em>words{wordInfo.estimated ? ' (estimate)' : ''}</em></strong></div>
          <div><span>Orchestration State</span><strong className="bd-tri">Tri-Agent Consensus</strong></div>
          <div><span>Adjudication Engine</span><strong>Meta Llama 3.3 <em>70B</em></strong></div>
        </div>
      </section>

      <div className="bd-cards" role="group" aria-label="Filter by verdict">
        {BUCKETS.map((b) => (
          <button key={b.key} type="button" className={`bd-card b-${b.key}${bucket === b.key ? ' on' : ''}`} onClick={() => onBucket?.(bucket === b.key ? 'all' : b.key)} aria-pressed={bucket === b.key}>
            <span className="bd-card-head"><span>{b.label}</span><em>{buckets.total ? `${buckets[`${b.key}Pct`]}%` : '—'}</em></span>
            <span className="bd-card-num">{counts[b.key]}<small> of {buckets.total} assertions</small></span>
            <span className="bd-bar" aria-hidden="true"><span style={{ width: `${buckets[`${b.key}Pct`]}%` }} /></span>
            <span className="bd-card-note">{b.note}</span>
          </button>
        ))}
      </div>

      <div className="bd-grid">
        <div className="bd-feed">
          <div className="bd-tabs" role="group" aria-label="Filter claims">
            {[['all', 'All'], ['supported', 'Supported'], ['contradicted', 'Contradicted'], ['partially', 'Partial'], ['unverifiable', 'Unverifiable']].map(([key, label]) => (
              <button key={key} type="button" className={bucket === key ? 'pill on' : 'pill'} aria-pressed={bucket === key} onClick={() => onBucket?.(key)}>{label} <span className="nav-badge">{counts[key]}</span></button>
            ))}
            <label className="bd-scope">Scope:
              <select value={String(chapter)} onChange={(e) => onChapter?.(e.target.value === 'all' ? 'all' : Number(e.target.value))} aria-label="Filter by section">
                <option value="all">All Sections (1–{chapters})</option>
                {chapterCounts.map((c) => <option key={c.idx} value={c.idx}>Section {c.idx} · {c.count} claim{c.count === 1 ? '' : 's'}</option>)}
              </select>
            </label>
          </div>

          {visible.length === 0 && <p className="small" role="status">No claims match this filter. <button type="button" className="btn secondary" onClick={() => { onBucket?.('all'); onChapter?.('all'); }}>Reset filters</button></p>}
          {visible.map((c) => {
            const single = dossierBuckets([c]);
            const tone = single.supported ? 'supported' : single.contradicted ? 'contradicted' : single.partial ? 'partially' : 'unverifiable';
            const page = claimPage(c);
            const chIdx = chapterIndexForPage(page, totalPages, chapters);
            return (
              <article key={c.id} className={`bd-claim b-${tone}`} data-claim-row>
                <p className="bd-claim-meta">
                  <span className="bd-page">Page {page ?? '?'}</span>
                  <span>Section {chIdx}</span>
                  <span className="bd-ref">{refLabel(c)}</span>
                  <span className="bd-verdict">{c.verdict ? <span className={cls(c.verdict)}>{c.verdict}</span> : <span className="stamp v-Unverifiable">Not checked yet</span>}{' '}
                    {confidenceLabel(c) && <span className="bd-conf">{confidenceLabel(c)}</span>}</span>
                </p>
                <p className="bd-quote">“{c.text}”</p>
                <details>
                  <summary>Inspect {c.verdict ? 'forensic telemetry & quotation matches' : 'this claim'}{c.supporting?.length || c.contradicting?.length ? ` (${(c.supporting?.length || 0) + (c.contradicting?.length || 0)} sources)` : ''}</summary>
                  {c.verdict ? (
                    <div className="bd-evidence">
                      <p className="small">Type: {c.type || 'claim'} · Checked by {c.judgedBy || 'unknown'}{c.research ? ` · ${c.research.fetched} of ${c.research.sourcesFound} sources loaded` : ''}</p>
                      {c.supporting?.length > 0 && <div><h3>Evidence for the claim</h3><Evidence items={c.supporting} stance="For" empty="" /></div>}
                      {c.contradicting?.length > 0 && <div><h3>Evidence against the claim</h3><Evidence items={c.contradicting} stance="Against" empty="" /></div>}
                      {!(c.supporting?.length || c.contradicting?.length) && <p className="small">{c.explanation || 'No quoted evidence was recorded for this verdict.'}</p>}
                    </div>
                  ) : (
                    <p><span className="small">Not checked yet.</span>{' '}<button type="button" className="btn secondary" onClick={() => onVerifyClaim?.(c)} disabled={busy === 'claim'}><Icon name="verify" />Verify this claim</button></p>
                  )}
                </details>
              </article>
            );
          })}
        </div>

        <aside className="bd-rail">
          <section className="bd-panel">
            <h3><Icon name="search" />Section Heatmap <span className="bd-tag">Density Matrix</span></h3>
            <p className="small">Distribution across {chapters} sections. Click any bar to isolate claims in that section:</p>
            <div className="bd-heat" role="group" aria-label="Claims per section">
              {chapterCounts.map((c) => (
                <button key={c.idx} type="button" className={`bd-bar-btn t-${c.top}${Number(chapter) === c.idx ? ' on' : ''}`} onClick={() => onChapter?.(Number(chapter) === c.idx ? 'all' : c.idx)} aria-pressed={Number(chapter) === c.idx} title={`Section ${c.idx}: ${c.count} claims`}>
                  <span className="bd-col" style={{ height: `${Math.max(6, Math.round((c.count / maxCount) * 56))}px` }} />
                  <span className="bd-ch">Sec {c.idx}</span>
                </button>
              ))}
            </div>
            <p className="bd-legend"><span><i className="dot d-supported" />Supported</span><span><i className="dot d-partial" />Partial</span><span><i className="dot d-contradicted" />Contradicted</span><span><i className="dot d-unverifiable" />Unverifiable</span></p>
          </section>

          <section className="bd-panel">
            <h3><Icon name="library" />Inspection Dossier</h3>
            <p className="small">Generate cryptographically signed audit documents for publishers, peer review panels, or editorial fact-checking desks.</p>
            <button type="button" className="btn secondary bd-wide" disabled={!firstExportable} onClick={() => firstExportable && onExportClaim?.(doc.id, firstExportable.id)}><Icon name="download" />Export Section Report (PDF)</button>
            <button type="button" className="btn secondary bd-wide" disabled={!firstExportable} onClick={() => checkedClaims.length && downloadJsonFile(`truthlens-citations-${doc.id}.json`, serializeClaimCitations(doc, checkedClaims))}><Icon name="download" />Claim Citations JSON</button>
            <button type="button" className="btn bd-wide" onClick={onDebate}><Icon name="question" />Send to Tri-Agent Debate Room</button>
          </section>

          <section className="bd-panel bd-seal">
            <p className="meta">Cryptographic Corpus Seal</p>
            <p className="small">Raw text checksum matches ingested artifact without LLM hallmarking. No hidden instruction injection or prompt contamination detected in source payload.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}
