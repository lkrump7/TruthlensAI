'use client';
import { useEffect, useRef, useState } from 'react';

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
      {r.uncertainty && <p className="small">Citation stance coverage: <strong>{r.uncertainty.faithfulness.label}</strong> ({r.uncertainty.faithfulness.detail}) · Evidence strength: <strong>{r.uncertainty.evidenceStrength.label}</strong> ({r.uncertainty.evidenceStrength.detail}){r.calibration?.abstainAdvised ? ' · Calibrated advice: abstain on this one.' : ''}</p>}
      {r.historicalAssessment && <p><strong>Historical:</strong> {r.historicalAssessment}<br /><strong>Current:</strong> {r.currentAssessment}</p>}
      {r.history?.length > 1 && <p className="small"><strong>Original assessment:</strong> {r.history[0].verdict} · <strong>Current assessment:</strong> {r.history[r.history.length - 1].verdict} (rechecked {new Date(r.history[r.history.length - 1].at).toLocaleDateString()})</p>}
      <div className="cols">
        <div><h3>Supporting evidence</h3><Evidence items={r.supporting} empty="No verified supporting passage was fetched." /></div>
        <div><h3>Contradicting evidence</h3><Evidence items={r.contradicting} empty="No verified contradicting passage was fetched." /></div>
      </div>
      {r.unclassified?.length > 0 && <div><h3>Cited — stance not classified by the judge</h3><Evidence items={r.unclassified} empty="" /></div>}
      {r.subclaims?.length > 0 && <div><h3>Atomic elements</h3>{r.subclaims.map((s, i) => <p className="small" key={i}><span className={cls(s.verdict)}>{s.verdict}</span> {s.text}</p>)}</div>}
      {r.propositions?.length > 0 && <div><h3>Your theory, proposition by proposition</h3>{r.propositions.map((p, i) => <div className="notice" key={i} style={{ marginBottom: 8 }}><span className={cls(p.verdict)}>{p.verdict || 'Not judged'}</span> {p.text}<br /><span className="small">Author's stance: <strong>{p.authorStance?.stance}</strong> — {p.authorStance?.reason} (Interpretation, not evidence.)</span>{p.passages?.map((pg, j) => <p className="small" key={j}>Page {pg.page}: “{pg.passage}”</p>)}</div>)}</div>}
      {r.forensics && <div><div className="rule" /><h3>Evidence Forensics</h3>
        {r.forensics.discrepancies.length === 0 ? <p className="small">No discrepancies found between the claim and its fetched evidence.</p> : r.forensics.discrepancies.map((d, i) => <div className="notice" key={i} style={{ marginBottom: 8 }}><strong>{d.label}.</strong> {d.detail}</div>)}
        <p className="small">{r.forensics.checks.map((c) => `${c.name}: ${c.status}`).join(' · ')}</p></div>}
      {r.limitations?.length > 0 && <div className="notice"><strong>Limits:</strong> {r.limitations.join(' ')}</div>}
      {r.bookPassages?.length > 0 && <div><div className="rule" /><h3>In this book</h3>{r.authorStance && <p className="small">Author's stance: <strong>{r.authorStance.stance}</strong> — {r.authorStance.reason} (Interpretation of the passages, not evidence.)</p>}{r.bookPassages.map((p, i) => <article className="ev" key={i}><div className="meta">Page {p.page}</div><p>“{p.passage}”</p></article>)}</div>}
      {r.followups?.length > 0 && <div><div className="rule" /><h3>Challenges</h3>{r.followups.map((f, i) => <div className="notice" key={i} style={{ marginBottom: 8 }}><strong>{f.kind}:</strong> {f.instruction}<br />{f.comparison ? <>Comparison — standing verdict: <strong>{f.verdict}</strong></> : <>Follow-up verdict: <strong>{f.verdict}</strong></>} — {f.explanation}{f.falsifier && <><br />Falsifier: {f.falsifier} Found: <strong>{f.falsifierFound ? 'yes' : 'no'}</strong></>}{f.comparison?.passages?.map((p, j) => <p className="small" key={j}>Page {p.page}: “{p.passage}”</p>)}</div>)}</div>}
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
  const idemKeys = useRef({});
  const idemKeyFor = (scope) => { if (!idemKeys.current[scope]) idemKeys.current[scope] = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`); return idemKeys.current[scope]; };
  const [theory, setTheory] = useState(''); const [challengeText, setChallengeText] = useState('');

  async function load() {
    const r = await fetch('/api/documents'); const d = await r.json();
    setDocs(d.documents || []); setMode(d.mode);
    fetch('/api/contradictions').then((r) => r.json()).then((c) => setContra(c.entries || [])).catch(() => {});
    if (!doc && d.documents?.[0]) setDoc(d.documents[0]);
  }
  useEffect(() => { load(); fetch('/api/auth').then((r) => r.json()).then((d) => setUser(d.user)).catch(() => {}); }, []);
  useEffect(() => {
    if (!docs.some((d) => d.status === 'verifying')) return;
    const t = setInterval(async () => { const r = await fetch('/api/documents'); const d = await r.json(); setDocs(d.documents || []); if (doc) { const fresh = (d.documents || []).find((x) => x.id === doc.id); if (fresh) setDoc(fresh); } }, 3000);
    return () => clearInterval(t);
  }, [docs, doc]);
  useEffect(() => {
    if (!doc?.id || typeof EventSource === 'undefined') return;
    const source = new EventSource(`/api/documents/${doc.id}/events`);
    source.onmessage = (event) => { try { const d = JSON.parse(event.data); if (d.document) { setDoc(d.document); setDocs((prev) => prev.map((x) => (x.id === d.document.id ? d.document : x))); } } catch { /* keep polling */ } };
    return () => source.close();
  }, [doc?.id]);
  async function auth(action) {
    setErr('');
    const r = await fetch('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, username: authName, password: authPass }) });
    const d = await r.json();
    if (!r.ok) return setErr(d.error);
    setUser(d.user); setAuthPass(''); await load();
  }
  async function verify() {
    setBusy('verify'); setErr('');
    try {
      const r = await fetch('/api/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ claim }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setErr(d.error || 'Verification failed. Try the claim again.');
      if (d.mode) setMode(d.mode);
      setResult(d); setSelected(null);
    } catch {
      setErr('Verification did not complete — the request failed or timed out. Try the claim again.');
    } finally { setBusy(''); }
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
  async function verifyClaim(c) {
    setBusy('claim'); setErr('');
    try {
      const r = await fetch(`/api/documents/${doc.id}/claims/${c.id}/verify`, { method: 'POST', headers: { 'idempotency-key': idemKeyFor(`verify:${c.id}`) } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setErr(d.error || 'Verification failed.');
      delete idemKeys.current[`verify:${c.id}`];
      setDoc(d.document); setSelected(d.claim);
    } catch { setErr('Verification did not complete — try again.'); } finally { setBusy(''); }
  }
  async function assess() {
    if (!theory.trim()) return setErr('Enter a claim or theory from the book first.');
    setBusy('assess'); setErr('');
    try {
      const r = await fetch(`/api/documents/${doc.id}/assess`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idemKeyFor(`assess:${doc.id}:${theory.trim()}`) }, body: JSON.stringify({ text: theory }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setErr(d.error || 'Investigation failed.');
      delete idemKeys.current[`assess:${doc.id}:${theory.trim()}`];
      setTheory(''); setDoc(d.document); setSelected(d.claim);
    } catch { setErr('Investigation did not complete — try again.'); } finally { setBusy(''); }
  }
  async function challenge(kind) {
    setBusy('challenge'); setErr('');
    try {
      const r = await fetch(`/api/documents/${doc.id}/claims/${selected.id}/challenge`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, text: challengeText }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setErr(d.error || 'Challenge failed.');
      setChallengeText(''); setSelected(d.claim);
      const fresh = await (await fetch('/api/documents')).json(); setDocs(fresh.documents || []); const fd = (fresh.documents || []).find((x) => x.id === doc.id); if (fd) setDoc(fd);
    } catch { setErr('Challenge did not complete — try again.'); } finally { setBusy(''); }
  }
  async function toggleAuto(paused) {
    const r = await fetch(`/api/documents/${doc.id}/auto`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paused }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) { setDoc(d.document); await load(); }
  }
  const shown = selected;
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
            {busy === 'verify' && <p className="small">Live research fetches and checks sources before judging — this can take 30–60 seconds. Keep this tab open; the verdict will appear right here.</p>}
            {result && !selected && <div data-result-inline><div className="rule" /><p><button className="btn secondary" onClick={() => setResult(null)}>Clear result</button></p><VerdictView r={result} /></div>}
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
                <div className="stat"><span><b>{d.claims.length}</b>claims</span><span><b>{d.coverage}%</b>evidence coverage</span><span><b>{d.chunkCount}</b>chunks</span>{d.report?.notYetVerified > 0 && <span><b>{d.report.notYetVerified}</b>not yet verified</span>}{d.status === 'verifying' && <span><b>…</b>verifying</span>}</div>
                {d.quarantined > 0 && <p className="small">Prompt Guard quarantined text on {d.quarantined} page(s).</p>}
              </button>
            ))}
            <p className="small">The demo book is seeded so judges can run the full script immediately: book claims first, then a typed claim through the same engine.</p>
          </aside>
        </div>
        {contra.length > 0 && !shown && <section><div className="rule" /><h2>Knowledge Contradiction Map</h2>{contra.map((e, i) => <div className="ev" key={i}><div className="meta">Topic · {e.topic} · {e.verifiedDisagreement ? 'Verified disagreement' : 'Positions — not yet verified'}</div>{e.positions.map((pos, j) => <p key={j}><strong>{pos.docTitle}</strong> (p{pos.page}): {pos.text} <span className={cls(pos.verdict)}>{pos.verdict}</span></p>)}<p className="small">{e.scopeNote}</p></div>)}</section>}
        {doc && !shown && (
          <section><div className="rule" /><h2>{doc.title}</h2>
            <p className="small">{doc.status === 'verifying' ? 'Automatic verification is running in the background — the top claims are being checked now. You can investigate below right away.' : doc.status === 'paused' ? 'Automatic verification is paused.' : 'Automatic verification finished.'} {doc.report ? `${doc.report.autoVerified ?? 0} automatically verified · ${doc.report.readerInvestigated ?? 0} investigated by you · ${doc.report.notYetVerified ?? 0} not yet verified.` : ''}</p>
            <p><button className="btn secondary" onClick={async () => { const r = await fetch(`/api/documents/${doc.id}/recheck`, { method: 'POST' }); const d = await r.json(); if (r.ok) { setDoc(d.document); await load(); } }}>Re-check with current evidence</button>{' '}{doc.autoPaused ? <button className="btn secondary" onClick={() => toggleAuto(false)}>Resume automatic verification</button> : <button className="btn secondary" onClick={() => toggleAuto(true)}>Pause automatic verification</button>}</p>
            <div className="ev"><h3>Investigate a claim or theory from this book</h3><p className="small">In your own words — even if the book never states it exactly. TruthLens finds the relevant passages, shows what the author says, and checks it against independent evidence.</p><textarea placeholder="e.g. The reservoir programme was mainly a political project, not a safety one." value={theory} onChange={(e) => setTheory(e.target.value)} /><p><button className="btn" onClick={assess} disabled={busy === 'assess'}>{busy === 'assess' ? 'Investigating…' : 'Investigate this'}</button>{busy === 'assess' && <span className="small"> Live research can take 30–60 seconds.</span>}</p></div>
            {doc.report && <div className="ev"><h3>Evidence Intelligence Report</h3><p className="small">{doc.report.totalClaims} claims identified · {doc.report.investigated} investigated · {doc.report.resolved ?? doc.report.investigated} resolved · coverage {doc.report.evidenceCoverage}% · {Object.entries(doc.report.distribution).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>
            {doc.report.highImpactDisputed.length > 0 && <><p><strong>High-impact disputed claims</strong></p>{doc.report.highImpactDisputed.map((h) => { const c = doc.claims.find((x) => x.id === h.id); return <button className="claim" key={h.id} onClick={() => c && setSelected(c)}><span>{h.text}</span><span className={cls(h.verdict)}>{h.verdict}</span></button>; })}</>}
            {doc.report.internalContradictions.length > 0 && <p className="small">Internal contradictions in this book: {doc.report.internalContradictions.map((c) => `p${c.page}`).join(', ')}</p>}</div>}
            {doc.claims.map((c) => c.status === 'verified' || !c.status ? (
              <button className="claim" key={c.id} onClick={() => setSelected(c)}>
                <span>{c.text}<br /><span className="small">Page{(c.pages?.length > 1) ? 's ' + c.pages.join(', ') : ' ' + c.page} · {c.type} · Judged by {c.judgedBy}{c.source === 'reader-submitted' ? ' · Your investigation' : c.source === 'reader-pick' ? ' · Verified by you' : ''}{c.internalContradiction ? ' · Internal contradiction flagged' : ''}</span></span>
                <span className={cls(c.verdict)}>{c.verdict}</span>
              </button>
            ) : (
              <div className="claim" key={c.id}>
                <span>{c.text}<br /><span className="small">Page{(c.pages?.length > 1) ? 's ' + c.pages.join(', ') : ' ' + c.page} · {c.type}</span></span>
                <span><span className="stamp v-Unverifiable">{c.status === 'pending' ? 'Verifying…' : 'Not yet verified'}</span>{' '}<button className="btn secondary" onClick={() => verifyClaim(c)} disabled={busy === 'claim'}>Verify this claim</button></span>
              </div>
            ))}
          </section>
        )}
        {shown && <section><div className="rule" /><button className="btn secondary" onClick={() => { setSelected(null); setResult(null); }}>← Back to claims</button><VerdictView r={shown} />{doc && shown.id && <div className="ev"><h3>Challenge this finding</h3><p className="small">The original verdict stays on record; the follow-up is added below it.</p><p><button className="btn secondary" onClick={() => challenge('stronger-contrary')} disabled={busy === 'challenge'}>Find stronger opposing evidence</button>{' '}<button className="btn secondary" onClick={() => challenge('prove-wrong')} disabled={busy === 'challenge'}>What would prove this wrong?</button>{' '}<button className="btn secondary" onClick={() => challenge('compare-author')} disabled={busy === 'challenge'}>Compare with the author</button></p><p><input type="text" placeholder="Or describe your own challenge…" value={challengeText} onChange={(e) => setChallengeText(e.target.value)} /> <button className="btn secondary" onClick={() => challenge('custom')} disabled={busy === 'challenge'}>Investigate</button>{busy === 'challenge' && <span className="small"> Investigating…</span>}</p></div>}</section>}
      </div>
    </main>
  );
}
