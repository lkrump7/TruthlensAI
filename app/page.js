'use client';
import { useEffect, useState } from 'react';

const cls = (v) => `stamp v-${String(v).replaceAll(' ', '-')}`;
function Evidence({ items, empty }) {
  if (!items?.length) return <p className="small">{empty}</p>;
  return items.map((e) => (
    <article className="ev" key={e.id}>
      <div className="meta">{e.source} · {e.date}</div>
      <h3>{e.title}</h3><p>“{e.passage}”</p>
      <a href={e.url} target="_blank" rel="noreferrer">Open source ↗</a>
    </article>
  ));
}
function VerdictView({ r }) {
  if (!r) return null;
  return (
    <section>
      <span className={cls(r.verdict)}>{r.verdict}</span>
      <p className="bigclaim">{r.text}</p>
      <p className="small">Classified {r.type} · Judged by {r.judgedBy}{r.research ? ` · Research: ${r.research.sourcesFound} sources found, ${r.research.fetched} fetched & cited` : ''}</p>
      {r.research?.queries?.length > 0 && <p className="small">Search queries: {r.research.queries.join(' · ')}</p>}
      {r.judges && !r.judges.agreed && <div className="notice"><strong>Judges disagreed:</strong> Muse Spark said {r.judges.spark}; Muse Wonder said {r.judges.wonder}. Wonder’s verdict is shown.</div>}
      {r.challenge && <div className="notice"><strong>Self-correction:</strong> first verdict was {r.preChallengeVerdict}. Challenge — weakest evidence: {r.challenge.weakestEvidenceId || 'not named'}; falsifier: {r.challenge.falsifier} Alternative: {r.challenge.alternative} Unresolved: {r.challenge.unresolved}</div>}
      <p>{r.explanation}</p>
      {r.historicalAssessment && <p><strong>Historical:</strong> {r.historicalAssessment}<br /><strong>Current:</strong> {r.currentAssessment}</p>}
      {r.history?.length > 1 && <p className="small"><strong>Original assessment:</strong> {r.history[0].verdict} · <strong>Current assessment:</strong> {r.history[r.history.length - 1].verdict} (rechecked {new Date(r.history[r.history.length - 1].at).toLocaleDateString()})</p>}
      <div className="cols">
        <div><h3>Supporting evidence</h3><Evidence items={r.supporting} empty="No verified supporting passage was fetched." /></div>
        <div><h3>Contradicting evidence</h3><Evidence items={r.contradicting} empty="No verified contradicting passage was fetched." /></div>
      </div>
      {r.unclassified?.length > 0 && <div><h3>Cited — stance not classified by the judge</h3><Evidence items={r.unclassified} empty="" /></div>}
      {r.subclaims?.length > 0 && <div><h3>Atomic elements</h3>{r.subclaims.map((s, i) => <p className="small" key={i}><span className={cls(s.verdict)}>{s.verdict}</span> {s.text}</p>)}</div>}
      {r.forensics && <div><div className="rule" /><h3>Evidence Forensics</h3>
        {r.forensics.discrepancies.length === 0 ? <p className="small">No discrepancies found between the claim and its fetched evidence.</p> : r.forensics.discrepancies.map((d, i) => <div className="notice" key={i} style={{ marginBottom: 8 }}><strong>{d.label}.</strong> {d.detail}</div>)}
        <p className="small">{r.forensics.checks.map((c) => `${c.name}: ${c.status}`).join(' · ')}</p></div>}
      {r.limitations?.length > 0 && <div className="notice"><strong>Limits:</strong> {r.limitations.join(' ')}</div>}
    </section>
  );
}

