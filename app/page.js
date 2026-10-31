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
function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); writeStr(8, 'WAVE'); writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  writeStr(36, 'data'); view.setUint32(40, samples.length * 2, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++, off += 2) { const s = Math.max(-1, Math.min(1, samples[i])); view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Blob([view], { type: 'audio/wav' });
}
function resampleTo(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) out[i] = samples[Math.floor(i * ratio)];
  return out;
}
function MicButton({ onText, label = 'Dictate' }) {
  const [state, setState] = useState('idle');
  const [note, setNote] = useState('');
  const rec = useRef(null);
  async function start() {
    if (state === 'listening' || state === 'working') return;
    setNote('');
    if (!navigator?.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') return setNote('Voice dictation is not supported in this browser. Type instead.');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx = new AudioContext();
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const frames = [];
      processor.onaudioprocess = (e) => frames.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      source.connect(processor); processor.connect(ctx.destination);
      rec.current = { stream, ctx, processor, source, frames, rate: ctx.sampleRate };
      setState('listening');
    } catch { setNote('Microphone access was refused. Allow it in the browser, or type instead.'); }
  }
  async function stop() {
    if (state !== 'listening' || !rec.current) return;
    const { stream, ctx, processor, source, frames, rate } = rec.current;
    rec.current = null;
    try { processor.disconnect(); source.disconnect(); } catch { /* already closed */ }
    stream.getTracks().forEach((t) => t.stop());
    const total = frames.reduce((n, c) => n + c.length, 0);
    const merged = new Float32Array(total);
    let at = 0; for (const c of frames) { merged.set(c, at); at += c.length; }
    ctx.close().catch(() => {});
    if (!total) { setState('idle'); return setNote('No speech was heard. Hold the button, speak, then release.'); }
    setState('working');
    try {
      const wav = encodeWav(resampleTo(merged, rate, 24000), 24000);
      const fd = new FormData(); fd.append('audio', wav, 'dictation.wav');
      const r = await fetch('/api/transcribe', { method: 'POST', body: fd });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setNote(d.error || 'Transcription failed. Type instead.');
      else if (d.transcript) onText(d.transcript);
    } catch { setNote('Transcription did not complete. Type instead.'); } finally { setState('idle'); }
  }
  return (
    <span data-mic>
      <button type="button" className="btn secondary" aria-label={`${label} with Muse Voice Transcribe. Hold to speak, release to fill the box.`}
        onPointerDown={(e) => { e.preventDefault(); start(); }} onPointerUp={stop} onPointerLeave={() => { if (state === 'listening') stop(); }}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); start(); } }}
        onKeyUp={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); stop(); } }}
        disabled={state === 'working'}>
        {state === 'listening' ? 'Listening… release to fill the box' : state === 'working' ? 'Transcribing…' : label}
      </button>
      <span className="small"> Hold and speak. Muse Voice Transcribe fills the box, then you can edit it. </span>
      {note && <span className="small" role="status">{note}</span>}
    </span>
  );
}
const STAGE_LABELS = {
  triage: 'Checked what kind of claim this is',
  research: 'Searched and fetched sources',
  researchNode: 'Searched and fetched sources',
  judge: 'Judged the fetched passages',
  gates: 'Applied the evidence gates',
  challenge: 'Skeptic check on the verdict',
  challengeNode: 'Skeptic check on the verdict',
  assemble: 'Put the verdict together',
};
function stageSuffix(stage, r) {
  if (stage === 'judge' && r?.judgedBy) return ` (${r.judgedBy})`;
  if ((stage === 'research' || stage === 'researchNode') && r?.research) return ` (${r.research.fetched} fetched)`;
  return '';
}
function InvestigationSteps({ stages, r }) {
  if (!stages?.length) return null;
  return (
    <div data-trajectory>
      <h3>How this verdict was reached</h3>
      <ol className="stages">
        {stages.map((s, i) => <li key={i}>{STAGE_LABELS[s] || s}{stageSuffix(s, r)}</li>)}
      </ol>
    </div>
  );
}
async function downloadReport(docId, claimId) {
  const res = await fetch('/api/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ docId, claimId }) });
  if (!res.ok) return;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'truthlens-investigation.md'; a.click();
  URL.revokeObjectURL(url);
}
function VerdictView({ r, docId }) {
  if (!r) return null;
  return (
    <section>
      <span className={cls(r.verdict)}>{r.verdict}</span>
      <p className="bigclaim">{r.text}</p>
      <InvestigationSteps stages={r.trajectory} r={r} />
      {r.stability && (r.stability.runs >= 2
        ? <p className="small">Judged {r.stability.runs} times on the same evidence. {r.stability.agreed ? 'Every run gave the same verdict.' : 'Runs disagreed, so the verdict above is the cautious one.'} The runs gave {r.stability.verdicts.join(', ')}.</p>
        : <p className="small">Judged once on the fetched evidence. No repeat run, so no agreement was measured.</p>)}
      {docId && r.id && <p><button type="button" className="btn secondary" onClick={() => downloadReport(docId, r.id)}>Download report</button></p>}
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
      {r.bookPassages?.length > 0 && <div><div className="rule" /><h3>{r.sourceUrl ? 'On this page' : 'In this book'}</h3>{r.authorStance && <p className="small">Author's stance: <strong>{r.authorStance.stance}</strong> — {r.authorStance.reason} (Interpretation of the passages, not evidence.)</p>}{r.bookPassages.map((p, i) => <article className="ev" key={i}><div className="meta">{p.url ? <>Web page · <a href={p.url} target="_blank" rel="noreferrer">Open source</a></> : `Page ${p.page}`}</div><p>“{p.passage}”</p></article>)}</div>}
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
  const [user, setUser] = useState(null); const [authOn, setAuthOn] = useState(false); const [authName, setAuthName] = useState(''); const [authPass, setAuthPass] = useState('');
  const [contra, setContra] = useState([]);
  const [tab, setTab] = useState('check');
  const [assessDocId, setAssessDocId] = useState(''); const [assessResult, setAssessResult] = useState(null);
  const [tool, setTool] = useState('claim'); const [turns, setTurns] = useState([]);
  const idemKeys = useRef({});
  const idemKeyFor = (scope) => { if (!idemKeys.current[scope]) idemKeys.current[scope] = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`); return idemKeys.current[scope]; };
  const [theory, setTheory] = useState(''); const [challengeText, setChallengeText] = useState('');
  const [liveStages, setLiveStages] = useState([]); const [streamNote, setStreamNote] = useState('');
  const [siteUrl, setSiteUrl] = useState('');

  async function load() {
    const r = await fetch('/api/documents'); const d = await r.json();
    setDocs(d.documents || []); setMode(d.mode);
    fetch('/api/contradictions').then((r) => r.json()).then((c) => setContra(c.entries || [])).catch(() => {});
    if (!doc && d.documents?.[0]) setDoc(d.documents[0]);
  }
  useEffect(() => { load(); fetch('/api/auth').then((r) => r.json()).then((d) => { setUser(d.user); setAuthOn(!!d.authEnabled); }).catch(() => {}); }, []);
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
    setBusy('verify'); setErr(''); setLiveStages([]); setStreamNote('');
    const applyResult = (d) => {
      if (d.mode) setMode(d.mode);
      if (result) setTurns((t) => [...t, result]);
      setResult(d); setSelected(null);
    };
    try {
      const r = await fetch('/api/verify/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ claim }) });
      if (!r.ok || !r.body) throw new Error('stream unavailable');
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let gotVerdict = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';
        for (const part of parts) {
          const line = part.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          let event;
          try { event = JSON.parse(line.slice(6)); } catch { continue; }
          if (event.kind === 'progress') setLiveStages((s) => [...s, { stage: event.stage, detail: event.detail || {} }]);
          else if (event.kind === 'verdict') { gotVerdict = true; applyResult(event.result); }
          else if (event.kind === 'error') throw new Error(event.error || 'stream failed');
        }
      }
      if (!gotVerdict) throw new Error('stream ended without a verdict');
    } catch {
      // Stream failed. Run the blocking check and say plainly that the
      // finished verdict arrived without live progress.
      try {
        const r = await fetch('/api/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ claim }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) return setErr(d.error || 'Verification failed. Try the claim again.');
        setStreamNote('Live progress did not load, so the finished verdict is shown without it.');
        applyResult(d);
      } catch {
        setErr('Verification did not complete. The request failed or timed out. Try the claim again.');
      }
    } finally { setBusy(''); }
  }
  async function uploadFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErr(''); setBusy('doc');
    try {
      let d, r;
      if (/\.(png|jpe?g|webp|gif)$/i.test(file.name)) {
        const fd = new FormData(); fd.append('file', file); fd.append('title', title || file.name);
        r = await fetch('/api/documents/image', { method: 'POST', body: fd }); d = await r.json();
      } else if (/\.(mp4|mov|webm|mkv)$/i.test(file.name)) {
        const fd = new FormData(); fd.append('file', file); fd.append('title', title || file.name);
        r = await fetch('/api/documents/video', { method: 'POST', body: fd }); d = await r.json();
      } else if (/\.pdf$/i.test(file.name)) {
        const fd = new FormData(); fd.append('file', file); fd.append('title', title || file.name);
        r = await fetch('/api/documents/pdf', { method: 'POST', body: fd }); d = await r.json();
      } else {
        const txt = await file.text();
        r = await fetch('/api/documents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: title || file.name, text: txt }) }); d = await r.json();
      }
      setBusy('');
      if (!r.ok) return setErr(d.error || 'Upload failed.');
      await load(); setDoc(d.document); setSelected(null); setResult(null); setTab('library');
    } catch (err2) { setBusy(''); setErr(String(err2.message || err2)); }
    e.target.value = '';
  }
  async function addWebsite() {
    if (!siteUrl.trim()) return setErr('Paste a website address first.');
    setBusy('doc'); setErr('');
    try {
      const r = await fetch('/api/documents/url', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: siteUrl.trim(), title: title || undefined }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setErr(d.error || 'That website could not be added.');
      setSiteUrl(''); setTitle(''); await load(); setDoc(d.document); setSelected(null); setResult(null); setTab('library');
    } catch { setErr('That website could not be fetched. Check the address and try again.'); } finally { setBusy(''); }
  }
  async function addDoc() {
    setBusy('doc'); setErr('');
    const r = await fetch('/api/documents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, text }) });
    const d = await r.json(); setBusy('');
    if (!r.ok) return setErr(d.error);
    setText(''); setTitle(''); await load(); setDoc(d.document); setSelected(null); setResult(null); setTab('library');
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
  async function assess(targetDocId) {
    const targetId = targetDocId || doc?.id;
    if (!targetId) return setErr('Add a book or website first, then investigate a claim or theory from it.');
    if (!theory.trim()) return setErr('Enter a claim or theory about this source first.');
    setBusy('assess'); setErr(''); setAssessResult(null);
    try {
      const r = await fetch(`/api/documents/${targetId}/assess`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idemKeyFor(`assess:${targetId}:${theory.trim()}`) }, body: JSON.stringify({ text: theory }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setErr(d.error || 'Investigation failed.');
      delete idemKeys.current[`assess:${targetId}:${theory.trim()}`];
      setTheory(''); setDoc(d.document); setSelected(d.claim); setAssessResult(d.claim);
    } catch { setErr('Investigation did not complete — try again.'); } finally { setBusy(''); }
  }
  async function challenge(kind) {
    setBusy('challenge'); setErr('');
    try {
      const r = await fetch(`/api/documents/${doc.id}/claims/${selected.id}/challenge`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, text: challengeText }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setErr(d.error || 'Challenge failed.');
      setChallengeText(''); setSelected(d.claim); setAssessResult(d.claim);
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
      {authOn && <div className="wrap" style={{ paddingBottom: 0 }}>
        {user ? <p className="small">Signed in as <strong>{user}</strong> — your documents are private to your account. <button className="btn secondary" onClick={() => auth('logout')}>Sign out</button></p>
        : <p className="small">
            <input type="text" placeholder="Username" value={authName} onChange={(e) => setAuthName(e.target.value)} style={{ width: 180, marginRight: 6 }} />
            <input type="password" placeholder="Password" value={authPass} onChange={(e) => setAuthPass(e.target.value)} style={{ width: 180, marginRight: 6 }} />
            <button className="btn secondary" onClick={() => auth('login')}>Sign in</button>{' '}
            <button className="btn secondary" onClick={() => auth('register')}>Register</button>
            <span> — or keep browsing the shared demo book.</span>
          </p>}
      </div>}
      <div className="wrap">
        <nav className="tabs">
          <button className={tab === 'check' ? 'tab on' : 'tab'} onClick={() => setTab('check')}>Check something</button>
          <button className={tab === 'library' ? 'tab on' : 'tab'} onClick={() => setTab('library')}>Library &amp; results{docs.length ? ` (${docs.length})` : ''}</button>
        </nav>
        {tab === 'check' && (
          <section className="panel">
            <h2>Investigate</h2>
            <p className="small">One place for every check. Pick what you want to do. They work the same way underneath: find the evidence, read it, then judge.</p>
            <div className="toolswitch" role="tablist" aria-label="Choose what to investigate">
              <button className={tool === 'claim' ? 'tab on' : 'tab'} onClick={() => setTool('claim')}>Put a claim on trial</button>
              <button className={tool === 'document' ? 'tab on' : 'tab'} onClick={() => setTool('document')}>Cross-examine a book</button>
              <button className={tool === 'website' ? 'tab on' : 'tab'} onClick={() => setTool('website')}>Cross-examine a website</button>
              <button className={tool === 'question' ? 'tab on' : 'tab'} onClick={() => setTool('question')}>Ask a source anything</button>
            </div>
            {tool === 'claim' && (
              <div>
                <p className="small">Type any statement. TruthLens looks for sources on both sides, reads them, and gives you a verdict with the passages it used. Check another claim and the earlier verdicts stay below, so you can compare.</p>
                <input type="text" value={claim} onChange={(e) => setClaim(e.target.value)} aria-label="Claim to verify" />
                <p><MicButton label="Dictate a claim" onText={(t) => setClaim((prev) => (prev.trim() ? `${prev.trim()} ${t}` : t))} /></p>
                <p><button className="btn" onClick={verify} disabled={busy === 'verify'}>{busy === 'verify' ? 'Investigating…' : 'Verify this claim'}</button></p>
                {busy === 'verify' && <p className="small">Live research fetches and checks sources before judging. This can take 30 to 60 seconds. Keep this tab open. The verdict will appear right here.</p>}
                {liveStages.length > 0 && <div data-live-stages><p className="small">Investigation so far</p><ol className="stages">{liveStages.map((s, i) => <li key={i}>{STAGE_LABELS[s.stage] || s.stage}{s.detail.model ? ` (${s.detail.model})` : s.stage === 'judge' && s.detail.judgedBy ? ` (${s.detail.judgedBy})` : ''}{s.stage === 'research' && typeof (s.detail.counts?.fetched ?? s.detail.fetched) === 'number' ? ` (${s.detail.counts?.fetched ?? s.detail.fetched} fetched)` : ''}</li>)}</ol></div>}
                {streamNote && <p className="small" role="status">{streamNote}</p>}
                {result && !selected && <div data-result-inline><div className="rule" /><VerdictView r={result} /><p><button className="btn secondary" onClick={() => { setResult(null); setTurns([]); }}>Clear conversation</button></p></div>}
                {turns.length > 0 && <div><div className="rule" /><h3>Earlier in this conversation</h3>{turns.map((t, i) => <p className="small" key={i}><span className={cls(t.verdict)}>{t.verdict}</span> {t.text}</p>)}</div>}
              </div>
            )}
            {tool === 'document' && (
              <div data-upload>
                <p className="small">Bring the book. We'll cross-examine it. Drop in a book, article, or report, and TruthLens pulls out every claim worth checking, starts with the ones that matter most, and shows its work, verdict by verdict, passage by passage. Upload the file or paste the text. Either way it lands in Library &amp; results, ready to interrogate.</p>
                <p><label className="small">Upload a file (PDF with a text layer, .txt/.md, an image, or a video)<br /><input type="file" accept=".pdf,.txt,.md,.png,.jpg,.jpeg,.webp,.gif,.mp4,.mov,.webm,.mkv,text/plain,application/pdf,image/*,video/*" onChange={uploadFile} disabled={busy === 'doc'} /></label></p>
                <p className="small">Images are captioned by Muse Spark and videos are transcribed by Muse Voice Transcribe with Spark frame captions. The caption or transcript then goes through the same claim checking as a book.</p>
                <p className="small">— or paste the text instead —</p>
                <input type="text" placeholder="Document title" value={title} onChange={(e) => setTitle(e.target.value)} />
                <p><textarea placeholder="Paste document text here. Separate pages with --- page ---" value={text} onChange={(e) => setText(e.target.value)} /></p>
                <button className="btn secondary" onClick={addDoc} disabled={busy === 'doc'}>{busy === 'doc' ? 'Extracting claims…' : 'Extract & investigate'}</button>
              </div>
            )}
            {tool === 'website' && (
              <div data-website>
                <p className="small">Give TruthLens a page on the web. It fetches the page itself, strips it to readable text, and pulls out the claims worth checking, same as a book. Pages that need JavaScript to show their text, or that block fetching, get a plain refusal instead of a made up document. One page at a time. Following links around a whole site is not in this pass.</p>
                <p><label className="small">Website address<br /><input type="text" placeholder="https://example.org/article" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} aria-label="Website address" /></label></p>
                <input type="text" placeholder="Title (optional, the page title is used otherwise)" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Website title" />
                <p><button className="btn" onClick={addWebsite} disabled={busy === 'doc'}>{busy === 'doc' ? 'Fetching and extracting claims…' : 'Fetch and investigate'}</button></p>
                <p className="small">The fetched page lands in Library and results, with its address kept on the card so you can open the original.</p>
              </div>
            )}
            {tool === 'question' && (
              <div data-assess-form>
                <p className="small">Ask a book or a website anything. Then check its answer against the world. Got a suspicion the author never quite states? Put it in your own words. TruthLens hunts down the passages that touch it, shows you exactly where the author stands, then steps outside the source to test it against independent evidence. If the source is bluffing, you will see where.</p>
                {docs.length === 0 ? <p className="small">Add a book or a website first. The demo book appears here as soon as it loads.</p> : (
                  <>
                    <p><label className="small">Document<br /><select value={assessDocId || docs[0]?.id || ''} onChange={(e) => setAssessDocId(e.target.value)} aria-label="Choose a document">{docs.map((d) => <option key={d.id} value={d.id}>{d.kind === 'website' ? `${d.title} (website)` : d.title}</option>)}</select></label></p>
                    <p><textarea placeholder="e.g. The reservoir programme was mainly a political project, not a safety one." value={theory} onChange={(e) => setTheory(e.target.value)} aria-label="Claim or theory to investigate" /></p>
                    <p><MicButton label="Dictate a theory" onText={(t) => setTheory((prev) => (prev.trim() ? `${prev.trim()} ${t}` : t))} /></p>
                    <p><button className="btn" onClick={() => assess(assessDocId || docs[0]?.id)} disabled={busy === 'assess'}>{busy === 'assess' ? 'Investigating…' : 'Investigate this'}</button>{busy === 'assess' && <span className="small"> Live research can take 30–60 seconds.</span>}</p>
                  </>
                )}
                {assessResult && (
                  <div data-assess-inline>
                    <div className="rule" />
                    <VerdictView r={assessResult} docId={doc?.id} />
                    <div className="ev" data-debate>
                      <h3>Debate this verdict</h3>
                      <p className="small">Disagree, or want to dig deeper? Push back and the follow-up investigation is added to the record above. The original verdict stays.</p>
                      <p><button className="btn secondary" onClick={() => challenge('stronger-contrary')} disabled={busy === 'challenge'}>Find stronger opposing evidence</button>{' '}<button className="btn secondary" onClick={() => challenge('prove-wrong')} disabled={busy === 'challenge'}>What would prove this wrong?</button>{' '}<button className="btn secondary" onClick={() => challenge('compare-author')} disabled={busy === 'challenge'}>Compare with the author</button></p>
                      <p><input type="text" placeholder="Or describe your own challenge…" value={challengeText} onChange={(e) => setChallengeText(e.target.value)} /> <button className="btn secondary" onClick={() => challenge('custom')} disabled={busy === 'challenge'}>Investigate</button>{busy === 'challenge' && <span className="small"> Investigating…</span>}</p>
                      <p><button className="btn secondary" onClick={() => setTab('library')}>Open the full result in Library &amp; results</button></p>
                    </div>
                  </div>
                )}
              </div>
            )}
            {err && <div className="error">{err}</div>}
          </section>
        )}
        {tab === 'library' && (
          <div>
            <h2>Your documents</h2>
            <p className="small">Everything you have added, and how much of it has been checked. Open a document to see its claims and the evidence behind each verdict. New here? The demo book is already loaded — open it to see a finished example.</p>
            <p className="small"><strong>Claims found</strong> is the number of checkable statements pulled out of a document. <strong>Checked</strong> means a verdict is in, with sources you can open. These numbers describe progress, not quality.</p>
            {docs.length === 0 && <p className="small">No documents yet. Add one from the Check something tab.</p>}
            {docs.map((d) => (
              <button className="doc" key={d.id} onClick={() => { setDoc(d); setSelected(null); }}>
                <h3>{d.title}</h3>
                {d.kind === 'website' && d.sourceUrl ? <p className="small">Website · {d.sourceUrl}</p> : d.kind === 'image' ? <p className="small">Captioned image · Muse Spark</p> : d.kind === 'video' ? <p className="small">Transcribed video · Muse Voice Transcribe + Muse Spark</p> : <p className="small">Book or pasted document</p>}
                <p className="small">{d.claims.length} claims found · {d.report?.investigated ?? 0} checked{d.report?.notYetVerified > 0 ? ` · ${d.report.notYetVerified} still to check` : ''}{d.status === 'verifying' ? ' · checking the most important claims now…' : ''}</p>
                {d.quarantined > 0 && <p className="small">Some hidden instructions were removed from {d.quarantined} page(s) of this document so they could not influence the verdict.</p>}
              </button>
            ))}
        {contra.length > 0 && !shown && <section><div className="rule" /><h2>Where your documents disagree</h2><p className="small">The same topic, stated differently in different documents. Open any claim from the list above to see the evidence behind it.</p>{contra.map((e, i) => <div className="ev" key={i}><div className="meta">Topic · {e.topic} · {e.verifiedDisagreement ? 'Verified disagreement' : 'Positions — not yet verified'}</div>{e.positions.map((pos, j) => <p key={j}><strong>{pos.docTitle}</strong> (p{pos.page}): {pos.text} <span className={cls(pos.verdict)}>{pos.verdict}</span></p>)}<p className="small">{e.scopeNote}</p></div>)}</section>}
        {doc && !shown && (
          <section><div className="rule" /><h2>{doc.title}</h2>
            {doc.kind === 'website' && doc.sourceUrl && <p className="small">Website source. <a href={doc.sourceUrl} target="_blank" rel="noreferrer">Open the original page</a></p>}
            {doc.kind === 'image' && doc.media?.caption && <p className="small">Caption by Muse Spark: “{doc.media.caption}”</p>}
            {doc.kind === 'video' && doc.media?.transcript && <p className="small">Transcript: {doc.media.transcript}</p>}
            <p className="small">{doc.status === 'verifying' ? 'Automatic verification is running in the background — the top claims are being checked now. You can investigate below right away.' : doc.status === 'paused' ? 'Automatic verification is paused.' : 'Automatic verification finished.'} {doc.report ? `${doc.report.autoVerified ?? 0} automatically verified · ${doc.report.readerInvestigated ?? 0} investigated by you · ${doc.report.notYetVerified ?? 0} not yet verified.` : ''}</p>
            <p><button className="btn secondary" onClick={async () => { const r = await fetch(`/api/documents/${doc.id}/recheck`, { method: 'POST' }); const d = await r.json(); if (r.ok) { setDoc(d.document); await load(); } }}>Re-check with current evidence</button>{' '}{doc.autoPaused ? <button className="btn secondary" onClick={() => toggleAuto(false)}>Resume automatic verification</button> : <button className="btn secondary" onClick={() => toggleAuto(true)}>Pause automatic verification</button>}</p>
            <p data-ask-link><button className="btn secondary" onClick={() => { setAssessDocId(doc.id); setTool('question'); setTab('check'); }}>{doc.kind === 'website' ? 'Ask this page a question' : 'Ask this book a question'}</button>{' '}<span className="small">Opens Ask a source anything on the main page, with this source already picked.</span></p>
            {doc.report && <div className="ev"><h3>What checking has found so far</h3><p className="small">Of the {doc.report.totalClaims} claims pulled out of this document, {doc.report.investigated} have been checked and {doc.report.resolved ?? doc.report.investigated} reached a clear verdict. Verdicts so far: {Object.entries(doc.report.distribution).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'none yet'}.</p>
            {doc.report.highImpactDisputed.length > 0 && <><p><strong>Claims that need a second look</strong></p><p className="small">These were contradicted or only partly supported, and they matter most if someone acts on them.</p>{doc.report.highImpactDisputed.map((h) => { const c = doc.claims.find((x) => x.id === h.id); return <button className="claim" key={h.id} onClick={() => c && setSelected(c)}><span>{h.text}</span><span className={cls(h.verdict)}>{h.verdict}</span></button>; })}</>}
            {doc.report.internalContradictions.length > 0 && <p className="small">Places where this document contradicts itself: pages {doc.report.internalContradictions.map((c) => c.page).join(', ')}.</p>}</div>}
            {doc.claims.map((c) => c.status === 'verified' || !c.status ? (
              <button className="claim" key={c.id} onClick={() => setSelected(c)}>
                <span>{c.text}<br /><span className="small">{doc.kind === 'website' ? 'Web page' : doc.kind === 'image' ? 'Caption' : doc.kind === 'video' ? `Segment ${c.page}` : `Page${(c.pages?.length > 1) ? 's ' + c.pages.join(', ') : ' ' + c.page}`} · {c.type} · Judged by {c.judgedBy}{c.source === 'reader-submitted' ? ' · Your investigation' : c.source === 'reader-pick' ? ' · Verified by you' : ''}{c.internalContradiction ? ' · Internal contradiction flagged' : ''}</span></span>
                <span className={cls(c.verdict)}>{c.verdict}</span>
              </button>
            ) : (
              <div className="claim" key={c.id}>
                <span>{c.text}<br /><span className="small">{doc.kind === 'website' ? 'Web page' : doc.kind === 'image' ? 'Caption' : doc.kind === 'video' ? `Segment ${c.page}` : `Page${(c.pages?.length > 1) ? 's ' + c.pages.join(', ') : ' ' + c.page}`} · {c.type}</span></span>
                <span><span className="stamp v-Unverifiable">{c.status === 'pending' ? 'Verifying…' : 'Not yet verified'}</span>{' '}<button className="btn secondary" onClick={() => verifyClaim(c)} disabled={busy === 'claim'}>Verify this claim</button></span>
              </div>
            ))}
          </section>
        )}
        {shown && <section><div className="rule" /><button className="btn secondary" onClick={() => { setSelected(null); setResult(null); }}>← Back to claims</button><VerdictView r={shown} docId={doc?.id} />{doc && shown.id && <div className="ev"><h3>Challenge this finding</h3><p className="small">The original verdict stays on record; the follow-up is added below it.</p><p><button className="btn secondary" onClick={() => challenge('stronger-contrary')} disabled={busy === 'challenge'}>Find stronger opposing evidence</button>{' '}<button className="btn secondary" onClick={() => challenge('prove-wrong')} disabled={busy === 'challenge'}>What would prove this wrong?</button>{' '}<button className="btn secondary" onClick={() => challenge('compare-author')} disabled={busy === 'challenge'}>Compare with the author</button></p><p><input type="text" placeholder="Or describe your own challenge…" value={challengeText} onChange={(e) => setChallengeText(e.target.value)} /> <button className="btn secondary" onClick={() => challenge('custom')} disabled={busy === 'challenge'}>Investigate</button>{busy === 'challenge' && <span className="small"> Investigating…</span>}</p></div>}</section>}
          </div>
        )}
      </div>
    </main>
  );
}
