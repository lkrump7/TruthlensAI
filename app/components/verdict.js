import { useState } from 'react';
import { Icon } from './icons.js';
import { GaugeRing, StanceBar } from './forensic.js';
import { safeHttpUrl } from '../../lib/ui-state.mjs';

export const cls = (v) => `stamp v-${String(v).replaceAll(' ', '-')}`;
function EvidenceCard({ e, stance }) {
  const [copyNote, setCopyNote] = useState('');
  const href = safeHttpUrl(e.url);
  async function copyCitation() {
    const citation = `"${e.passage}" (${e.title}, ${e.source} ${e.date}${e.url ? `, ${e.url}` : ''})`;
    try {
      await navigator.clipboard.writeText(citation);
      setCopyNote('Copied');
    } catch { setCopyNote('Copy did not work here. Select the quote and copy it.'); }
  }
  return (
    <article className="ev" data-evidence-card>
      <div className="meta">{e.source} · {e.date}{stance && <span className="stance">{stance}</span>}</div>
      <h3>{e.title}</h3><p>“{e.passage}”</p>
      <p className="ev-actions">
        {href ? <a href={href} className="ev-link" target="_blank" rel="noreferrer">Open source</a> : <span className="small">No link for this source.</span>}{' '}
        <button type="button" className="btn secondary ev-copy" onClick={copyCitation}><Icon name="copy" />{copyNote === 'Copied' ? 'Copied' : 'Copy citation'}</button>
        {copyNote && copyNote !== 'Copied' && <span className="small" role="status"> {copyNote}</span>}
      </p>
    </article>
  );
}
export function Evidence({ items, empty, stance }) {
  if (!items?.length) return <p className="small">{empty}</p>;
  return items.map((e, i) => <EvidenceCard e={e} stance={stance} key={e.id || e.url || i} />);
}
const STAGE_LABELS = {
  triage: 'Looked at the claim',
  research: 'Found and loaded sources',
  researchNode: 'Found and loaded sources',
  judge: 'Read the sources and decided',
  gates: 'Made sure there was enough evidence',
  challenge: 'Second check of the answer',
  challengeNode: 'Second check of the answer',
  assemble: 'Wrote the final answer',
};
function stageSuffix(stage, r) {
  if (stage === 'judge' && r?.judgedBy) return ` (${r.judgedBy})`;
  if ((stage === 'research' || stage === 'researchNode') && r?.research) return ` (${r.research.fetched} loaded)`;
  return '';
}
export function InvestigationSteps({ stages, r }) {
  if (!stages?.length) return null;
  return (
    <details className="steps-details" data-trajectory>
      <summary>How we reached this verdict</summary>
      <ol className="stages">
        {stages.map((s, i) => <li key={i}>{STAGE_LABELS[s] || s}{stageSuffix(s, r)}</li>)}
      </ol>
    </details>
  );
}
const AGENT_FOR_STAGE = {
  triage: { role: 'System', task: 'Looked at the claim' },
  research: { role: 'Researcher', task: 'Found and loaded sources' },
  researchNode: { role: 'Researcher', task: 'Found and loaded sources' },
  judge: { role: 'Fact-checker', task: 'Read the sources and decided' },
  gates: { role: 'System', task: 'Made sure there was enough evidence' },
  challenge: { role: 'Skeptic', task: 'Second check of the answer' },
  challengeNode: { role: 'Skeptic', task: 'Second check of the answer' },
  assemble: { role: 'System', task: 'Wrote the final answer' },
};
export function AgentTimeline({ stages }) {
  if (!stages?.length) return null;
  return (
    <div data-live-stages aria-live="polite">
      <p className="small">Work so far. Each row is a real step done by the server.</p>
      <ol className="agents" data-agent-timeline>
        {stages.map((s, i) => {
          const agent = AGENT_FOR_STAGE[s.stage] || { role: 'System', task: STAGE_LABELS[s.stage] || s.stage };
          return (
            <li className="agent" data-agent={agent.role} key={i}>
              <span className="agent-dot" aria-hidden="true" />
              <span><span className="agent-role">{agent.role}</span><br /><span className="agent-task">{agent.task}{s.detail.model ? ` (${s.detail.model})` : s.stage === 'judge' && s.detail.judgedBy ? ` (${s.detail.judgedBy})` : ''}{s.stage === 'research' && typeof (s.detail.counts?.fetched ?? s.detail.fetched) === 'number' ? ` (${s.detail.counts?.fetched ?? s.detail.fetched} fetched)` : ''}</span></span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
export function UncertaintyMeters({ uncertainty }) {
  if (!uncertainty) return null;
  const pct = (score) => `${Math.round(Math.max(0, Math.min(1, Number(score) || 0)) * 100)}%`;
  return (
    <div className="meters" data-uncertainty-meter>
      <div className="gauge-row">
        <GaugeRing value={uncertainty.faithfulness.score} label="Citations with a clear side" />
        <GaugeRing value={uncertainty.evidenceStrength.score} label="Evidence strength" />
      </div>
      <div className="meter">
        <div className="meter-head"><span>Citations with a clear side: <strong>{uncertainty.faithfulness.label}</strong> ({uncertainty.faithfulness.detail})</span><span>{pct(uncertainty.faithfulness.score)}</span></div>
        <div className="meter-track"><div className="meter-fill" style={{ width: pct(uncertainty.faithfulness.score) }} /></div>
      </div>
      <div className="meter">
        <div className="meter-head"><span>Evidence strength: <strong>{uncertainty.evidenceStrength.label}</strong> ({uncertainty.evidenceStrength.detail})</span><span>{pct(uncertainty.evidenceStrength.score)}</span></div>
        <div className="meter-track"><div className="meter-fill blue" style={{ width: pct(uncertainty.evidenceStrength.score) }} /></div>
      </div>
      <p className="small">These are two different things. We do not mix them into one score.</p>
    </div>
  );
}
export function EvidenceBalance({ supporting, contradicting }) {
  const sup = supporting.length;
  const con = contradicting.length;
  const total = sup + con;
  return (
    <div className="balance" data-evidence-balance>
      <div className="balance-head"><span><strong style={{ color: 'var(--teal)' }}>{sup} for</strong></span><span><strong style={{ color: 'var(--rust)' }}>{con} against</strong></span><span>{total ? `${total} source quote${total === 1 ? '' : 's'} with a clear side` : 'No source quote has a classified stance yet.'}</span></div>
      {total > 0 && <div className="balance-bar" aria-hidden="true"><div className="balance-sup" style={{ width: `${(sup / total) * 100}%` }} /><div className="balance-con" style={{ width: `${(con / total) * 100}%` }} /></div>}
      {total > 0 && <StanceBar sup={sup} con={con} />}
    </div>
  );
}
export async function downloadReport(docId, claimId) {
  const res = await fetch('/api/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ docId, claimId }) });
  if (!res.ok) return false;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'truthlens-investigation.md';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return true;
}
export function VerdictSummary({ r, onOpenRecord }) {
  if (!r) return null;
  const sup = r.supporting?.length || 0;
  const con = r.contradicting?.length || 0;
  return (
    <section className="verdict-panel verdict-summary" data-verdict-summary>
      <span className={cls(r.verdict)}>{r.verdict}</span>
      <p className="summary-claim">{r.text}</p>
      <p>{r.explanation}</p>
      <p className="small">Checked by {r.judgedBy} · {sup} quotes for · {con} quotes against{sup + con === 1 ? '' : 's'}{r.uncertainty ? ` · Citations with a clear side ${r.uncertainty.faithfulness.label} · Evidence strength ${r.uncertainty.evidenceStrength.label}` : ''}</p>
      <p><button type="button" className="btn secondary" onClick={onOpenRecord}><Icon name="library" />See the full result</button>{' '}<span className="small">The evidence, scores, limits, and download are in the Library. This chat only shows the talk.</span></p>
    </section>
  );
}
export function dossierIdFor(text) {
  const s = String(text || '');
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    a = Math.imul(a ^ s.charCodeAt(i), 16777619) >>> 0;
    b = (Math.imul(b + s.charCodeAt(i), 31)) >>> 0;
  }
  return `TL-VER-${((a ^ b) >>> 0).toString(36).toUpperCase().padStart(5, '0').slice(-5)}`;
}

function ledgerShort(text) {
  const s = String(text || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0;
  const hex = h.toString(16).padStart(8, '0');
  return `${hex.slice(0, 4)}...${hex.slice(-4)}`;
}

const toneFor = (v) => {
  const s = String(v || '');
  if (s === 'Supported') return 'supported';
  if (s === 'Contradicted') return 'contradicted';
  if (s === 'Partially supported' || s === 'Misleading' || s === 'Outdated') return 'partial';
  return 'unver';
};

const pctOf = (score) => Math.round(Math.max(0, Math.min(1, Number(score) || 0)) * 100);

function DossierGauge({ value, top, bottom, tone }) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  const circle = 2 * Math.PI * 42;
  const offset = circle * (1 - pct / 100);
  return (
    <div className="metric-gauge" role="img" aria-label={`${bottom}: ${pct} percent`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r="42" fill="none" strokeWidth="8" className="metric-gauge-track" />
        <circle cx="50" cy="50" r="42" fill="none" strokeWidth="8" strokeLinecap="round" className={`metric-gauge-arc gauge-tone-${tone}`} strokeDasharray={circle.toFixed(2)} strokeDashoffset={offset.toFixed(2)} transform="rotate(-90 50 50)" />
      </svg>
      <div className="metric-gauge-center"><span className="metric-gauge-num">{top}</span><span className="metric-gauge-lab">{bottom}</span></div>
    </div>
  );
}

function archiveSpreadOf(r) {
  const years = [...(r?.supporting || []), ...(r?.contradicting || []), ...(r?.unclassified || [])]
    .map((e) => parseInt(String(e?.date || '').slice(0, 4), 10))
    .filter((y) => Number.isFinite(y) && y > 1500 && y < 2100);
  if (!years.length) return null;
  return `${Math.min(...years)} - ${Math.max(...years)}`;
}

function MatrixCard({ e, chip, chipClass, tone, stance }) {
  return (
    <article className={`matrix-card tone-${tone}`}>
      <div className="matrix-card-top">
        <span className="matrix-src">{e.source || 'Source on file'} · {e.date || 'date unknown'}</span>
        <span className={`chip ${chipClass}`}>{chip}</span>
      </div>
      <Evidence items={[e]} stance={stance} empty="" />
      <details className="excerpt">
        <summary>Inspect Context</summary>
        <p className="small">Source: {e.source || 'unknown'} · Date: {e.date || 'unknown'} · Recorded as: {stance}. {e.url ? 'The source link sits with the quote above.' : 'No link was kept for this source.'}</p>
      </details>
    </article>
  );
}

export function VerdictView({ r, docId, hideDownload, onRerun, onExport, onDebate, onAsk }) {
  const [downloadNote, setDownloadNote] = useState('');
  if (!r) return null;
  const supporting = r.supporting || [];
  const contradicting = r.contradicting || [];
  const unclassified = r.unclassified || [];
  const hasEvidence = supporting.length + contradicting.length + unclassified.length > 0;
  const sup = supporting.length;
  const con = contradicting.length;
  const amb = unclassified.length;
  const total = sup + con + amb;
  const decided = sup + con;
  const top = Math.max(sup, con);
  const alignPct = decided ? Math.round((top / decided) * 100) : 0;
  const tone = toneFor(r.verdict);
  const faithPct = r.uncertainty ? pctOf(r.uncertainty.faithfulness.score) : 0;
  const strengthPct = r.uncertainty ? pctOf(r.uncertainty.evidenceStrength.score) : 0;
  const strengthLabel = r.uncertainty ? r.uncertainty.evidenceStrength.label : null;
  const qualityBase = strengthLabel === 'high' ? 'High-Quality Base' : strengthLabel === 'medium' ? 'Medium-Quality Base' : strengthLabel === 'low' ? 'Low-Quality Base' : 'No Quality Base';
  const agreed = r.judges ? !!r.judges.agreed : (r.stability ? !!r.stability.agreed : true);
  const checkedAt = r.history?.length ? r.history[r.history.length - 1].at : null;
  const category = r.type && r.type !== 'Unclassified' ? r.type : 'General claim';
  const exportRef = (docId || r.historyDocId) && (r.id || r.historyClaimId);
  const citedTotal = total;
  const spread = archiveSpreadOf(r);
  const forensicsPass = r.forensics ? r.forensics.checks.filter((c) => c.status === 'pass').length : null;
  const effectCheck = r.forensics?.checks?.find((c) => c.name === 'effect-match');
  async function doExport() {
    setDownloadNote('');
    const ok = await downloadReport(docId || r.historyDocId, r.id || r.historyClaimId).catch(() => false);
    if (!ok) setDownloadNote('We could not download the report. Try again.');
  }
  return (
    <section className="verdict-panel dossier" data-verdict-panel data-dossier data-tone={tone}>
      <div className="audit-ribbon" data-audit-ribbon>
        <p className="dossier-kicker"><span><span className="live-dot" aria-hidden="true" />LIVE AUDIT DOSSIER</span><span>Category: {category} · Telemetry ID: {r.id || r.historyClaimId || dossierIdFor(r.text)}</span></p>
        <div className="audit-actions">
          {onRerun && <button type="button" className="btn secondary" onClick={onRerun}><Icon name="refresh" />Re-run Verification</button>}
          {(onExport || exportRef) && <button type="button" className="btn secondary" onClick={onExport || doExport}><Icon name="download" />Export Dossier</button>}
        </div>
      </div>
      <div className="dossier-claim" data-claim-card>
        <div>
          <p className="meta">INQUIRY STRING INGESTED{checkedAt ? ` · Timestamp: ${checkedAt}` : ''}</p>
          <p className="bigclaim">"{r.text}"</p>
          <p className="small">Target Source Profile: {r.type || 'Unclassified'}</p>
        </div>
        <div className="dossier-screen">
          <span className="meta">Sanitization Engine</span>
          <span className="screen-ok">Screened Before Scoring</span>
        </div>
      </div>
      <div className="adjudication" data-adjudication>
        <div className="adjudication-left">
          <p className="meta">Synthetic Adjudication</p>
          <p><span className={cls(r.verdict)}>{r.verdict}</span></p>
          <p className="small consensus">Consensus: <strong>{agreed ? '3 of 3 Agents Agree' : 'Agents Split — See Deliberation'}</strong></p>
          <p className="small mono">Ledger: {ledgerShort(r.text)}</p>
        </div>
        <div className="synthesis">
          <p className="synthesis-head"><span>Synthesis Summary</span><span>Evidence Strength: {strengthPct}%</span></p>
          <p>{r.explanation}</p>
        </div>
      </div>
      <InvestigationSteps stages={r.trajectory} r={r} />
      {r.stability && (r.stability.runs >= 2
        ? <p className="small">Checked {r.stability.runs} times on the same evidence. {r.stability.agreed ? 'Each check gave the same verdict.' : 'Runs disagreed, so we show the safer verdict.'} The verdicts were {r.stability.verdicts.join(', ')}.</p>
        : <p className="small">Checked once. No repeat run, so no agreement was measured.</p>)}
      {!hideDownload && (docId || r.historyDocId) && (r.id || r.historyClaimId) && <p><button type="button" className="btn secondary" onClick={async () => { setDownloadNote(''); const ok = await downloadReport(docId || r.historyDocId, r.id || r.historyClaimId).catch(() => false); if (!ok) setDownloadNote('We could not download the report. Try again.'); }}><Icon name="download" />Download report</button>{downloadNote && <span className="error" role="alert"> {downloadNote}</span>}</p>}
      <p className="small">Type: {r.type} · Checked by {r.judgedBy}{r.research ? ` · Sources: ${r.research.sourcesFound} sources found, ${r.research.fetched} loaded and used` : ''}</p>
      {r.research?.queries?.length > 0 && <p className="small">We searched for: {r.research.queries.join(' · ')}</p>}
      {r.judges && !r.judges.agreed && <div className="notice"><strong>The two checkers disagreed:</strong> Muse Spark said {r.judges.spark}; Muse Wonder said {r.judges.wonder}. We show the Wonder verdict.</div>}
      {r.challenge && <div className="notice"><strong>We changed our first verdict:</strong> at first we said {r.preChallengeVerdict}. Weakest evidence: {r.challenge.weakestEvidenceId || 'not named'}. What would prove it wrong: {r.challenge.falsifier} Other idea: {r.challenge.alternative} Still not clear: {r.challenge.unresolved}</div>}
      <div className="dossier-metrics" data-dossier-metrics>
        <div className="metric-card">
          <div className="metric-head">
            <div>
              <p className="meta">Metric 01 / Alignment</p>
              <h3 className="metric-title">Citation Alignment Score</h3>
              <p className="small">Share of classified quotes on the majority side</p>
            </div>
            <span className="concur-pill">{top}/{decided} Concur</span>
          </div>
          <div className="metric-body">
            <DossierGauge value={alignPct} top={`${alignPct}%`} bottom="Concordance" tone={tone} />
            <div className="metric-bars">
              <div className="metric-bar-row">
                <div className="metric-bar-top"><span>Contradicting Claims</span><span>{con} ({total ? Math.round((con / total) * 100) : 0}%)</span></div>
                <div className="bar-track"><div className="bar-fill red" style={{ width: `${total ? (con / total) * 100 : 0}%` }} /></div>
              </div>
              <div className="metric-bar-row">
                <div className="metric-bar-top"><span>Supporting Claims</span><span>{sup} ({total ? Math.round((sup / total) * 100) : 0}%)</span></div>
                <div className="bar-track"><div className="bar-fill green" style={{ width: `${total ? (sup / total) * 100 : 0}%` }} /></div>
              </div>
              <div className="metric-bar-row">
                <div className="metric-bar-top"><span>Ambiguous</span><span>{amb} ({total ? Math.round((amb / total) * 100) : 0}%)</span></div>
                <div className="bar-track"><div className="bar-fill gray" style={{ width: `${total ? (amb / total) * 100 : 0}%` }} /></div>
              </div>
            </div>
          </div>
          <EvidenceBalance supporting={r.supporting || []} contradicting={r.contradicting || []} />
          <p className="small metric-note">{decided ? `${top} of ${decided} classified quotes sit on the majority side.` : 'No classified quotes yet.'}</p>
        </div>
        <div className="metric-card">
          <div className="metric-head">
            <div>
              <p className="meta">Metric 02 / Robustness</p>
              <h3 className="metric-title">Evidence Strength Score</h3>
              <p className="small">Strength of the cited base behind this verdict</p>
            </div>
            <span className="concur-pill green">{qualityBase}</span>
          </div>
          <div className="metric-body">
            <DossierGauge value={strengthPct} top={`${strengthPct}/100`} bottom={strengthLabel ? `${strengthLabel} · Robust` : 'Robust'} tone="supported" />
            <div className="metric-bars">
              <div className="metric-bar-row">
                <div className="metric-bar-top"><span>Citations with a clear side</span><span>{faithPct}%</span></div>
                <div className="bar-track"><div className="bar-fill green" style={{ width: `${faithPct}%` }} /></div>
              </div>
              <div className="metric-bar-row">
                <div className="metric-bar-top"><span>Evidence strength</span><span>{strengthPct}%</span></div>
                <div className="bar-track"><div className="bar-fill green" style={{ width: `${strengthPct}%` }} /></div>
              </div>
              <div className="metric-bar-row">
                <div className="metric-bar-top"><span>Sources loaded</span><span>{r.research ? `${r.research.fetched} of ${r.research.sourcesFound}` : 'Not recorded'}</span></div>
                <div className="bar-track"><div className="bar-fill gray" style={{ width: `${r.research && r.research.sourcesFound ? Math.min(100, Math.round((r.research.fetched / r.research.sourcesFound) * 100)) : 0}%` }} /></div>
              </div>
              <div className="metric-bar-row">
                <div className="metric-bar-top"><span>Forensic checks passed</span><span>{forensicsPass === null ? 'Not run' : `${forensicsPass} of ${r.forensics.checks.length}`}</span></div>
                <div className="bar-track"><div className="bar-fill gray" style={{ width: `${forensicsPass === null ? 0 : Math.round((forensicsPass / Math.max(1, r.forensics.checks.length)) * 100)}%` }} /></div>
              </div>
            </div>
          </div>
          {r.uncertainty
            ? <><UncertaintyMeters uncertainty={r.uncertainty} />{r.calibration?.abstainAdvised && <p className="small">Our advice: do not trust this verdict yet. There is not enough evidence.</p>}</>
            : <p className="small">No strength score was recorded for this check.</p>}
          {r.forensics && <p className="small">{r.forensics.checks.map((c) => `${c.name}: ${c.status}`).join(' · ')}</p>}
        </div>
      </div>
      {r.historicalAssessment && <p><strong>In the past:</strong> {r.historicalAssessment}<br /><strong>Now:</strong> {r.currentAssessment}</p>}
      {r.history?.length > 1 && <p className="small"><strong>First verdict:</strong> {r.history[0].verdict} · <strong>Latest verdict:</strong> {r.history[r.history.length - 1].verdict} (checked again on {new Date(r.history[r.history.length - 1].at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })})</p>}
      {hasEvidence && <div data-evidence-matrix>
        <p className="meta">Forensic Cross-Examination</p>
        <h2 className="matrix-title">Dual-Lens Evidence Matrix</h2>
        <div className="matrix-legend"><span className="legend-dot dot-against" aria-hidden="true" /><span>Red: Against the Claim</span><span className="legend-sep">|</span><span className="legend-dot dot-context" aria-hidden="true" /><span>Blue: For or Unclear Context</span></div>
        <div className="evidence-matrix">
          <div className="matrix-col against">
            <div className="matrix-head"><h3>Evidence against the claim (Primary Corpus)</h3><span className="matrix-count">{con} Item{con === 1 ? '' : 's'} Verified</span></div>
            {contradicting.map((e, i) => <MatrixCard key={e.id || e.url || i} e={e} chip="CONTRADICTS" chipClass="chip-against" tone="against" stance="Against" />)}
            {!con && <Evidence items={[]} stance="Against" empty="We found no evidence that contradicts this claim." />}
          </div>
          <div className="matrix-col genealogy">
            <div className="matrix-head"><h3>Evidence for the claim (Genealogy & Context)</h3><span className="matrix-count">{sup + amb} Record{sup + amb === 1 ? '' : 's'} Tracked</span></div>
            {supporting.map((e, i) => <MatrixCard key={e.id || e.url || i} e={e} chip="SUPPORTS" chipClass="chip-for" tone="context" stance="For" />)}
            {unclassified.map((e, i) => <MatrixCard key={e.id || e.url || `u${i}`} e={e} chip="UNCLEAR" chipClass="chip-unclear" tone="context" stance="Unclear" />)}
            {sup + amb === 0 && <Evidence items={[]} stance="For" empty="We found no evidence that supports this claim." />}
          </div>
        </div>
      </div>}
      {r.unclassified?.length > 0 && <div><h3>Evidence we used, but its side is unclear</h3><Evidence items={r.unclassified} empty="" /></div>}
      {r.subclaims?.length > 0 && <div><h3>Parts of the claim</h3>{r.subclaims.map((s, i) => <p className="small" key={i}><span className={cls(s.verdict)}>{s.verdict}</span> {s.text}</p>)}</div>}
      {r.propositions?.length > 0 && <div><h3>Your idea, point by point</h3>{r.propositions.map((p, i) => <div className="notice" key={i} style={{ marginBottom: 8 }}><span className={cls(p.verdict)}>{p.verdict || 'Not judged'}</span> {p.text}<br /><span className="small">The author's position: <strong>{p.authorStance?.stance}</strong> — {p.authorStance?.reason} (This is our reading. It is not proof.)</span>{p.passages?.map((pg, j) => <p className="small" key={j}>Page {pg.page}: “{pg.passage}”</p>)}</div>)}</div>}
      {r.forensics && <div><div className="rule" /><h3>Checking the evidence</h3>
        {r.forensics.discrepancies.length === 0 ? <p className="small">We found no problems between the claim and its evidence.</p> : r.forensics.discrepancies.map((d, i) => <div className="notice" key={i} style={{ marginBottom: 8 }}><strong>{d.label}.</strong> {d.detail}</div>)}</div>}
      {r.limitations?.length > 0 && <div className="notice"><strong>Limits of this check:</strong> {r.limitations.join(' ')}</div>}
      {r.bookPassages?.length > 0 && <div><div className="rule" /><h3>{r.sourceUrl ? 'On this page' : 'In this book'}</h3>{r.authorStance && <p className="small">The author's position: <strong>{r.authorStance.stance}</strong> — {r.authorStance.reason} (This is our reading of the text. It is not proof.)</p>}{r.bookPassages.map((p, i) => {
        const passageHref = safeHttpUrl(p.url);
        return <article className="ev" key={i}><div className="meta">{passageHref ? <>Web page · <a href={passageHref} target="_blank" rel="noreferrer">Open source</a></> : `Page ${p.page}`}</div><p>“{p.passage}”</p></article>;
      })}</div>}
      {r.followups?.length > 0 && <div><div className="rule" /><h3>Follow-up checks</h3>{r.followups.map((f, i) => <div className="notice" key={i} style={{ marginBottom: 8 }}><strong>{{ 'stronger-contrary': 'Stronger evidence against it', 'prove-wrong': 'What would prove this wrong', 'stronger-support': 'Stronger evidence for it', 'prove-right': 'What would confirm this', 'compare-author': 'What the author says', custom: 'Your own question' }[f.kind] || f.kind}:</strong> {f.instruction}<br />{f.comparison ? <>Compared with the author. Current verdict: <strong>{f.verdict}</strong></> : <>New verdict: <strong>{f.verdict}</strong></>} — {f.explanation}{f.falsifier && <><br />What would prove it wrong: {f.falsifier} Found: <strong>{f.falsifierFound ? 'yes' : 'no'}</strong></>}{f.confirmer && <><br />What would prove it right: {f.confirmer} Found: <strong>{f.confirmerFound ? 'yes' : 'no'}</strong></>}{f.newSupporting?.length > 0 && <><br />New evidence for it: {f.newSupporting.length} from new sources.</>}{f.newOpposing?.length > 0 && <><br />New evidence against it: {f.newOpposing.length} from new sources.</>}{f.comparison?.passages?.map((p, j) => <p className="small" key={j}>Page {p.page}: “{p.passage}”</p>)}</div>)}</div>}
      <div className="agent-deliberation" data-agent-deliberation>
        <p className="meta">Dialectical Triad</p>
        <h2 className="matrix-title">Autonomous Agent Deliberation</h2>
        <p className="small">Three independent adversarial model personas interrogate source validity, citation chains, and publication bias before emitting final consensus tokens.</p>
        <div className="agent-cards">
          <div className="agent-card" data-agent="Researcher">
            <div className="agent-top"><span className="agent-ic" aria-hidden="true"><Icon name="search" /></span><span><span className="agent-name">The Researcher</span><br /><span className="agent-sub">Citation Harvester</span></span></div>
            <div className="agent-stats">
              <div><span>Retrieved Docs:</span><span>{r.research ? `${r.research.sourcesFound} found` : 'Not recorded'}</span></div>
              <div><span>Extracted Quotes:</span><span>{citedTotal} statements</span></div>
              <div><span>Archive Spread:</span><span>{spread || 'Not recorded'}</span></div>
            </div>
            <p className="small">{r.research ? `${r.research.fetched} sources loaded of ${r.research.sourcesFound} found.` : 'No research run was recorded.'}</p>
            <div className="agent-verdict"><span className="meta">AGENT VERDICT</span><span className={cls(r.verdict)}>{r.verdict}</span></div>
          </div>
          <div className="agent-card" data-agent="Fact-checker">
            <div className="agent-top"><span className="agent-ic" aria-hidden="true"><Icon name="verify" /></span><span><span className="agent-name">The Fact-Checker</span><br /><span className="agent-sub">Empirical Scrutiny</span></span></div>
            <div className="agent-stats">
              <div><span>Quotation Match:</span><span>{faithPct}%</span></div>
              <div><span>Cited Quotes:</span><span>{decided} decided</span></div>
              <div><span>Effect Check:</span><span>{effectCheck ? effectCheck.status : 'Not compared'}</span></div>
            </div>
            <p className="small">{r.judges ? `Muse Spark said ${r.judges.spark}; Muse Wonder said ${r.judges.wonder}.` : `Decided by ${r.judgedBy}.`}</p>
            <div className="agent-verdict"><span className="meta">AGENT VERDICT</span><span className={cls(r.verdict)}>{r.verdict}</span></div>
          </div>
          <div className="agent-card" data-agent="Skeptic">
            <div className="agent-top"><span className="agent-ic" aria-hidden="true"><Icon name="question" /></span><span><span className="agent-name">The Skeptic</span><br /><span className="agent-sub">Adversarial Probe</span></span></div>
            <div className="agent-stats">
              <div><span>Second Check:</span><span>{r.challenge ? 'Ran' : 'Not run'}</span></div>
              <div><span>Judge Runs:</span><span>{r.stability ? r.stability.runs : 1}</span></div>
              <div><span>Agreement:</span><span>{r.stability ? (r.stability.agreed ? 'Full' : 'Split') : 'Single run'}</span></div>
            </div>
            <p className="small">{r.challenge ? `Challenged first verdict ${r.preChallengeVerdict}. Still not clear: ${r.challenge.unresolved}` : 'No second check ran on this verdict.'}</p>
            <div className="agent-verdict"><span className="meta">AGENT VERDICT</span><span className={cls(r.verdict)}>{r.verdict}</span></div>
          </div>
        </div>
      </div>
      {(onDebate || onAsk) && <div className="interrogate" data-interrogate>
        <div>
          <h3 className="metric-title">Question This Verification</h3>
          <p className="small">Interrogate any agent on their reasoning, request raw citation transcripts, or test counter-evidence.</p>
        </div>
        <div className="interrogate-actions">
          {onDebate && <button type="button" className="btn secondary" onClick={onDebate}>Debate Claim</button>}
          {onAsk && <button type="button" className="btn" onClick={onAsk}>Ask Agents Anything</button>}
        </div>
      </div>}
      <div className="ledger" data-ledger>
        <span>Checked by {r.judgedBy}</span>
        <span>{r.judges ? `Spark ${r.judges.spark} · Wonder ${r.judges.wonder}` : 'Single-judge run'}</span>
        <span>{supporting.length + contradicting.length} cited quotes</span>
        <span>Ledger Ref: {ledgerShort(r.text)}</span>
      </div>
    </section>
  );
}

export function FollowupCard({ f }) {
  if (!f) return null;
  const label = { 'stronger-contrary': 'Stronger evidence against it', 'prove-wrong': 'What would prove this wrong', 'stronger-support': 'Stronger evidence for it', 'prove-right': 'What would confirm this', 'compare-author': 'What the author says', custom: 'Your question' }[f.kind] || f.kind;
  return (
    <div className="ev">
      <div className="meta">Follow-up check · {label}</div>
      <p>{f.comparison ? <>Current verdict: <span className={cls(f.verdict)}>{f.verdict}</span></> : <>New verdict: <span className={cls(f.verdict)}>{f.verdict}</span></>} — {f.explanation}</p>
      {f.falsifier && <p className="small">What would prove it wrong: {f.falsifier} Found: <strong>{f.falsifierFound ? 'yes' : 'no'}</strong></p>}
      {f.confirmer && <p className="small">What would prove it right: {f.confirmer} Found: <strong>{f.confirmerFound ? 'yes' : 'no'}</strong></p>}
      {f.newSupporting?.length > 0 && <><p className="small">New evidence for it, from new sources:</p><Evidence items={f.newSupporting} stance="For" empty="" /></>}
      {f.newOpposing?.length > 0 && <><p className="small">New evidence against it, from new sources:</p><Evidence items={f.newOpposing} stance="Against" empty="" /></>}
      {f.comparison?.passages?.map((pg, j) => <p className="small" key={j}>Page {pg.page}: “{pg.passage}”</p>)}
    </div>
  );
}