export default function Home() {
  const [docs, setDocs] = useState([]); const [mode, setMode] = useState('demo');
  const [doc, setDoc] = useState(null); const [selected, setSelected] = useState(null);
  const [claim, setClaim] = useState('Humans only use 10% of their brains.');
  const [result, setResult] = useState(null); const [busy, setBusy] = useState('');
  const [title, setTitle] = useState(''); const [text, setText] = useState(''); const [err, setErr] = useState('');
  const [user, setUser] = useState(null); const [authName, setAuthName] = useState(''); const [authPass, setAuthPass] = useState('');
  const [contra, setContra] = useState([]);

  async function load() {
    const r = await fetch('/api/documents'); const d = await r.json();
    setDocs(d.documents || []); setMode(d.mode);
    fetch('/api/contradictions').then((r) => r.json()).then((c) => setContra(c.entries || [])).catch(() => {});
    if (!doc && d.documents?.[0]) setDoc(d.documents[0]);
  }
  useEffect(() => { load(); fetch('/api/auth').then((r) => r.json()).then((d) => setUser(d.user)).catch(() => {}); }, []);
  async function auth(action) {
    setErr('');
    const r = await fetch('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, username: authName, password: authPass }) });
    const d = await r.json();
    if (!r.ok) return setErr(d.error);
    setUser(d.user); setAuthPass(''); await load();
  }
  async function verify() {
    setBusy('verify'); setErr('');
    const r = await fetch('/api/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ claim }) });
    const d = await r.json(); setBusy('');
    if (!r.ok) return setErr(d.error);
    if (d.mode) setMode(d.mode);
    setResult(d); setSelected(null);
  }
  async function uploadFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(''); setBusy('doc');
    try {
      let d, r;
      if (/\.pdf$/i.test(file.name)) {
        const fd = new FormData(); fd.append('file', file); fd.append('title', title || file.name);
        r = await fetch('/api/documents/pdf', { method: 'POST', body: fd }); d = await r.json();
      } else {
        const txt = await file.text();
        r = await fetch('/api/documents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: title || file.name, text: txt }) }); d = await r.json();
      }
      setBusy('');
      if (!r.ok) return setErr(d.error || 'Upload failed.');
      await load(); setDoc(d.document); setSelected(null); setResult(null);
    } catch (err2) { setBusy(''); setErr(String(err2.message || err2)); }
    e.target.value = '';
  }
  async function addDoc() {
    setBusy('doc'); setErr('');
    const r = await fetch('/api/documents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, text }) });
    const d = await r.json(); setBusy('');
    if (!r.ok) return setErr(d.error);
    setText(''); setTitle(''); await load(); setDoc(d.document); setSelected(null); setResult(null);
  }
  const shown = selected || result;
  return (
    <main>
      <header className="mast">
        <div><div className="brand">Truth<em>Lens</em> AI</div><div className="tag">Don’t just read information. Investigate it, challenge it, discover the evidence behind it.</div></div>
        <div className="mode">{{ live: 'Meta Model API · Live', 'live-ready': 'Meta configured · Live judging on verify', 'live-failed': 'Live research failed · Claim left unverified' }[mode] || 'Demo engine · Add Meta API keys for live'}</div>
      </header>
      <div className="wrap" style={{ paddingBottom: 0 }}>
        {user ? <p className="small">Signed in as <strong>{user}</strong> — your documents are private to your account. <button className="btn secondary" onClick={() => auth('logout')}>Sign out</button></p>
        : <p className="small">
            <input type="text" placeholder="Username" value={authName} onChange={(e) => setAuthName(e.target.value)} style={{ width: 180, marginRight: 6 }} />
            <input type="password" placeholder="Password" value={authPass} onChange={(e) => setAuthPass(e.target.value)} style={{ width: 180, marginRight: 6 }} />
            <button className="btn secondary" onClick={() => auth('login')}>Sign in</button>{' '}
            <button className="btn secondary" onClick={() => auth('register')}>Register</button>
            <span> — or keep browsing the shared demo book.</span>
          </p>}
      </div>
      <div className="wrap">
        <div className="pipeline">{['Spark extracts', 'Vector index retrieves', 'Prompt Guard screens', 'Advocate vs Skeptic', 'Wonder judges'].map((s) => <span className="pipe" key={s}>{s}</span>)}</div>
        <div className="grid">
          <section>
            <h2>Verify a claim</h2>
            <input type="text" value={claim} onChange={(e) => setClaim(e.target.value)} aria-label="Claim to verify" />
            <p><button className="btn" onClick={verify} disabled={busy === 'verify'}>{busy === 'verify' ? 'Investigating…' : 'Verify this claim'}</button></p>
            <div className="rule" />
            <h2>Investigate a document</h2>
            <input type="text" placeholder="Document title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <p><textarea placeholder="Paste document text here. Separate pages with --- page ---" value={text} onChange={(e) => setText(e.target.value)} /></p>
            <button className="btn secondary" onClick={addDoc} disabled={busy === 'doc'}>{busy === 'doc' ? 'Extracting claims…' : 'Extract & investigate'}</button>
            <p><label className="small">Or upload a file (PDF with a text layer, or .txt/.md):<br /><input type="file" accept=".pdf,.txt,.md,text/plain,application/pdf" onChange={uploadFile} disabled={busy === 'doc'} /></label></p>
            {err && <div className="error">{err}</div>}
          </section>
          <aside>
            <h2>Documents</h2>
            {docs.map((d) => (
              <button className="doc" key={d.id} onClick={() => { setDoc(d); setSelected(null); }}>
                <h3>{d.title}</h3>
                <div className="stat"><span><b>{d.claims.length}</b>claims shown</span><span><b>{d.coverage}%</b>evidence coverage</span><span><b>{d.chunkCount}</b>chunks</span>{d.foundClaims > d.claims.length && <span><b>{d.deferredClaims}</b>deferred</span>}</div>
                {d.quarantined > 0 && <p className="small">Prompt Guard quarantined text on {d.quarantined} page(s).</p>}
              </button>
            ))}
            <p className="small">The demo book is seeded so judges can run the full script immediately: book claims first, then a typed claim through the same engine.</p>
          </aside>
        </div>
        {contra.length > 0 && !shown && <section><div className="rule" /><h2>Knowledge Contradiction Map</h2>{contra.map((e, i) => <div className="ev" key={i}><div className="meta">Topic · {e.topic} · {e.verifiedDisagreement ? 'Verified disagreement' : 'Positions — not yet verified'}</div>{e.positions.map((pos, j) => <p key={j}><strong>{pos.docTitle}</strong> (p{pos.page}): {pos.text} <span className={cls(pos.verdict)}>{pos.verdict}</span></p>)}<p className="small">{e.scopeNote}</p></div>)}</section>}
        {doc && !shown && (
          <section><div className="rule" /><h2>{doc.title}</h2>
            <p><button className="btn secondary" onClick={async () => { const r = await fetch(`/api/documents/${doc.id}/recheck`, { method: 'POST' }); const d = await r.json(); if (r.ok) { setDoc(d.document); await load(); } }}>Re-check with current evidence</button></p>
            {doc.report && <div className="ev"><h3>Evidence Intelligence Report</h3><p className="small">{doc.report.totalClaims} claims identified · {doc.report.investigated} investigated · coverage {doc.report.evidenceCoverage}% · {Object.entries(doc.report.distribution).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>
            {doc.report.highImpactDisputed.length > 0 && <><p><strong>High-impact disputed claims</strong></p>{doc.report.highImpactDisputed.map((h) => { const c = doc.claims.find((x) => x.id === h.id); return <button className="claim" key={h.id} onClick={() => c && setSelected(c)}><span>{h.text}</span><span className={cls(h.verdict)}>{h.verdict}</span></button>; })}</>}
            {doc.report.internalContradictions.length > 0 && <p className="small">Internal contradictions in this book: {doc.report.internalContradictions.map((c) => `p${c.page}`).join(', ')}</p>}</div>}
            {doc.claims.map((c) => (
              <button className="claim" key={c.id} onClick={() => setSelected(c)}>
                <span>{c.text}<br /><span className="small">Page{(c.pages?.length > 1) ? 's ' + c.pages.join(', ') : ' ' + c.page} · {c.type} · Judged by {c.judgedBy}{c.internalContradiction ? ' · Internal contradiction flagged' : ''}</span></span>
                <span className={cls(c.verdict)}>{c.verdict}</span>
              </button>
            ))}
          </section>
        )}
        {shown && <section><div className="rule" /><button className="btn secondary" onClick={() => { setSelected(null); setResult(null); }}>← Back to claims</button><VerdictView r={shown} /></section>}
      </div>
    </main>
  );
}
