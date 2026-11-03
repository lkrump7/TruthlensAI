'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './components/icons.js';
import { MicButton } from './components/mic.js';
import { AgentTimeline, FollowupCard, VerdictSummary, VerdictView, cls } from './components/verdict.js';
import { ChallengeButtons, ChallengeDirections, SuggestedNext } from './components/challenge.js';
import { Modal } from './components/modal.js';
import { GaugeRing, StanceBar } from './components/forensic.js';
import ThemeToggle from './components/theme-toggle.js';
import { WebsiteScrutiny } from './components/website.js';
import { buildHash, parseHash, filterClaims, createDebounced, safeResponseJson, timeAgo, claimCategory, safeHttpUrl } from '../lib/ui-state.mjs';
import { shouldFallbackAfterStreamError, classifyUpload, pageLabel } from '../lib/page-logic.mjs';
import { BookDossier } from './components/book-dossier.js';
import { Personas } from './components/personas.js';
import { scrutinyTelemetry } from '../lib/website-scrutiny.mjs';

// Reads one streamed check. Progress and the verdict go to the callbacks.
// A caller that passes an abort signal can stop the read mid-flight.
// One idempotency key per attempt lets the blocking fallback replay the
// streamed record instead of recording a second history entry.
async function readVerifyStream(claimText, { signal, onProgress, onVerdict, idempotencyKey }) {
  const r = await fetch('/api/verify/stream', { method: 'POST', headers: { 'content-type': 'application/json', ...(idempotencyKey ? { 'idempotency-key': idempotencyKey } : {}) }, body: JSON.stringify({ claim: claimText }), signal });
  if (!r.ok) { const err = new Error('stream unavailable'); err.status = r.status; throw err; }
  if (!r.body) throw new Error('stream unavailable');
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
      if (event.kind === 'progress') onProgress({ stage: event.stage, detail: event.detail || {} });
      else if (event.kind === 'verdict') { gotVerdict = true; onVerdict(event.result); }
      else if (event.kind === 'error') throw new Error(event.error || 'stream failed');
    }
  }
  if (!gotVerdict) throw new Error('stream ended without a verdict');
}

export default function Home() {
  const [docs, setDocs] = useState([]); const [mode, setMode] = useState('demo');
  const [doc, setDoc] = useState(null); const [selected, setSelected] = useState(null);
  const [claim, setClaim] = useState('Humans only use 10% of their brains.');
  const [result, setResult] = useState(null); const [busy, setBusy] = useState('');
  const [title, setTitle] = useState(''); const [text, setText] = useState(''); const [err, setErr] = useState('');
  const [user, setUser] = useState(null); const [authOn, setAuthOn] = useState(false); const [authName, setAuthName] = useState(''); const [authPass, setAuthPass] = useState('');
  const [contra, setContra] = useState([]); const [contraErr, setContraErr] = useState('');
  const [tab, setTab] = useState('home');
  const [assessDocId, setAssessDocId] = useState(''); const [assessResult, setAssessResult] = useState(null); const [assessTarget, setAssessTarget] = useState(null);
  const [tool, setTool] = useState('claim'); const [turns, setTurns] = useState([]);
  const idemKeys = useRef({});
  const idemKeyFor = (scope) => { if (!idemKeys.current[scope]) idemKeys.current[scope] = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`); return idemKeys.current[scope]; };
  const [theory, setTheory] = useState(''); const [challengeText, setChallengeText] = useState('');
  const [liveStages, setLiveStages] = useState([]); const [streamNote, setStreamNote] = useState('');
  const [siteUrl, setSiteUrl] = useState('');
  const [queue, setQueue] = useState([]); const [batchResults, setBatchResults] = useState([]);
  const [viewerDoc, setViewerDoc] = useState(null); const [viewerBusy, setViewerBusy] = useState(false);
  const [resultPopup, setResultPopup] = useState(null); const [libraryFocus, setLibraryFocus] = useState(null);
  const [inlineExpanded, setInlineExpanded] = useState(false); const [batchExpanded, setBatchExpanded] = useState({});
  const [pendingDelete, setPendingDelete] = useState(null); const [confirmTitle, setConfirmTitle] = useState(''); const [deleteErr, setDeleteErr] = useState('');
  const [history, setHistory] = useState([]);
  const [dragging, setDragging] = useState(false); const [loadErr, setLoadErr] = useState(''); const [docNote, setDocNote] = useState('');
  const [chatMessages, setChatMessages] = useState([]); const [chatText, setChatText] = useState(''); const [chatContext, setChatContext] = useState(null);
  const [histVerdict, setHistVerdict] = useState(''); const [histWorkflow, setHistWorkflow] = useState('');
  const [announce, setAnnounce] = useState(''); const [loaded, setLoaded] = useState(false);
  const [claimQuery, setClaimQuery] = useState(''); const [claimVerdictFilter, setClaimVerdictFilter] = useState('');
  const [bookBucket, setBookBucket] = useState('all'); const [bookChapter, setBookChapter] = useState('all'); const [showUpload, setShowUpload] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [vaultCat, setVaultCat] = useState('all'); const [vaultQuery, setVaultQuery] = useState('');
  const [vaultSort, setVaultSort] = useState('recent'); const [vaultPage, setVaultPage] = useState(1);
  const [vaultNote, setVaultNote] = useState(''); const [batchBusy, setBatchBusy] = useState(false);
  const verifyAbortRef = useRef(null); const chatAbortRef = useRef(null); const fileInputRef = useRef(null); const dragCount = useRef(0);
  const claimBoxRef = useRef(null); const chatEndRef = useRef(null); const routeRef = useRef(null);
  const docsRef = useRef([]);
  docsRef.current = docs;
  function applyRouteDoc(route) {
    const d = docsRef.current.find((x) => x.id === route?.docId);
    if (!d) return false;
    setDoc(d);
    setSelected(route.claimId ? d.claims?.find((x) => x.id === route.claimId) || null : null);
    return true;
  }
  const historySearchRef = useRef(null);
  if (!historySearchRef.current) historySearchRef.current = createDebounced((q, v, w) => { void loadHistory(q, v, w); }, 300);
  function cancelCheck() { verifyAbortRef.current?.abort(); chatAbortRef.current?.abort(); }
  const claimLines = () => claim.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  async function loadHistory(q = vaultQuery, v = histVerdict, w = histWorkflow) {
    try {
      const params = new URLSearchParams();
      if (String(q || '').trim()) params.set('q', String(q || '').trim());
      if (v) params.set('verdict', v);
      if (w) params.set('workflow', w);
      const r = await fetch(`/api/history${params.toString() ? `?${params}` : ''}`);
      const d = await r.json().catch(() => ({}));
      if (r.ok) setHistory(d.entries || []);
    } catch { /* history is a recall aid. A failed load never blocks a check. */ }
  }
  function reopenHistory(entry) {
    if (!entry) return;
    if (entry.workflow === 'claim') {
      setResult(entry.claim); setBatchResults([]); setSelected(null); setTool('claim'); setTab('check');
      return;
    }
    const ownerDoc = docs.find((d) => d.id === entry.docId);
    const found = ownerDoc?.claims?.find((c) => c.id === entry.claimId);
    if (ownerDoc && found) { setDoc(ownerDoc); setSelected(found); setTab('library'); }
    else { setResult(entry.claim); setSelected(null); setTab('check'); }
  }

  async function load() {
    try {
      const r = await fetch('/api/documents'); const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error('load failed');
      setDocs(d.documents || []); setMode(d.mode); setLoadErr('');
      fetch('/api/contradictions').then((r) => r.json()).then((c) => { setContra(c.entries || []); setContraErr(''); }).catch(() => { setContraErr('Disagreement check did not load. Retry by reloading.'); });
      const firstDoc = d.documents?.find((x) => x.kind !== 'history');
      if (!doc && firstDoc) setDoc(firstDoc);
      return true;
    } catch { setLoadErr('We could not load your files. Check your connection, then reload.'); return false; }
  }
  async function loadSafe() { try { await load(); } catch { /* load reports its own failure */ } }
  useEffect(() => {
    try { const draft = localStorage.getItem('truthlens-claim-draft'); if (draft && draft.trim()) setClaim(draft); } catch { /* private mode. Typing still works. */ }
    const route = parseHash(window.location.hash);
    if (route) { routeRef.current = route; setTab(route.tab); if (route.tool) setTool(route.tool); }
    const onHash = () => {
      const next = parseHash(window.location.hash);
      if (!next) return;
      routeRef.current = next; setTab(next.tab); if (next.tool) setTool(next.tool);
      if (next.tab !== 'library') routeRef.current = null;
      else if (!next.docId) { setSelected(null); routeRef.current = null; }
      else if (applyRouteDoc(next)) routeRef.current = null;
    };
    window.addEventListener('hashchange', onHash);
    void load().finally(() => setLoaded(true)); loadHistory('', '', '');
    fetch('/api/auth').then((r) => r.json()).then((d) => { setUser(d.user); setAuthOn(!!d.authEnabled); }).catch(() => { setErr('Sign-in status did not load. Reload to retry.'); });
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    if (!loaded || !routeRef.current?.docId) return;
    if (applyRouteDoc(routeRef.current)) routeRef.current = null;
    else {
      // A pasted link points at a doc that never loaded. Drop the pending
      // route and fall back to the plain library hash so hash sync resumes.
      routeRef.current = null;
      window.history.replaceState(null, '', buildHash({ tab: 'library' }));
    }
  }, [docs, loaded]);
  useEffect(() => {
    if (routeRef.current) return; // a pasted link is still being applied
    const next = buildHash({ tab, tool, docId: tab === 'library' ? doc?.id : undefined, claimId: tab === 'library' && doc && selected && doc.claims?.some((c) => c.id === selected.id) ? selected.id : undefined });
    if (window.location.hash === next) return;
    if (!window.location.hash) window.history.replaceState(null, '', next);
    else window.history.pushState(null, '', next);
  }, [tab, tool, doc, selected]);
  useEffect(() => {
    try { localStorage.setItem('truthlens-claim-draft', claim); } catch { /* private mode. Skip the draft. */ }
  }, [claim]);
  useEffect(() => {
    if (!docs.some((d) => d.status === 'verifying')) return;
    const t = setInterval(async () => { try { const r = await fetch('/api/documents'); const d = await r.json().catch(() => ({})); if (!r.ok) return; setDocs(d.documents || []); if (doc) { const fresh = (d.documents || []).find((x) => x.id === doc.id); if (fresh) setDoc(fresh); } } catch { /* polling is a refresh aid; keep the last good list */ } }, 3000);
    return () => clearInterval(t);
  }, [docs, doc]);
  useEffect(() => {
    if (!doc?.id || typeof EventSource === 'undefined') return;
    const source = new EventSource(`/api/documents/${doc.id}/events`);
    source.onmessage = (event) => { try { const d = JSON.parse(event.data); if (d.document) { setDoc(d.document); setDocs((prev) => prev.map((x) => (x.id === d.document.id ? d.document : x))); } } catch { /* keep polling */ } };
    source.onerror = () => { if (source.readyState === EventSource.CLOSED) source.close(); };
    return () => source.close();
  }, [doc?.id]);
  async function auth(action) {
    setErr('');
    try {
      const r = await fetch('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, username: authName, password: authPass }) });
      const d = await r.json().catch(() => ({}));
      if (r.status === 429) return setErr('Too many attempts. Wait a few minutes and try again.');
      if (!r.ok) return setErr(d.error || 'That did not work. Try again.');
      setUser(d.user); setAuthPass('');
      // Workspace state belongs to the previous account. Clear it before
      // the new account's files load, so nothing from the last session shows.
      setDoc(null); setSelected(null); setResult(null); setBatchResults([]); setQueue([]);
      setChatMessages([]); setChatContext(null); setAssessDocId(''); setAssessResult(null);
      setResultPopup(null); setLibraryFocus(null); setViewerDoc(null); setInlineExpanded(false); setBatchExpanded({});
      setDocs([]); setHistory([]); setContra([]); setContraErr(''); setVaultPage(1);
      await loadSafe();
      await loadHistory();
    } catch { setErr('We could not reach the server. Check your connection and try again.'); }
  }
  async function verify() {
    const lines = claimLines();
    if (!lines.length || busy === 'verify') return;
    const controller = new AbortController();
    verifyAbortRef.current = controller;
    if (lines.length > 1) {
      setBusy('verify'); setErr(''); setLiveStages([]); setStreamNote(''); setBatchResults([]); setResult(null);
      setQueue(lines.map((text, i) => ({ text, state: i === 0 ? 'running' : 'waiting' })));
      try {
        const r = await fetch('/api/verify/batch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: claim }), signal: controller.signal });
        const d = await r.json().catch(() => ({}));
        if (r.status === 429) { setQueue(lines.map((text) => ({ text, state: 'failed' }))); return setErr('Too many checks. Wait a minute and try again.'); }
        if (!r.ok) { setQueue(lines.map((text) => ({ text, state: 'failed' }))); return setErr(d.error || 'The check failed. Try again.'); }
        setQueue((d.results || []).map((x) => ({ text: x.text, state: x.ok ? 'done' : 'failed', verdict: x.result?.verdict, error: x.error })));
        const okResults = (d.results || []).filter((x) => x.ok).map((x) => x.result);
        const failed = (d.results || []).filter((x) => !x.ok);
        setBatchResults(okResults);
        setBatchExpanded({});
        if (okResults.length) { setResultPopup({ results: okResults }); setAnnounce(`${okResults.length} checks done.`); }
        if (d.mode) setMode(d.mode);
        if (failed.length || (d.dropped || []).length) {
          const failedText = failed.map((x) => x.text).join('\n');
          setClaim([failedText, ...(d.dropped || [])].filter(Boolean).join('\n'));
          if ((d.dropped || []).length) setErr(`Only the first ${d.limit || 10} claims in one batch are checked. The rest are back in the box, ready to check next.`);
        } else {
          setClaim(''); try { localStorage.removeItem('truthlens-claim-draft'); } catch { /* ignore */ }
        }
        await loadHistory();
      } catch {
        if (controller.signal.aborted) { setQueue([]); setStreamNote('Check cancelled. Nothing was saved.'); setAnnounce('Check cancelled.'); }
        else {
          setQueue(lines.map((text) => ({ text, state: 'failed' })));
          setErr('The check did not finish. Try again.');
        }
      } finally { setBusy(''); verifyAbortRef.current = null; }
      return;
    }
    setBusy('verify'); setErr(''); setLiveStages([]); setStreamNote('');
    const applyResult = (d) => {
      if (d.mode) setMode(d.mode);
      if (result) setTurns((t) => [...t, result]);
      setResult(d); setSelected(null);
      setInlineExpanded(false);
      setResultPopup({ result: d });
      setClaim(''); try { localStorage.removeItem('truthlens-claim-draft'); } catch { /* ignore */ }
      setAnnounce(`Verdict: ${d.verdict}. ${d.text}`);
      void loadHistory();
    };
    const attemptKey = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
    try {
      await readVerifyStream(claim, {
        signal: controller.signal,
        idempotencyKey: attemptKey,
        onProgress: (p) => setLiveStages((s) => [...s, p]),
        onVerdict: applyResult,
      });
    } catch (streamErr) {
      if (controller.signal.aborted) {
        setStreamNote('Check cancelled. Nothing was saved.');
        setAnnounce('Check cancelled.');
        setLiveStages([]);
      } else if (!shouldFallbackAfterStreamError(streamErr)) {
        // An HTTP error (e.g. 429) already spent the attempt. Falling back
        // to the blocking check would burn quota a second time.
        setErr(streamErr?.status === 429 ? 'Too many checks. Wait a minute and try again.' : 'The check failed. Try again.');
      } else {
        // Stream failed. Run the blocking check and say plainly that the
        // finished verdict arrived without live progress. Same key replays
        // the streamed record instead of saving twice.
        try {
          const r = await fetch('/api/verify', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': attemptKey }, body: JSON.stringify({ claim }), signal: controller.signal });
          const d = await r.json().catch(() => ({}));
          if (r.status === 429) { setErr('Too many checks. Wait a minute and try again.'); return; }
          if (!r.ok) { setErr(d.error || 'The check failed. Try again.'); return; }
          setStreamNote('Live progress did not load. Here is the final answer.');
          applyResult(d);
        } catch {
          if (controller.signal.aborted) { setStreamNote('Check cancelled. Nothing was saved.'); setAnnounce('Check cancelled.'); }
          else setErr('The check did not finish. Try again.');
        }
      }
    } finally { setBusy(''); verifyAbortRef.current = null; }
  }
  async function uploadFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const classified = classifyUpload(file);
    if (!classified.ok) { setErr(classified.error); if (e.target) e.target.value = ''; return; }
    setErr(''); setBusy('doc'); setUploadName(file.name);
    try {
      let d, r;
      if (classified.kind === 'image') {
        const fd = new FormData(); fd.append('file', file); fd.append('title', title || file.name);
        r = await fetch('/api/documents/image', { method: 'POST', body: fd }); d = await safeResponseJson(r);
      } else if (classified.kind === 'audio') {
        const fd = new FormData(); fd.append('file', file); fd.append('title', title || file.name);
        r = await fetch('/api/documents/audio', { method: 'POST', body: fd }); d = await safeResponseJson(r);
      } else if (classified.kind === 'video') {
        const fd = new FormData(); fd.append('file', file); fd.append('title', title || file.name);
        r = await fetch('/api/documents/video', { method: 'POST', body: fd }); d = await safeResponseJson(r);
      } else if (classified.kind === 'pdf') {
        const fd = new FormData(); fd.append('file', file); fd.append('title', title || file.name);
        r = await fetch('/api/documents/pdf', { method: 'POST', body: fd }); d = await safeResponseJson(r);
      } else if (classified.kind === 'docx') {
        const fd = new FormData(); fd.append('file', file); fd.append('title', title || file.name);
        r = await fetch('/api/documents/docx', { method: 'POST', body: fd }); d = await safeResponseJson(r);
      } else {
        const txt = await file.text();
        if (txt.length > 200000) { setBusy(''); setErr('That text file is larger than 200,000 characters. Split it and try again.'); e.target.value = ''; return; }
        r = await fetch('/api/documents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: title || file.name, text: txt }) }); d = await safeResponseJson(r);
      }
      setBusy('');
      if (!r.ok) return setErr(d.error || 'Upload failed.');
      setAnnounce(`${d.document.title} added to the Library.`);
      await loadSafe(); setDoc(d.document); setSelected(null); setResult(null); setTab('library');
    } catch (err2) { setBusy(''); setErr(String(err2.message || err2)); }
    setUploadName('');
    e.target.value = '';
  }
  async function addWebsite() {
    if (!siteUrl.trim()) return setErr('Paste a website address first.');
    setBusy('doc'); setErr('');
    try {
      const r = await fetch('/api/documents/url', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: siteUrl.trim(), title: title || undefined }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setErr(d.error || 'We could not add that website.');
      setSiteUrl(''); setTitle(''); await loadSafe(); setDoc(d.document); setSelected(null); setResult(null); setTab('library');
    } catch { setErr('We could not load that website. Check the address and try again.'); } finally { setBusy(''); }
  }
  async function addDoc() {
    if (!text.trim()) return setErr('Paste document text first.');
    if (text.length > 200000) return setErr('That text is larger than 200,000 characters. Split it and try again.');
    setBusy('doc'); setErr('');
    try {
      const r = await fetch('/api/documents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title, text }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setErr(d.error || 'We could not add that text. Try again.');
      setText(''); setTitle(''); await loadSafe(); setDoc(d.document); setSelected(null); setResult(null); setTab('library');
    } catch { setErr('We could not add that text. Check your connection and try again.'); } finally { setBusy(''); }
  }
  async function verifyClaim(c, ownerDoc = doc) {
    setBusy('claim'); setErr('');
    try {
      const r = await fetch(`/api/documents/${ownerDoc.id}/claims/${c.id}/verify`, { method: 'POST', headers: { 'idempotency-key': idemKeyFor(`verify:${c.id}`) } });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setErr(d.error || 'The check failed.');
      delete idemKeys.current[`verify:${c.id}`];
      setDoc(d.document); setSelected(d.claim); setTab('library');
      try { const fresh = await (await fetch('/api/documents')).json().catch(() => ({})); if (fresh.documents) { setDocs(fresh.documents); const fd = fresh.documents.find((x) => x.id === d.document.id); if (fd) setDoc(fd); } } catch { /* the verdict is saved; a failed refresh must not call it failed */ }
    } catch { setErr('The check did not finish. Try again.'); } finally { setBusy(''); }
  }
  async function assess(targetDocId) {
    const wanted = targetDocId || doc?.id;
    const target = realDocs.find((x) => x.id === wanted) || realDocs[0];
    const targetId = target?.id;
    if (!targetId) return setErr('Add a book or website first.');
    if (!theory.trim()) return setErr('Type your question or idea first.');
    setBusy('assess'); setErr(''); setAssessResult(null);
    try {
      const r = await fetch(`/api/documents/${targetId}/assess`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': idemKeyFor(`assess:${targetId}:${theory.trim()}`) }, body: JSON.stringify({ text: theory }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setErr(d.error || 'The check failed.');
      delete idemKeys.current[`assess:${targetId}:${theory.trim()}`];
      setTheory(''); setDoc(d.document); setSelected(d.claim); setAssessResult(d.claim); setAssessTarget({ docId: d.document.id, claimId: d.claim.id });
      setAnnounce(`Verdict: ${d.claim.verdict}. ${d.claim.text}`);
      setResultPopup({ result: d.claim, docId: d.document.id });
    } catch { setErr('The check did not finish. Try again.'); } finally { setBusy(''); }
  }
  async function challenge(kind, target = null) {
    const docId = target?.docId || doc?.id;
    const claimId = target?.claimId || selected?.id;
    if (!docId || !claimId) return setErr('Pick a checked claim first.');
    setBusy('challenge'); setErr('');
    try {
      const r = await fetch(`/api/documents/${docId}/claims/${claimId}/challenge`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, text: challengeText }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setErr(d.error || 'That failed.');
      setChallengeText(''); setSelected(d.claim); setAssessResult(d.claim);
      try { const fresh = await (await fetch('/api/documents')).json().catch(() => ({})); if (fresh.documents) { setDocs(fresh.documents); const fd = fresh.documents.find((x) => x.id === docId); if (fd) setDoc(fd); } } catch { /* the verdict is saved; a failed refresh must not call it failed */ }
    } catch { setErr('That did not finish. Try again.'); } finally { setBusy(''); }
  }
  async function openChatRecord() {
    if (!chatContext) return;
    let owner = docs.find((x) => x.id === chatContext.docId);
    let claim = owner?.claims?.find((c) => c.id === chatContext.claimId);
    if (!owner || !claim) {
      try { const fresh = await (await fetch('/api/documents')).json().catch(() => ({})); if (fresh.documents) { setDocs(fresh.documents); owner = fresh.documents.find((x) => x.id === chatContext.docId); claim = owner?.claims?.find((c) => c.id === chatContext.claimId); } } catch { /* fall through to the summary below */ }
    }
    if (owner && claim) { setDoc(owner); setSelected(claim); setTab('library'); }
    else setChatMessages((m) => [...m, { role: 'note', text: 'That result is no longer in your Library.' }]);
  }
  function seedChatFromClaim(value) {
    if (!value) return;
    const sep = value.indexOf(':');
    const d = docs.find((x) => x.id === value.slice(0, sep));
    const c = d?.claims?.find((x) => x.id === value.slice(sep + 1));
    if (!d || !c) return;
    setDoc(d);
    setChatContext({ docId: d.id, claimId: c.id, kind: d.kind });
    setChatMessages([{ role: 'verdict', result: c }]);
  }
  async function investigateChatClaim(text) {
    setBusy('chat'); setErr(''); setLiveStages([]);
    const controller = new AbortController();
    chatAbortRef.current = controller;
    const applyChatResult = (d) => {
      if (d.mode) setMode(d.mode);
      setChatMessages((m) => [...m, { role: 'verdict', result: d }]);
      setAnnounce(`Verdict: ${d.verdict}. ${d.text}`);
      if (d.historyDocId && d.historyClaimId) setChatContext({ docId: d.historyDocId, claimId: d.historyClaimId, kind: 'history' });
      void loadHistory();
    };
    const chatKey = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`);
    try {
      await readVerifyStream(text, {
        signal: controller.signal,
        idempotencyKey: chatKey,
        onProgress: (p) => setLiveStages((s) => [...s, p]),
        onVerdict: applyChatResult,
      });
    } catch (chatErr) {
      if (controller.signal.aborted) {
        setChatMessages((m) => [...m, { role: 'note', text: 'Check cancelled. Nothing was saved.' }]);
        setAnnounce('Check cancelled.');
        setLiveStages([]);
      } else if (!shouldFallbackAfterStreamError(chatErr)) {
        setChatMessages((m) => [...m, { role: 'note', text: chatErr?.status === 429 ? 'Too many checks. Wait a minute and try again.' : 'That check failed. Try again.' }]);
      } else {
        try {
          const r = await fetch('/api/verify', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': chatKey }, body: JSON.stringify({ claim: text }), signal: controller.signal });
          const d = await r.json().catch(() => ({}));
          if (!r.ok) { setChatMessages((m) => [...m, { role: 'note', text: d.error || 'That check failed. Try again.' }]); return; }
          applyChatResult(d);
        } catch {
          if (controller.signal.aborted) setChatMessages((m) => [...m, { role: 'note', text: 'Check cancelled. Nothing was saved.' }]);
          else setChatMessages((m) => [...m, { role: 'note', text: 'That check did not complete. Try again.' }]);
        }
      }
    } finally { setBusy(''); chatAbortRef.current = null; }
  }
  async function runChatChallenge(kind, customText = '') {
    if (!chatContext) return;
    const labels = { 'stronger-contrary': 'Find stronger evidence against it', 'stronger-support': 'Find stronger evidence for it', 'prove-wrong': 'What would prove this wrong?', 'prove-right': 'What would confirm this?', 'compare-author': 'What does the author say?' };
    if (kind !== 'custom') setChatMessages((m) => [...m, { role: 'user', text: labels[kind] || kind }]);
    setBusy('challenge'); setErr('');
    try {
      const r = await fetch(`/api/documents/${chatContext.docId}/claims/${chatContext.claimId}/challenge`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, text: customText }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) { setChatMessages((m) => [...m, { role: 'note', text: d.error || 'That failed. Try again.' }]); return; }
      setChatMessages((m) => [...m, { role: 'followup', followup: d.followup }]);
      try { const fresh = await (await fetch('/api/documents')).json().catch(() => ({})); if (fresh.documents) { setDocs(fresh.documents); const fd = fresh.documents.find((x) => x.id === chatContext.docId); if (fd) setDoc(fd); } } catch { /* the follow-up is saved; a failed refresh must not call it failed */ }
    } catch { setChatMessages((m) => [...m, { role: 'note', text: 'That did not finish. Try again.' }]); } finally { setBusy(''); }
  }
  async function sendChat() {
    const text = chatText.trim();
    if (!text || busy === 'chat' || busy === 'challenge') return;
    setChatMessages((m) => [...m, { role: 'user', text }]);
    setChatText('');
    if (chatContext) await runChatChallenge('custom', text);
    else await investigateChatClaim(text);
  }
  async function askSuggestion(s) {
    if (!s || busy === 'chat' || busy === 'challenge') return;
    setChatMessages((m) => [...m, { role: 'user', text: s.question }]);
    await investigateChatClaim(s.investigateAs);
  }
  async function openViewer(d) {
    setViewerDoc(d); setViewerBusy(true);
    try {
      const r = await fetch(`/api/documents/${d.id}`);
      const data = await r.json().catch(() => ({}));
      if (!r.ok) { setViewerDoc({ ...d, contentPages: [], viewerError: data.error || 'We could not load this file.' }); return; }
      setViewerDoc(data.document);
    } catch { setViewerDoc({ ...d, contentPages: [], viewerError: 'We could not load this file.' }); } finally { setViewerBusy(false); }
  }
  function askDelete(d) { setViewerDoc(null); setPendingDelete(d); setConfirmTitle(''); setDeleteErr(''); }
  function closeResultPopup() {
    // The popup already showed the full dossier. Keep the page behind it
    // compressed so the claim box stays usable for the next check.
    setResultPopup(null);
    setInlineExpanded(false);
    setBatchExpanded({});
    claimBoxRef.current?.focus();
  }
  function openLibraryExtras() {
    if (!resultPopup) return;
    // A source investigation already has its document and claim picked
    // in the library; a standalone check carries its verdict with it.
    if (!resultPopup.docId) setLibraryFocus(resultPopup);
    setResultPopup(null);
    setInlineExpanded(false);
    setBatchExpanded({});
    setTab('library');
  }
  function popupExportFor(item, docId) {
    const d = docId || item?.historyDocId;
    const c = item?.id || item?.historyClaimId;
    if (!d || !c) return null;
    return () => exportClaim(d, c);
  }
  function rerunPopupText(text) {
    return () => {
      if (text) setClaim(text);
      setResultPopup(null);
      setInlineExpanded(false);
      setBatchExpanded({});
      setTool('claim'); setTab('check');
      setTimeout(() => claimBoxRef.current?.focus(), 0);
    };
  }
  function debatePopupItem(item) {
    if (item?.historyDocId && item?.historyClaimId) seedChatFromClaim(`${item.historyDocId}:${item.historyClaimId}`);
    if (item?.text) setChatText(item.text);
    setResultPopup(null);
    setInlineExpanded(false);
    setBatchExpanded({});
    setTab('claims');
  }
  function askPopupItem(item) {
    if (item?.text) setChatText(item.text);
    setResultPopup(null);
    setInlineExpanded(false);
    setBatchExpanded({});
    setTab('claims');
  }
  async function removeDocument() {
    if (!pendingDelete || confirmTitle.trim() !== pendingDelete.title.trim()) return;
    setBusy('delete'); setDeleteErr('');
    try {
      const r = await fetch(`/api/documents/${pendingDelete.id}`, { method: 'DELETE' });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setDeleteErr(d.error || 'We could not remove this file. Try again.');
      const removedId = pendingDelete.id;
      setDocs((prev) => prev.filter((x) => x.id !== removedId));
      if (doc?.id === removedId) { setDoc(null); setSelected(null); }
      if (viewerDoc?.id === removedId) setViewerDoc(null);
      if (assessDocId === removedId) setAssessDocId('');
      if (assessTarget?.docId === removedId) { setAssessTarget(null); setAssessResult(null); }
      if (chatContext?.docId === removedId) { setChatContext(null); setChatMessages([]); }
      setPendingDelete(null); setConfirmTitle('');
    } catch { setDeleteErr('We could not remove this file. Try again.'); } finally { setBusy(''); }
  }
  async function runBatchVerify() {
    const pending = [];
    realDocs.forEach((d) => (d.claims || []).forEach((c) => { if (!c.verdict) pending.push({ d, c }); }));
    if (!pending.length) { setVaultNote('Everything is already checked. Nothing to do.'); return; }
    const batch = pending.slice(0, 20);
    setBatchBusy(true); setVaultNote(`Checking 0 of ${batch.length}…`);
    let done = 0;
    for (const { d, c } of batch) {
      const fresh = docs.find((x) => x.id === d.id) || d;
      const target = (fresh.claims || []).find((x) => x.id === c.id);
      if (target && !target.verdict) { try { await verifyClaim(target, fresh); } catch { /* the claim stays unchecked */ } }
      done += 1;
      setVaultNote(`Checking ${done} of ${batch.length}…`);
    }
    setBatchBusy(false);
    await loadSafe();
    setVaultNote(pending.length > batch.length ? `Checked ${batch.length}. ${pending.length - batch.length} still to check.` : 'Batch check done. All caught up.');
  }
  async function recheckDoc() {
    if (!doc || busy === 'recheck') return;
    setBusy('recheck'); setDocNote('');
    try {
      const r = await fetch(`/api/documents/${doc.id}/recheck`, { method: 'POST' });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { setDoc(d.document); await loadSafe(); setDocNote('Checked again with fresh evidence.'); }
      else setDocNote(d.error || 'We could not check again. Try again.');
    } catch { setDocNote('We could not check again. Check your connection and try again.'); } finally { setBusy(''); }
  }
  async function exportClaim(docId, claimId) {
    setVaultNote('');
    try {
      const r = await fetch('/api/export', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ docId, claimId }) });
      if (!r.ok) { const d = await r.json().catch(() => ({})); setVaultNote(d.error || 'Export failed. Try again.'); return; }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'truthlens-investigation.md';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch { setVaultNote('Export failed. Check your connection and try again.'); }
  }
  useEffect(() => { setClaimQuery(''); setClaimVerdictFilter(''); setBookBucket('all'); setBookChapter('all'); setShowUpload(false); }, [doc?.id]);
  useEffect(() => {
    if (tab === 'check' && tool === 'claim') claimBoxRef.current?.focus();
  }, [tab, tool]);
  // One shared error banner serves every tool. A failure from one surface
  // (e.g. a website Blocked URL) must not sit under another tool's button,
  // so switching tabs or tools resets it. Each action clears it on start too.
  useEffect(() => { setErr(''); }, [tab, tool]);
  useEffect(() => {
    if (tab === 'claims') chatEndRef.current?.scrollIntoView({ block: 'nearest' });
  }, [chatMessages, liveStages, tab]);
  async function toggleAuto(paused) {
    setDocNote('');
    try {
      const r = await fetch(`/api/documents/${doc.id}/auto`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paused }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { setDoc(d.document); await loadSafe(); setDocNote(paused ? 'Auto-check paused.' : 'Auto-check restarted.'); }
      else setDocNote(d.error || (paused ? 'We could not pause auto-check. Try again.' : 'We could not restart auto-check. Try again.'));
    } catch { setDocNote(paused ? 'We could not pause auto-check. Check your connection and try again.' : 'We could not restart auto-check. Check your connection and try again.'); }
  }
  const shown = selected;
  const lastChatVerdict = [...chatMessages].reverse().find((m) => m.role === 'verdict')?.result || null;
  const verdictClaims = doc?.claims?.filter((c) => c.verdict) || [];
  const shownIdx = shown ? verdictClaims.findIndex((c) => c.id === shown.id) : -1;
  const prevClaim = shownIdx > 0 ? verdictClaims[shownIdx - 1] : null;
  const nextClaim = shownIdx > -1 && shownIdx < verdictClaims.length - 1 ? verdictClaims[shownIdx + 1] : null;
  const realDocs = useMemo(() => docs.filter((d) => d.kind !== 'history'), [docs]);
  const vaultRows = realDocs.flatMap((d) => (d.claims || []).map((c) => ({ doc: d, claim: c })));
  const coveredClaimIds = new Set(vaultRows.map(({ claim }) => claim.id));
  const singleRows = history.filter((e) => e.claimId && !coveredClaimIds.has(e.claimId)).map((e) => ({
    doc: { id: e.docId, title: e.docTitle || 'Single check', kind: e.docKind || 'text', createdAt: e.at },
    claim: { id: e.claimId, text: e.text, verdict: e.verdict, _entry: e, _duplicates: e.duplicateCount },
    single: true,
  }));
  const historyRows = [...vaultRows, ...singleRows];
  const vaultDocCounts = { all: realDocs.length, book: 0, paper: 0, scan: 0 };
  realDocs.forEach((d) => { vaultDocCounts[claimCategory(d)] += 1; });
  const workflowOfRow = ({ doc, claim, single }) => {
    if (single) return claim._entry?.workflow || 'claim';
    if (claim.workflow) return claim.workflow;
    if (doc.kind === 'website') return 'website';
    return 'book';
  };
  const vaultSearched = historyRows.filter((row) => {
    const { doc, claim } = row;
    if (vaultCat !== 'all' && claimCategory(doc) !== vaultCat) return false;
    if (histVerdict && claim.verdict !== histVerdict) return false;
    if (histWorkflow && workflowOfRow(row) !== histWorkflow) return false;
    const q = vaultQuery.trim().toLowerCase();
    return !q || `${claim.text || ''} ${doc.title || ''}`.toLowerCase().includes(q);
  });
  const VAULT_PAGE_SIZE = 6;
  const vaultPageCount = Math.max(1, Math.ceil(vaultSearched.length / VAULT_PAGE_SIZE));
  const vaultPageSafe = Math.min(Math.max(vaultPage, 1), vaultPageCount);
  const vaultPageRows = vaultSearched.slice((vaultPageSafe - 1) * VAULT_PAGE_SIZE, vaultPageSafe * VAULT_PAGE_SIZE);
  const contraOf = (d) => d.report?.distribution?.Contradicted ?? (d.claims || []).filter((c) => c.verdict === 'Contradicted').length;
  const sortedVaultDocs = useMemo(() => [...realDocs].sort((a, b) => {
    if (vaultSort === 'claims') return (b.claims?.length || 0) - (a.claims?.length || 0);
    if (vaultSort === 'verdict') return contraOf(b) - contraOf(a);
    return String(b.createdAt || '') < String(a.createdAt || '') ? -1 : 1;
  }), [realDocs, vaultSort]);

  const visibleClaims = useMemo(() => (doc ? filterClaims(doc.claims, { query: claimQuery, verdict: claimVerdictFilter }) : []), [doc, claimQuery, claimVerdictFilter]);
  const dossierDoc = (doc && doc.kind !== 'history' && doc.kind !== 'website') ? doc : (realDocs.find((d) => d.kind !== 'website') || realDocs[0] || null);
  const scrutiny = useMemo(() => (doc?.kind === 'website' ? scrutinyTelemetry(doc) : null), [doc]);
  useEffect(() => {
    if (!shown) return undefined;
    const onKey = (e) => {
      if (!e.altKey) return;
      if (e.key === 'ArrowLeft' && prevClaim) { e.preventDefault(); setSelected(prevClaim); }
      if (e.key === 'ArrowRight' && nextClaim) { e.preventDefault(); setSelected(nextClaim); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shown, prevClaim, nextClaim]);
  const totalClaims = realDocs.reduce((n, d) => n + (d.claims?.length || 0), 0);
  const checkedClaims = realDocs.reduce((n, d) => n + (d.report?.investigated ?? 0), 0);
  const vaultPct = totalClaims > 0 ? Math.round((checkedClaims / totalClaims) * 100) : 0;
  return (
    <main>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <div className="sr-only" data-announcer aria-live="polite" role="status">{announce}</div>
      <header className="mast">
        <div className="brand"><img className="brand-logo" src="/truthlens-logo.png" alt="TruthLens AI" decoding="async" width={40} height={40} /><span className="brand-stack"><span className="mode">{mode === 'demo' ? 'META API: DEMO' : 'META API: CONNECTED'}</span></span></div>
        <div className="mast-actions"><ThemeToggle /><button type="button" className="btn verify-cta" onClick={() => { setTool('claim'); setTab('check'); }}><Icon name="verify" />New Verification</button></div>
      </header>
      {authOn && <div className="wrap" style={{ paddingBottom: 0 }}>
        {user ? <p className="small">Signed in as <strong>{user}</strong> Only you can see your files. <button className="btn secondary" onClick={() => auth('logout')}>Sign out</button></p>
        : <p className="small">
            <input type="text" placeholder="Username" value={authName} onChange={(e) => setAuthName(e.target.value)} style={{ width: 180, marginRight: 6 }} />
            <input type="password" placeholder="Password" value={authPass} onChange={(e) => setAuthPass(e.target.value)} style={{ width: 180, marginRight: 6 }} />
            <button className="btn secondary" onClick={() => auth('login')}>Sign in</button>{' '}
            <button className="btn secondary" onClick={() => auth('register')}>Register</button>
            <span>You can also use the shared demo book.</span>
          </p>}
      </div>}
      <nav className="topnav" aria-label="Main navigation">
        <div className="topnav-in">
          <button className={tab === 'home' ? 'nav-item on' : 'nav-item'} aria-current={tab === 'home' ? 'page' : undefined} onClick={() => setTab('home')}><Icon name="home" /><span>Home</span></button>
          <button className={tool === 'claim' && tab === 'check' ? 'nav-item on' : 'nav-item'} aria-current={tool === 'claim' && tab === 'check' ? 'page' : undefined} onClick={() => { setTool('claim'); setTab('check'); }}><Icon name="claim" /><span>Check a claim</span></button>
          <button className={tool === 'document' && tab === 'check' ? 'nav-item on' : 'nav-item'} aria-current={tool === 'document' && tab === 'check' ? 'page' : undefined} onClick={() => { setTool('document'); setTab('check'); }}><Icon name="book" /><span>Check a book</span></button>
          <button className={tab === 'claims' ? 'nav-item on' : 'nav-item'} aria-current={tab === 'claims' ? 'page' : undefined} onClick={() => setTab('claims')}><Icon name="question" /><span>Debate a claim</span>{totalClaims ? <span className="nav-badge">{totalClaims}</span> : null}</button>
          <button className={tab === 'library' ? 'nav-item on' : 'nav-item'} aria-current={tab === 'library' ? 'page' : undefined} onClick={() => setTab('library')}><Icon name="library" /><span>Workspace Library</span>{docs.filter((d) => d.kind !== 'history').length ? <span className="nav-badge">{docs.filter((d) => d.kind !== 'history').length}</span> : null}</button>
          <button className={tab === 'history' ? 'nav-item on' : 'nav-item'} aria-current={tab === 'history' ? 'page' : undefined} onClick={() => { setTab('history'); void loadHistory(); }}><Icon name="history" /><span>Past checks</span>{history.length ? <span className="nav-badge">{history.length}</span> : null}</button>
        </div>
      </nav>
      <div className="wrap">
          <div className="content" id="main-content" tabIndex={-1}>
        {tab === 'home' && (
          <div data-home>
            <section className="home-hero">
              <p className="home-eyebrow"><span className="live-dot" aria-hidden="true" />{mode === 'demo' ? 'EMPIRICAL PROTOCOL · DEMO' : 'LIVE EMPIRICAL PROTOCOL'} · Fast checks with evidence you can see</p>
              <h1 className="home-title">Do not just read it. Check it.</h1>
              <p className="home-lede">Type or speak a claim. Or add a book or a website. TruthLens finds the claims, loads sources, and reads them. It only uses text it read. Each answer shows that text. If we cannot test a claim, we say <strong>Unverifiable</strong>. We do not guess.</p>
              <div className="hero-check" data-home-check role="group" aria-label="Check tools">
                <div className="hero-pills">
                  <button type="button" className="pill on" onClick={() => claimBoxRef.current?.focus()}><Icon name="claim" />Type Claim or speak it</button>
                  <button type="button" className="pill" onClick={() => { setTool('document'); setTab('check'); }}><Icon name="upload" />Attach File (PDF, image, audio, video)</button>
                  <button type="button" className="pill" onClick={() => { setTool('website'); setTab('check'); }}><Icon name="website" />Inspect URL</button>
                </div>
                <div className="input-with-mic hero-box">
                  <textarea ref={claimBoxRef} value={claim} onChange={(e) => setClaim(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void verify(); } }} aria-label="Claim to verify. Type or dictate with the mic." rows={4} placeholder="Enter an empirical claim to verify against academic, archival, and primary sources..." />
                  <MicButton variant="inline" label="Dictate a claim" onText={(t) => setClaim((prev) => (prev.trim() ? `${prev.trim()}\n${t}` : t))} />
                </div>
                <p className="small">Type in the box or hold the mic and speak. Both run the same check.</p>
                <div className="hero-verify-row">
                  <button type="button" className="btn secondary" onClick={() => setClaim('')}>Clear</button>
                  <button type="button" className="btn" onClick={verify} disabled={busy === 'verify' || claimLines().length === 0}><Icon name="verify" />{busy === 'verify' ? 'Checking…' : claimLines().length > 1 ? `Check these ${claimLines().length} claims` : 'Verify'}</button>
                  {busy === 'verify' && <button type="button" className="btn secondary danger-text" onClick={cancelCheck}><Icon name="stop" />Cancel check</button>}
                </div>
                {busy === 'verify' && <p className="small">We are loading and reading sources. This can take 30 to 60 seconds.</p>}
                {liveStages.length > 0 && tab === 'home' && <AgentTimeline stages={liveStages} />}
                {streamNote && tab === 'home' && <p className="small" role="status">{streamNote}</p>}
                {err && tab === 'home' && <div className="error">{err}</div>}
                <div className="demo-chips" data-demo-claims>
                  <span className="small">TRY ONE:</span>
                  <button type="button" className="chip" onClick={() => setClaim('Water boils at 100 degrees Celsius at sea level.')}>Water boils at 100°C at sea level</button>
                  <button type="button" className="chip" onClick={() => setClaim('Humans only use 10% of their brains.')}>Humans only use 10% of their brains</button>
                  <button type="button" className="chip" onClick={() => setClaim('The village of Upper Snelgrove brewed exactly 41 barrels of ale in March 1731.')}>A claim we cannot check</button>
                </div>
              </div>
            </section>
            <Personas />
            <section className="mock-taxonomy" data-taxonomy aria-label="Verdict taxonomy">
              <div className="mock-tax-head">
                <div>
                  <p className="mock-kicker">Decisive Adjudication</p>
                  <h2>Each check ends in one of these verdicts</h2>
                </div>
                <p className="mock-side">Zero ambiguity. Every claim receives a singular categorized verdict based strictly on unabridged citations and cross-checked primary literature.</p>
              </div>
              <div className="mock-tax-grid">
                <article className="mock-tax-card"><span className="mock-tax-ic v-Supported"><span className="material-symbols-outlined">check_circle</span></span><h3>Supported</h3><p>Conclusive backing from authoritative primary records.</p></article>
                <article className="mock-tax-card"><span className="mock-tax-ic v-Contradicted"><span className="material-symbols-outlined">cancel</span></span><h3>Contradicted</h3><p>Direct empirical evidence refutes the asserted claim.</p></article>
                <article className="mock-tax-card"><span className="mock-tax-ic v-Partially-supported"><span className="material-symbols-outlined">flaky</span></span><h3>Partially Supported</h3><p>Accurate core elements mixed with unsubstantiated scope.</p></article>
                <article className="mock-tax-card"><span className="mock-tax-ic v-Misleading"><span className="material-symbols-outlined">warning</span></span><h3>Misleading</h3><p>Technically factual citations framed to prompt false conclusions.</p></article>
                <article className="mock-tax-card"><span className="mock-tax-ic v-Outdated"><span className="material-symbols-outlined">history</span></span><h3>Outdated</h3><p>Formerly accepted premises superseded by newer discoveries.</p></article>
                <article className="mock-tax-card"><span className="mock-tax-ic v-Unverifiable"><span className="material-symbols-outlined">help_center</span></span><h3>Unverifiable</h3><p>Insufficient empirical public literature. We do not guess.</p></article>
              </div>
            </section>
            <section className="home-section" data-multimodal>
              <div className="vault-section-head">
                <div>
                  <p className="mock-kicker">Multimodal Ingestion</p>
                  <h2>Images and video too</h2>
                </div>
                <p className="home-body mock-side">Add PDFs, manuscripts, voice clips, or video files up to 100MB. TruthLens extracts claims from any format and runs identical adversarial verification.</p>
              </div>
              <div className="format-grid">
                <article className="format-card"><span className="format-icon tone-green" data-format-icon="book"><span className="material-symbols-outlined">description</span></span><h3>Documents & Books</h3><p>PDF, DOCX, TXT manuscripts. Claims segmented chapter by chapter.</p></article>
                <article className="format-card"><span className="format-icon tone-cyan" data-format-icon="website"><span className="material-symbols-outlined">public</span></span><h3>Websites & URLs</h3><p>Paste single articles or full subdomains for automated extraction.</p></article>
                <article className="format-card"><span className="format-icon tone-rose" data-format-icon="image"><span className="material-symbols-outlined">image</span></span><h3>Image OCR & Visuals</h3><p>PNG, JPEG, WebP up to 10MB. Muse Spark transcribes image claim text.</p></article>
                <article className="format-card"><span className="format-icon tone-amber" data-format-icon="video"><span className="material-symbols-outlined">videocam</span></span><h3>Audio & Video</h3><p>Speech transcription for audio (up to 50MB) and video (up to 100MB), plus 10s visual frame descriptors for video. Muse Voice Transcribe writes down the speech.</p></article>
              </div>
            </section>
            <section className="mock-features" aria-label="What you get with each check">
              <p className="mock-kicker center">Architecture of Integrity</p>
              <h2 className="center">What you get with each check</h2>
              <p className="mock-sub center">TruthLens does not synthesize generic AI prose. It orchestrates a verifiable evidence pipeline with strict isolation boundaries.</p>
              <div className="mock-feat-grid">
                <article className="mock-feat-card"><span className="mock-feat-ic blue"><span className="material-symbols-outlined">balance</span></span><h3>Evidence for and against</h3><p>We load and read each source in its full context. Every quote links to its original primary source. You inspect the exact words, not an opaque summary.</p><div className="mock-quote"><p><span>Nature Geoscience (Vol. 14)</span><span>Direct link</span></p><p className="mock-quote-text">“…empirical measurements indicate boiling equilibria occurs precisely at 99.97°C under 101.325 kPa standard atmospheres.”</p></div></article>
                <article className="mock-feat-card"><span className="mock-feat-ic green"><span className="material-symbols-outlined">groups_3</span></span><h3>Three checks of the same evidence</h3><p>A Researcher, a Fact-checker, and an Adversarial Skeptic evaluate the data concurrently. If our autonomous agents disagree, we display the dialectic debate in full.</p><div className="mock-triad"><span className="agent-r"><span className="material-symbols-outlined">explore</span>Researcher</span><span className="agent-f"><span className="material-symbols-outlined">fact_check</span>Fact-checker</span><span className="agent-s"><span className="material-symbols-outlined">psychology_alt</span>Skeptic</span></div></article>
                <article className="mock-feat-card"><span className="mock-feat-ic cyan"><span className="material-symbols-outlined">tune</span></span><h3>Two scores, kept apart</h3><p>How many citations clearly take a side, and how strong the underlying evidence is. We never collapse complex evidence into a single reductive truth percentage.</p><div className="mock-scores"><span><b>94%</b>Consensus Side</span><span><b>A+</b>Source Quality</span></div></article>
              </div>
            </section>
            <section className="home-section" data-how-it-works>
              <div className="vault-section-head">
                <div>
                  <p className="mock-kicker">Forensic Standard</p>
                  <h2>How we check a claim</h2>
                </div>
                <p className="home-body mock-side">Step-by-step uncompromised empirical verification procedure.</p>
              </div>
              <div className="steps">
                <article className="step-card"><p className="step-num">01</p><h3>Find claims</h3><p>We preserve your words verbatim. We never paraphrase or soften claims before ingestion.</p></article>
                <article className="step-card"><p className="step-num">02</p><h3>Find evidence</h3><p>We search both sides aggressively. We load raw pages and read them. Only text read is utilized.</p></article>
                <article className="step-card"><p className="step-num">03</p><h3>Strip prompts</h3><p>We neutralize prompt injections and hidden instructions embedded in web text before scoring.</p></article>
                <article className="step-card"><p className="step-num">04</p><h3>Test both sides</h3><p>Our three distinct autonomous checkers pit supporting evidence against counter-hypotheses.</p></article>
                <article className="step-card"><p className="step-num">05</p><h3>Decide</h3><p>Assign a formal taxonomy verdict with complete citations so you can scrutinize every word yourself.</p></article>
              </div>
            </section>
            <section className="mock-ticker" data-ticker aria-label="Your work so far">
              <div className="mock-ticker-label">
                <p className="mock-kicker"><span className="live-dot" aria-hidden="true" />Workspace Activity</p>
                <h2>Your work so far</h2>
                <p className="mock-sub">These figures reflect your local encrypted workspace vault.</p>
              </div>
              <div className="mock-ticker-num"><b>{realDocs.length}</b><span>Documents in Library</span></div>
              <div className="mock-ticker-num"><b>{totalClaims}</b><span>Claims Checked</span></div>
              <div className="mock-ticker-num"><b>{history.length}</b><span>Saved Dossiers</span></div>
              <div className="mock-ticker-num big"><b>100%</b><span>Auditable Proof</span></div>
              <div className="mock-ticker-ctas">
                <button type="button" className="btn secondary" onClick={() => setTab('library')}><span className="material-symbols-outlined">folder_open</span>Open Library</button>
                <button type="button" className="btn" onClick={() => { setTool('claim'); setTab('check'); }}>Inspect Claim<span className="material-symbols-outlined">arrow_forward</span></button>
              </div>
            </section>
          </div>
        )}
        {tab === 'check' && (
          <section className="panel">
            <h2>Check</h2>
            <p className="small">Pick a tool at the top. Each tool works the same way: find evidence, read it, decide.</p>
            <div className="omnibar" data-omnibar role="group" aria-label="Check tools">
              <button type="button" className={tool === 'claim' ? 'pill on' : 'pill'} aria-pressed={tool === 'claim'} onClick={() => setTool('claim')}><Icon name="claim" />Type a claim or speak it</button>
              <button type="button" className={tool === 'document' ? 'pill on' : 'pill'} aria-pressed={tool === 'document'} onClick={() => setTool('document')}><Icon name="upload" />Ask a source anything</button>
              <button type="button" className={tool === 'website' ? 'pill on' : 'pill'} aria-pressed={tool === 'website'} onClick={() => setTool('website')}><Icon name="website" />Inspect a URL</button>
            </div>
            {tool === 'claim' && (
              <div data-claim-entry>
                <h3>Type or speak a claim</h3>
                <p className="small">Type in the box or hold the mic and speak. Both fill the same box and run the same check. You can edit before you verify.</p>
                <p className="small">Type one claim per line. You can type many. We check them in order. We look for evidence on both sides and show you the quotes we used. Each verdict is saved in Past checks. Your text stays on this device until you run it.</p>
                <div className="demo-chips" data-demo-claims>
                  <span className="small">Try:</span>
                  <button type="button" className="chip" onClick={() => setClaim('Water boils at 100 degrees Celsius at sea level.')}>Water boils at 100°C at sea level</button>
                  <button type="button" className="chip" onClick={() => setClaim('Humans only use 10% of their brains.')}>Humans only use 10% of their brains</button>
                  <button type="button" className="chip" onClick={() => setClaim('The village of Upper Snelgrove brewed exactly 41 barrels of ale in March 1731.')}>Upper Snelgrove brewed exactly 41 barrels of ale in March 1731</button>
                </div>
                <div className="input-with-mic">
                  <textarea ref={claimBoxRef} value={claim} onChange={(e) => setClaim(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void verify(); } }} aria-label="Claims to verify, one per line" rows={5} placeholder={'One claim per line, for example:\nWater boils at 100 degrees Celsius at sea level.\nHumans only use 10% of their brains.'} />
                  <MicButton variant="inline" label="Dictate a claim" onText={(t) => setClaim((prev) => (prev.trim() ? `${prev.trim()}\n${t}` : t))} />
                </div>
                <p className="small">Hold the mic, speak, then let go. Your words go in the box. You can edit them.</p>
                <p><button className="btn" onClick={verify} disabled={busy === 'verify' || claimLines().length === 0}><Icon name="verify" />{busy === 'verify' ? 'Checking…' : claimLines().length > 1 ? `Check these ${claimLines().length} claims` : 'Verify this claim'}</button>{' '}{busy === 'verify' && <button type="button" className="btn secondary danger-text" onClick={cancelCheck}><Icon name="stop" />Cancel check</button>}{claimLines().length > 1 && <span className="small"> {claimLines().length} claims. We will check them in order.</span>}<span className="small"> Ctrl+Enter checks too (Cmd+Enter on a Mac).</span></p>
                {busy === 'verify' && <p className="small">We are loading and reading sources. This can take 30 to 60 seconds. Keep this tab open. Your answer will show here. Cancel any time. A cancelled check saves nothing.</p>}
                {liveStages.length > 0 && <AgentTimeline stages={liveStages} />}
                {streamNote && <p className="small" role="status">{streamNote}</p>}
                {queue.length > 0 && <div data-claim-queue><div className="rule" /><h3><Icon name="history" />Your claims</h3><p className="small">We check them in order. Answers are saved in Past checks.</p>{queue.map((q, i) => <p className="small" key={i}>{q.state === 'done' && q.verdict ? <span className={cls(q.verdict)}>{q.verdict}</span> : <span className="stamp v-Unverifiable">{q.state === 'running' ? 'Checking…' : q.state === 'failed' ? 'Failed' : 'Waiting'}</span>} {q.text}{q.error ? ` (${q.error})` : ''}</p>)}<p><button className="btn secondary" onClick={() => { setQueue([]); setBatchResults([]); setBatchExpanded({}); }}>Clear list</button></p></div>}
                {batchResults.length > 0 && <div data-batch-results><div className="rule" /><h3>Checks done ({batchResults.length})</h3><p className="small">Compressed so you can start the next check. Open one for its full evidence. All answers are saved in Past checks.</p>{batchResults.map((r, i) => { const open = !!batchExpanded[i]; return <div key={i} data-collapsed-batch><p className="small"><span className={cls(r.verdict)}>{r.verdict}</span> <strong>{r.text}</strong></p><p><button type="button" className="btn secondary" aria-expanded={open} onClick={() => setBatchExpanded((prev) => ({ ...prev, [i]: !prev[i] }))}>{open ? 'Hide full result' : 'Show full result'}</button></p>{open && <VerdictView r={r} />}</div>; })}<p><button className="btn secondary" onClick={() => { setBatchResults([]); setBatchExpanded({}); setQueue([]); }}>Clear</button></p></div>}
                {result && !selected && <div data-result-inline><div className="rule" /><div className="ev" data-collapsed-result><p><span className={cls(result.verdict)}>{result.verdict}</span></p><p><strong>{result.text}</strong></p><p className="small">{result.explanation}</p><p className="small">Compressed so you can type the next claim above. The full evidence stays one tap away. Saved in Past checks.</p><p><button type="button" className="btn secondary" aria-expanded={inlineExpanded} onClick={() => setInlineExpanded((v) => !v)}>{inlineExpanded ? 'Hide full result' : 'Show full result'}</button>{' '}<button type="button" className="btn secondary" onClick={() => { claimBoxRef.current?.focus(); }}>New claim</button>{' '}<button className="btn secondary" onClick={() => { setResult(null); setTurns([]); setInlineExpanded(false); }}>Clear</button></p></div>{inlineExpanded && <VerdictView r={result} />}</div>}
                {turns.length > 0 && <div><div className="rule" /><h3>Earlier in this conversation</h3>{turns.map((t, i) => <p className="small" key={i}><span className={cls(t.verdict)}>{t.verdict}</span> {t.text}</p>)}</div>}
              </div>
            )}
            {tool === 'document' && (
              <div className="doc-ingest-bar" data-ingest-topbar>
                <button type="button" className="btn ingest-hero" onClick={() => setShowUpload(true)} aria-label="Ingest a new manuscript"><Icon name="upload" />Ingest New Manuscript</button>
                <p className="small">Add a book or paper to check its claims. PDF, DOCX, text, images, audio or video.</p>
                {dossierDoc && showUpload && <p><button type="button" className="btn secondary" onClick={() => setShowUpload(false)}><Icon name="back" />Back to dossier</button></p>}
              </div>
            )}
            {tool === 'document' && dossierDoc && !showUpload && (
              <BookDossier
                doc={dossierDoc}
                docs={realDocs.filter((d) => d.kind !== 'website')}
                bucket={bookBucket}
                chapter={bookChapter}
                onBucket={setBookBucket}
                onChapter={setBookChapter}
                onSelectDoc={(id) => { const d = realDocs.find((x) => x.id === id); if (d) { setDoc(d); setSelected(null); } }}
                onVerifyClaim={(c) => verifyClaim(c, dossierDoc)}
                busy={busy}
                onExportClaim={exportClaim}
                onDebate={() => { if (dossierDoc && dossierDoc.claims?.some((c) => c.verdict)) seedChatFromClaim(`${dossierDoc.id}:${(dossierDoc.claims.find((c) => c.verdict) || {}).id}`); setTab('claims'); }}
              />
            )}
            {tool === 'document' && (!dossierDoc || showUpload) && (
              <div data-upload>
                {dossierDoc && <p><button type="button" className="btn secondary" onClick={() => setShowUpload(false)}><Icon name="back" />Back to dossier</button></p>}
                <p className="small">Add one file: a document (PDF, DOCX, TXT, MD), an image (PNG, JPG, WebP, GIF), audio (MP3, WAV, M4A, OGG, FLAC), or video (MP4, MOV, WebM, MKV). We pull out the text, find its claims, and check the important ones first. It goes to the Library.</p>
                <div className={dragging ? 'dropzone dragging' : 'dropzone'} data-upload-drop role="button" tabIndex={0} aria-label="Upload a file. Press Enter to browse, or drop a file here." onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && busy !== 'doc') { e.preventDefault(); fileInputRef.current?.click(); } }} onDragEnter={(e) => { e.preventDefault(); dragCount.current += 1; setDragging(true); }} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => { dragCount.current -= 1; if (dragCount.current <= 0) { dragCount.current = 0; setDragging(false); } }} onDrop={(e) => { e.preventDefault(); dragCount.current = 0; setDragging(false); void uploadFile({ target: { files: e.dataTransfer.files } }); }} onPaste={(e) => { if (e.clipboardData?.files?.length) { e.preventDefault(); void uploadFile({ target: { files: e.clipboardData.files } }); } }}>
                  <span className="format-icon drop-icon"><Icon name="upload" /></span>
                  <strong className="drop-title">{busy === 'doc' ? `Uploading${uploadName ? ` ${uploadName}` : ''}. Finding claims…` : dragging ? 'Drop to upload' : 'Drag & drop your file here'}</strong>
                  <span className="small">Or press Enter to browse. You can paste a file here too. For images, we first write what they show. For audio and video, we first write down the speech. Then we find claims.</span>
                  <span className="drop-formats">{['PDF', 'DOCX', 'TXT', 'MD', 'PNG', 'JPG', 'WebP', 'GIF', 'MP3', 'WAV', 'M4A', 'OGG', 'FLAC', 'MP4', 'MOV', 'WebM'].map((f) => <span className="drop-chip" key={f}>{f}</span>)}</span>
                  <span className="btn drop-browse"><Icon name="upload" />Browse files</span>
                  <span className="small">PDF and DOCX up to 15 MB · Images up to 10 MB · Audio up to 50 MB and 10 minutes · Video up to 100 MB and 10 minutes</span>
                  <input ref={fileInputRef} className="file-hidden" type="file" accept=".pdf,.docx,.txt,.md,.png,.jpg,.jpeg,.webp,.gif,.mp3,.wav,.m4a,.ogg,.oga,.opus,.flac,.aac,.mp4,.mov,.webm,.mkv,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/*,audio/*,video/*" onChange={uploadFile} disabled={busy === 'doc'} />
                </div>
                <p className="small">Muse Spark describes images. Muse Voice Transcribe writes down speech in audio and video. We check that text like a book.</p>
                <p className="small">Or paste text:</p>
                <input type="text" placeholder="File title" value={title} onChange={(e) => setTitle(e.target.value)} />
                <p><textarea placeholder="Paste text here. Long text is fine." value={text} onChange={(e) => setText(e.target.value)} /></p>
                <button className="btn secondary" onClick={addDoc} disabled={busy === 'doc'}><Icon name="book" />{busy === 'doc' ? 'Finding claims…' : 'Find claims and check'}</button>
              </div>
            )}
            {tool === 'website' && (
              <div data-website>
                <p className="small">Give us a web page. We load it, take out the text, and find its claims. One page at a time. Some pages block us. If so, we will tell you. We will not make up text.</p>
                <p><label className="small"><Icon name="website" />Website address<br /><input type="text" placeholder="https://example.org/article" value={siteUrl} onChange={(e) => setSiteUrl(e.target.value)} aria-label="Website address" /></label></p>
                <input type="text" placeholder="Title (you can leave this blank)" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Website title" />
                <p><button className="btn" onClick={addWebsite} disabled={busy === 'doc'}><Icon name="website" />{busy === 'doc' ? 'Loading page. Finding claims…' : 'Load and check'}</button></p>
                <p className="small">The page goes to the Library. Its address stays on the card, so you can open the first page.</p>
              </div>
            )}
            {tool === 'document' && (
              <div data-assess-form>
                <div className="rule" />
                <h3>Ask this source anything</h3>
                <p className="small">Ask a book or a website a question. Or test your own idea about it. We find the parts of the text about your idea. We show what the author says. Then we check it with outside evidence.</p>
                {realDocs.length === 0 ? <p className="small">Add a book or a website first.</p> : (
                  <>
                    <p><label className="small">Pick a file<br /><select value={assessDocId || realDocs[0]?.id || ''} onChange={(e) => setAssessDocId(e.target.value)} aria-label="Choose a document">{docs.filter((d) => d.kind !== 'history').map((d) => <option key={d.id} value={d.id}>{d.kind === 'website' ? `${d.title} (website)` : d.title}</option>)}</select></label></p>
                    <div className="input-with-mic">
                      <textarea placeholder="For example: The dam was built for votes, not for safety." value={theory} onChange={(e) => setTheory(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && busy !== 'assess') { e.preventDefault(); void assess(assessDocId || realDocs[0]?.id); } }} aria-label="Your question or idea" />
                      <MicButton variant="inline" label="Dictate a theory" onText={(t) => setTheory((prev) => (prev.trim() ? `${prev.trim()} ${t}` : t))} />
                    </div>
                    <p className="small">Hold the mic, speak, then let go. Your words go in the box. You can edit them.</p>
                    <p><button className="btn" onClick={() => assess(assessDocId || realDocs[0]?.id)} disabled={busy === 'assess'}><Icon name="question" />{busy === 'assess' ? 'Checking…' : 'Check this'}</button>{busy === 'assess' && <span className="small"> This can take 30 to 60 seconds.</span>}</p>
                  </>
                )}
                {assessResult && (
                  <div data-assess-inline>
                    <div className="rule" />
                    <VerdictView r={assessResult} docId={doc?.id} />
                    <div className="ev" data-debate>
                      <h3><Icon name="search" />Question this answer</h3>
                      <p className="small">Do you disagree? Ask more below. We add the new check to the record. The first answer stays.</p>
                      <ChallengeButtons onChallenge={(kind) => challenge(kind, assessTarget)} busy={busy} />
                      <p><input type="text" placeholder="Or type your own question…" value={challengeText} onChange={(e) => setChallengeText(e.target.value)} /> <button className="btn secondary" onClick={() => challenge('custom', assessTarget)} disabled={busy === 'challenge'}><Icon name="verify" />Check</button>{busy === 'challenge' && <span className="small"> Checking…</span>}</p>
                      <p><button className="btn secondary" onClick={() => setTab('library')}><Icon name="library" />See the full result in the Library</button></p>
                    </div>
                  </div>
                )}
              </div>
            )}
            {err && <div className="error">{err}</div>}
          </section>
        )}
        {tab === 'library' && (
          <div data-vault>
            <p className="vault-eyebrow">CORPUS DOSSIER VAULT <span className="vault-dot" aria-hidden="true" /> <span className="vault-id">Vault ID: #TL-9804-ARC</span></p>
            <div className="vault-head">
              <div>
                <h2>Workspace Library & Past Checks</h2>
                <p className="small">Central forensic repository for adjudicated manuscripts, raw paper scans, historical OCR transcripts, and verified multi-agent dossiers.</p>
              </div>
              <div className="vault-actions">
                <button type="button" className="btn secondary" onClick={() => setTab('check')}><Icon name="upload" />Upload New Source</button>
                <button type="button" className="btn" onClick={runBatchVerify} disabled={batchBusy}><Icon name="verify" />{batchBusy ? 'Checking…' : 'Run Batch Verification'}</button>
              </div>
            </div>
            {vaultNote && <p className="small" role="status">{vaultNote}</p>}
            {loadErr && <p className="error" role="alert">{loadErr}</p>}
            {!loaded ? <p className="small" role="status">Loading your files…</p> : docs.length === 0 && !loadErr && <p className="small">No files yet. Add one from the check tab.</p>}
            <div className="stat-cards" data-vault-stats>
              <div className="stat-card">
                <div className="stat-top"><span>Indexed Corpus</span><Icon name="library" /></div>
                <div className="stat-num">{realDocs.length}</div>
                <div className="small">Documents in Library</div>
              </div>
              <div className="stat-card">
                <div className="stat-top"><span>Claims Extracted</span><Icon name="claim" /></div>
                <div className="stat-num">{totalClaims}</div>
                <div className="small">Claims Found across all files</div>
              </div>
              <div className="stat-card">
                <div className="stat-top"><span>Adjudication Rate</span><Icon name="verify" /></div>
                <div className="stat-rate">
                  <span className="stat-num good">{vaultPct}%</span>
                  <svg className="stat-ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15.9155" fill="none" strokeWidth="3.5" className="ring-bg" /><circle cx="18" cy="18" r="15.9155" fill="none" strokeWidth="3.5" className="ring-fg" strokeDasharray={`${vaultPct}, 100`} strokeLinecap="round" /></svg>
                </div>
                <div className="small">{checkedClaims} of {totalClaims} Claims Checked</div>
              </div>
              <div className="stat-card">
                <div className="stat-top"><span>Forensic Reports</span><Icon name="history" /></div>
                <div className="stat-num">{history.length}</div>
                <div className="small">Saved Dossiers Exportable</div>
              </div>
              <div className="stat-card sync">
                <div className="stat-top"><span className="good">Engine Sync</span><span className={mode === 'demo' ? 'sync-dot idle' : 'sync-dot live'} aria-hidden="true" /></div>
                <div className="stat-sync">{mode === 'demo' ? 'Demo Mode' : 'Meta API: Live Mode'}</div>
                <div className="small">{mode === 'demo' ? 'Add a Meta key for live checks.' : 'Dialectic Pipeline: Ready'}</div>
              </div>
            </div>
            <div className="vault-section-head">
              <div>
                <h3>Source Ingestions & Books</h3>
                <p className="small">Extracted source files subjected to multi-agent adversarial inquiry.</p>
              </div>
              <label className="small vault-sort">Sort by: <select value={vaultSort} onChange={(e) => setVaultSort(e.target.value)} aria-label="Sort sources"><option value="recent">Most Recent</option><option value="claims">Claim Density</option><option value="verdict">Contradiction Count</option></select></label>
            </div>
            <div className="vault-split">
              <aside className="vault-rail" aria-label="Source files">
            <div className="vault-cards" data-vault-docs>
              {sortedVaultDocs.map((d) => {
                const total = d.report?.totalClaims ?? (d.claims?.length || 0);
                const done = d.report?.investigated ?? (d.claims || []).filter((c) => c.verdict).length;
                const pct = total > 0 ? Math.round((done / total) * 100) : 0;
                const dist = d.report?.distribution || (() => { const m = {}; (d.claims || []).forEach((c) => { const k = c.verdict || 'Not checked yet'; m[k] = (m[k] || 0) + 1; }); return m; })();
                const ext = String(d.media?.file?.ext || '').toUpperCase();
                const badge = d.kind === 'website' ? 'WEB PAGE' : d.kind === 'image' ? 'OCR • IMAGE' : d.kind === 'video' ? 'VIDEO' : d.kind === 'audio' ? 'AUDIO' : `${ext || 'DOC'} • ${d.pages || '?'} PGS`;
                const tag = d.kind === 'website' ? 'Website' : d.kind === 'image' ? 'Muse Spark' : d.kind === 'video' ? 'Transcript' : d.kind === 'audio' ? 'Transcript' : ext === 'PDF' ? 'PDF' : ext === 'DOCX' ? 'DOCX' : 'Manuscript';
                const icon = d.kind === 'website' ? 'website' : d.kind === 'image' ? 'image' : d.kind === 'video' ? 'video' : d.kind === 'audio' ? 'audio' : 'book';
                const blurb = ((d.claims?.[0]?.text || '').slice(0, 140)) || 'No claims extracted yet.';
                return (
                  <article className="vault-card" key={d.id} onClick={() => { setDoc(d); setSelected(null); }}>
                    <div className="vault-card-top">
                      <span className={`vault-ic k-${d.kind}`}><Icon name={icon} /></span>
                      <span className="vault-badge">{badge}</span>
                    </div>
                    <button type="button" className="vault-card-title" onClick={() => { setDoc(d); setSelected(null); }} aria-label={`Open claims for ${d.title}`}>
                      <span className="vault-card-title-text">{d.title}</span><span className="vault-tag">{tag}</span>
                    </button>
                    <p className="small vault-blurb">{blurb}</p>
                    <div className="vault-card-meta">
                      <span>{total} Extracted Claim{total === 1 ? '' : 's'}</span>
                      <span className={done === total && total > 0 ? 'good' : ''}>{total === 0 ? 'No claims yet' : done === total ? `${pct}% Analyzed` : `${done} of ${total} checked`}</span>
                    </div>
                    {total > 0 && <div className="vault-bar" aria-hidden="true">{Object.entries(dist).map(([k, v]) => v > 0 ? <span key={k} className={`dist-seg v-${String(k).replaceAll(' ', '-')}`} style={{ width: `${(v / total) * 100}%` }} title={`${k}: ${v}`} /> : null)}</div>}
                    {total > 0 && <p className="vault-chips">{Object.entries(dist).map(([k, v]) => v > 0 ? <span key={k} className="vault-chip">{v} {k === 'Partially supported' ? 'Partial' : k}</span> : null)}</p>}
                    {d.quarantined > 0 && <p className="small">We removed hidden instructions to an AI from {d.quarantined} page(s). They did not change the verdict.</p>}
                    <div className="vault-card-foot">
                      <span className="small">{timeAgo(d.createdAt) || 'Date unknown'}{d.status === 'verifying' ? ' · checking…' : ''}</span>
                      <span className="vault-card-btns">
                        <button type="button" className="icon-btn" title="Deep inspection" aria-label={`Inspect ${d.title}`} onClick={(e) => { e.stopPropagation(); setDoc(d); setSelected(null); }}><Icon name="search" /></button>
                        <button type="button" className="icon-btn" title="View file" aria-label={`View file ${d.title}`} onClick={(e) => { e.stopPropagation(); openViewer(d); }}><Icon name="view" /></button>
                        <button type="button" className="icon-btn danger" title="Remove file" aria-label={`Remove ${d.title}`} onClick={(e) => { e.stopPropagation(); askDelete(d); }}><Icon name="trash" /></button>
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
            {sortedVaultDocs.length === 0 && <p className="small">No files yet. Add one from the check tab.</p>}
              </aside>
              <div className="vault-detail">
        {libraryFocus && (
          <section data-library-focus>
            <h2>Full result</h2>
            <p className="small">Your last check, with its evidence. <button type="button" className="btn secondary" onClick={() => setLibraryFocus(null)}>Clear</button></p>
            {libraryFocus.result && <VerdictView r={libraryFocus.result} />}
            {libraryFocus.results?.map((r, i) => <div key={i}><div className="rule" /><VerdictView r={r} /></div>)}
            <p>
              <button type="button" className="btn secondary" onClick={() => { setLibraryFocus(null); setTool('claim'); setTab('check'); }}><Icon name="claim" />Check another claim</button>{' '}
              <button type="button" className="btn secondary" onClick={() => { setTab('history'); void loadHistory(); }}><Icon name="history" />Open Past checks</button>{' '}
              <span className="small">This answer is saved there. For a file, you can also question it, check it again, or remove it below.</span>
            </p>
            <div className="rule" />
          </section>
        )}
        {contraErr && !shown && <p className="small" role="status">{contraErr} <button type="button" className="btn secondary" onClick={() => void loadSafe()}>Retry</button></p>}
        {contra.length > 0 && !shown && <section><div className="rule" /><h2>Where your files disagree</h2><p className="small">Your files say different things about the same topic. Open a claim to see its evidence.</p>{contra.map((e, i) => <div className="ev" key={i}><div className="meta">Topic · {e.topic} · {e.verifiedDisagreement ? 'Checked. They disagree' : 'Not checked yet'}</div>{e.positions.map((pos, j) => <p key={j}><strong>{pos.docTitle}</strong> (p{pos.page}): {pos.text} <span className={cls(pos.verdict)}>{pos.verdict}</span></p>)}<p className="small">{e.scopeNote}</p></div>)}</section>}
        <div className="doc-layout">
          {!shown && <div className="doc-main">
        {doc && doc.kind !== 'history' && (
          <section><div className="rule" /><h2>{doc.title}</h2>
            {doc.kind === 'website' && safeHttpUrl(doc.sourceUrl) && <p className="small">From a website. <a href={safeHttpUrl(doc.sourceUrl)} target="_blank" rel="noreferrer">Open the first page</a></p>}
            {doc.kind === 'website' && doc.sourceUrl && !safeHttpUrl(doc.sourceUrl) && <p className="small">From a website.</p>}
            {doc.kind === 'image' && doc.media?.caption && <p className="small">What the image shows, by Muse Spark: “{doc.media.caption}”</p>}
            {(doc.kind === 'video' || doc.kind === 'audio') && doc.media?.transcript && <p className="small">Transcript: {doc.media.transcript}</p>}
            <p className="small">{doc.status === 'verifying' ? 'We are checking key claims now. You can also check claims below.' : doc.status === 'paused' ? 'Auto-check is paused.' : 'Auto-check is done.'} {doc.report ? `${doc.report.autoVerified ?? 0} checked by us · ${doc.report.readerInvestigated ?? 0} checked by you · ${doc.report.notYetVerified ?? 0} not checked yet.` : ''}</p>
            {doc.report && <div className="ev"><h3>What we found so far</h3><p className="small">We found {doc.report.totalClaims} claims in this file. We checked {doc.report.investigated}. Of those, {doc.report.resolved ?? doc.report.investigated} got a clear answer. Verdicts so far: {Object.entries(doc.report.distribution).map(([k, v]) => `${k}: ${v}`).join(' · ') || 'none yet'}.</p>
            {doc.report.highImpactDisputed.length > 0 && <><p><strong>Claims to look at again</strong></p><p className="small">These look wrong or only partly right. They matter if people act on them.</p>{doc.report.highImpactDisputed.map((h) => { const c = doc.claims.find((x) => x.id === h.id); return <button className="claim" key={h.id} onClick={() => c && setSelected(c)}><span>{h.text}</span><span className={cls(h.verdict)}>{h.verdict}</span></button>; })}</>}
            {doc.report.internalContradictions.length > 0 && <p className="small">This file disagrees with itself on pages {doc.report.internalContradictions.map((c) => c.page).join(', ')}.</p>}</div>}
            {doc.kind === 'website' && scrutiny && (
              <WebsiteScrutiny
                doc={doc}
                telemetry={scrutiny}
                claims={visibleClaims}
                counts={{ shown: visibleClaims.length, total: doc.claims.length }}
                activeFilter={claimVerdictFilter}
                onFilter={setClaimVerdictFilter}
                selectedId={selected?.id}
                onInspect={(c) => setSelected(c)}
                onChallenge={(c) => { seedChatFromClaim(`${doc.id}:${c.id}`); setTab('claims'); }}
                onExport={(c) => exportClaim(doc.id, c.id)}
                onRecrawl={recheckDoc}
                onDebate={() => { if (selected?.id) seedChatFromClaim(`${doc.id}:${selected.id}`); setTab('claims'); }}
                busy={busy}
              />
            )}
            {doc.kind !== 'website' && doc.claims.length > 5 && (
              <div className="claim-filter" data-claim-filter>
                <span className="hist-search"><Icon name="search" /><input type="text" placeholder="Search claims in this file" value={claimQuery} onChange={(e) => setClaimQuery(e.target.value)} aria-label="Search claims in this file" /></span>
                <select value={claimVerdictFilter} onChange={(e) => setClaimVerdictFilter(e.target.value)} aria-label="Filter claims by verdict">
                  <option value="">Any verdict</option>
                  <option value="unchecked">Not checked yet</option>
                  {['Supported', 'Partially supported', 'Contradicted', 'Misleading', 'Outdated', 'Unverifiable', 'Not fact-checkable'].map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
                {(claimQuery || claimVerdictFilter) && <span className="small" role="status">{visibleClaims.length} of {doc.claims.length} claims shown. <button type="button" className="btn secondary" onClick={() => { setClaimQuery(''); setClaimVerdictFilter(''); }}>Show all</button></span>}
              </div>
            )}
            {doc.kind !== 'website' && doc.claims.length > 0 && visibleClaims.length === 0 && <p className="small">No claims match that search. Clear the search to see all {doc.claims.length} claims.</p>}
            {doc.kind !== 'website' && visibleClaims.map((c) => c.status === 'verified' || !c.status ? (
              <button className="claim" data-claim-row data-selected={selected?.id === c.id ? 'true' : 'false'} aria-current={selected?.id === c.id ? 'true' : undefined} key={c.id} onClick={() => setSelected(c)}>
                <span>{c.text}<br /><span className="small">{doc.kind === 'website' ? 'Web page' : doc.kind === 'image' ? 'Caption' : (doc.kind === 'video' || doc.kind === 'audio') ? `Segment ${c.page}` : pageLabel(c)} · {c.type} · Checked by {c.judgedBy}{c.source === 'reader-submitted' ? ' · Asked by you' : c.source === 'reader-pick' ? ' · Checked by you' : ''}{c.internalContradiction ? ' · This file disagrees with itself here' : ''}</span></span>
                <span className={cls(c.verdict)}>{c.verdict}</span>
              </button>
            ) : (
              <div className="claim" data-claim-row data-selected="false" key={c.id}>
                <span>{c.text}<br /><span className="small">{doc.kind === 'website' ? 'Web page' : doc.kind === 'image' ? 'Caption' : (doc.kind === 'video' || doc.kind === 'audio') ? `Segment ${c.page}` : pageLabel(c)} · {c.type}</span></span>
                <span><span className="stamp v-Unverifiable">{c.status === 'pending' ? 'Verifying…' : 'Not checked yet'}</span>{' '}<button className="btn secondary" onClick={() => verifyClaim(c)} disabled={busy === 'claim'}><Icon name="verify" />Verify this claim</button></span>
              </div>
            ))}
            <div className="doc-actions-panel" data-doc-actions>
              <div className="action-group">
                <h3 className="action-group-title"><Icon name="refresh" />Verification</h3>
                <div className="action-btns">
                  <button className="btn secondary" disabled={busy === 'recheck'} onClick={recheckDoc}><Icon name="refresh" />{busy === 'recheck' ? 'Checking again…' : 'Check again with new evidence'}</button>
                  {doc.autoPaused ? <button className="btn secondary" onClick={() => toggleAuto(false)}><Icon name="play" />Restart auto-check</button> : <button className="btn secondary" onClick={() => toggleAuto(true)}><Icon name="pause" />Pause auto-check</button>}
                </div>
                <p className="small">Check again uses evidence we load now. Pause stops auto-check. You can still check any claim by hand.</p>{docNote && <p className="small" role="status">{docNote}</p>}{busy === 'recheck' && <p className="small" role="status">Loading fresh evidence. This can take a while for a long file.</p>}
              </div>
              <div className="action-group">
                <h3 className="action-group-title"><Icon name="question" />Ask about this file</h3>
                <div data-ask-link>
                  <label className="small" htmlFor="doc-ask-input">{doc.kind === 'website' ? 'Ask this page a question' : 'Ask this book a question'} or test your idea about it. Your text will be in the box when the tool opens.</label>
                  <div className="input-with-mic">
                    <textarea id="doc-ask-input" value={theory} onChange={(e) => setTheory(e.target.value)} rows={3} placeholder="For example: Is the 10% claim in this book true?" aria-label="Ask this document a question" />
                    <MicButton variant="inline" onText={(text) => setTheory((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text))} />
                  </div>
                  <p><button type="button" className="btn" onClick={() => { setAssessDocId(doc.id); setTool('document'); setTab('check'); }}><Icon name="question" />Check this question</button>{' '}<span className="small">This opens the Ask tool with your text. To read or remove the file, use its card on the left.</span></p>
                </div>
              </div>
            </div>
          </section>
        )}
          </div>}
        {shown && (
          <section className="claim-page" data-claim-page>
            <div className="claim-page-head">
              <button className="btn secondary" onClick={() => { setSelected(null); setResult(null); }}><Icon name="back" />Back to claims</button>
              <span className="small">{doc?.title}{shownIdx > -1 ? ` · Checked claim ${shownIdx + 1} of ${verdictClaims.length}` : ''} · Alt + arrow keys move between claims</span>
              <span className="claim-nav">
                <button className="btn secondary" onClick={() => prevClaim && setSelected(prevClaim)} disabled={!prevClaim}><Icon name="back" />Previous claim</button>{' '}
                <button className="btn secondary" onClick={() => nextClaim && setSelected(nextClaim)} disabled={!nextClaim}>Next claim</button>
              </span>
            </div>
            <VerdictView r={shown} docId={doc?.id} />
            {doc && shown.id && (
              <div className="ev" data-challenge-record>
                <h3><Icon name="history" />Follow-up checks</h3>
                {shown.followups?.length > 0
                  ? <p className="small">{shown.followups.length} follow-up check{shown.followups.length === 1 ? '' : 's'} for this claim. See Challenges above, or the report. The first answer stays.</p>
                  : <p className="small">No follow-up checks yet. This page keeps the verdict, its evidence, and any follow-up checks.</p>}
                <p><button type="button" className="btn secondary" onClick={() => { seedChatFromClaim(`${doc.id}:${shown.id}`); setTab('claims'); }}><Icon name="question" />Debate this claim in chat</button>{' '}<span className="small">Talk there. This page stays a clean record.</span></p>
              </div>
            )}
          </section>
        )}
        </div>
              </div>
            </div>
          </div>
        )}
        {tab === 'claims' && (
          <section data-claims-view data-debate-arena>
            <div className="arena-ribbon" aria-label="Dialectic inquest status">
              <span className="arena-live"><span className="arena-pulse" aria-hidden="true" />Dialectic inquest · {chatMessages.filter((m) => m.role === 'verdict' || m.role === 'followup').length} statements so far</span>
              <span className="arena-target">Target: {chatContext ? `${String(chatContext.docId).slice(0, 8)}…${String(chatContext.claimId || '').slice(0, 4)}` : 'no claim yet'}</span>
              {lastChatVerdict && <span className="arena-verdict-line">Verdict: <span className={cls(lastChatVerdict.verdict)}>{lastChatVerdict.verdict}</span></span>}
            </div>
            <div className="arena-head">
              <div className="arena-head-copy">
                <p className="arena-tags">
                  {lastChatVerdict ? <span className={cls(lastChatVerdict.verdict)}>{lastChatVerdict.verdict}</span> : <span className="stamp v-Unverifiable">Awaiting first check</span>}
                  {lastChatVerdict?.type && <span className="arena-tag">Type: {lastChatVerdict.type}</span>}
                  <span className="arena-tag">Checked by {lastChatVerdict?.judgedBy || 'no judge yet'}</span>
                </p>
                <h2 className="arena-title">{lastChatVerdict ? `“${lastChatVerdict.text}”` : 'Debate a claim'}</h2>
                <p className="small">{lastChatVerdict ? lastChatVerdict.explanation : 'Check any claim first. Then question the answer here. Pick one of the 5 buttons, or type your own question. Each new answer shows as a message.'}</p>
              </div>
              <div className="arena-actions">
                <button type="button" className="btn secondary" onClick={() => {
                  const rows = chatMessages.map((m) => {
                    if (m.role === 'user') return `You: ${m.text}`;
                    if (m.role === 'verdict') return `Verdict (${m.result.verdict}): ${m.result.text} — ${m.result.explanation}`;
                    if (m.role === 'followup') return `Follow-up (${m.followup.verdict}): ${m.followup.explanation}`;
                    return m.text;
                  });
                  const text = `# TruthLens debate transcript\n\n${lastChatVerdict ? `Claim: ${lastChatVerdict.text}\nVerdict: ${lastChatVerdict.verdict}\n\n` : ''}${rows.join('\n\n') || 'No statements yet.'}\n`;
                  const blob = new Blob([text], { type: 'text/markdown' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url; a.download = 'truthlens-debate.md';
                  document.body.appendChild(a); a.click(); a.remove();
                  URL.revokeObjectURL(url);
                }} disabled={chatMessages.length === 0}><Icon name="download" />Export transcript</button>
                <button type="button" className="btn secondary" onClick={() => document.getElementById('debate-composer-input')?.focus()}><Icon name="refresh" />Re-interrogate triad</button>
                <button type="button" className="btn secondary" onClick={() => void openChatRecord()} disabled={!chatContext}><Icon name="library" />Send to claim dossier</button>
              </div>
            </div>
            <div className="arena-matrix" data-deliberation-matrix>
              <div className="arena-matrix-head">
                <div>
                  <p className="arena-kicker">Consensus evolution track</p>
                  <h3>Deliberation matrix</h3>
                </div>
                <span className="arena-tag">{chatMessages.filter((m) => m.role === 'followup').length} follow-up checks</span>
              </div>
              <div className="arena-rounds">
                <article className="arena-round">
                  <p className="meta">Round 01 · Hypothesis ingestion</p>
                  {chatMessages.find((m) => m.role === 'verdict')
                    ? <p><span className={cls(chatMessages.find((m) => m.role === 'verdict').result.verdict)}>{chatMessages.find((m) => m.role === 'verdict').result.verdict}</span></p>
                    : <p className="small">No claim checked yet. Type any claim below to open the ingestion round.</p>}
                  {chatMessages.find((m) => m.role === 'verdict') && <p className="small">{chatMessages.find((m) => m.role === 'verdict').result.text}</p>}
                </article>
                <article className="arena-round">
                  <p className="meta">Round 02 · Adversarial rebuttal</p>
                  {chatMessages.find((m) => m.role === 'followup')
                    ? <p><span className={cls(chatMessages.find((m) => m.role === 'followup').followup.verdict)}>{chatMessages.find((m) => m.role === 'followup').followup.verdict}</span></p>
                    : <p className="small">{lastChatVerdict ? 'No rebuttal yet. Use the 5 buttons below to push back on the verdict.' : 'The Skeptic steps in after the first verdict.'}</p>}
                  {chatMessages.find((m) => m.role === 'followup') && <p className="small">{chatMessages.find((m) => m.role === 'followup').followup.explanation}</p>}
                </article>
                <article className="arena-round">
                  <p className="meta">Round 03 · Empirical adjudication</p>
                  {lastChatVerdict
                    ? <p><span className={cls(lastChatVerdict.verdict)}>{lastChatVerdict.verdict}</span></p>
                    : <p className="small">No adjudication yet. The latest verdict lands here.</p>}
                  {lastChatVerdict?.uncertainty
                    ? <p className="small">Citations with a clear side {lastChatVerdict.uncertainty.faithfulness.label} · Evidence strength {lastChatVerdict.uncertainty.evidenceStrength.label}</p>
                    : lastChatVerdict && <p className="small">No strength score was recorded for this check.</p>}
                </article>
                <aside className="arena-gauge">
                  <p className="meta">Dialectic meters</p>
                  {lastChatVerdict?.uncertainty ? (
                    <div className="gauge-row">
                      <GaugeRing value={lastChatVerdict.uncertainty.faithfulness.score} label="Citations with a clear side" />
                      <GaugeRing value={lastChatVerdict.uncertainty.evidenceStrength.score} label="Evidence strength" />
                    </div>
                  ) : <p className="small">Two separate meters, no single score. They fill in after the first check.</p>}
                  {lastChatVerdict && <StanceBar sup={lastChatVerdict.supporting?.length || 0} con={lastChatVerdict.contradicting?.length || 0} />}
                  {lastChatVerdict && <p className="small">{lastChatVerdict.supporting?.length || 0} quotes for · {lastChatVerdict.contradicting?.length || 0} quotes against</p>}
                </aside>
              </div>
            </div>
            <div className="arena-tri-head">
              <h3><Icon name="users" />The tri-agent dialectic arena</h3>
              <span className="small">Researcher, Fact-checker, and Skeptic read the same evidence.</span>
            </div>
            <div className="arena-tri">
              <article className="arena-agent" data-agent="Researcher">
                <p className="agent-role">Researcher</p>
                <p className="small">{lastChatVerdict?.research ? `${lastChatVerdict.research.fetched} sources loaded of ${lastChatVerdict.research.sourcesFound} found.` : 'No research run was recorded yet.'}</p>
                {lastChatVerdict?.research?.queries?.length > 0 && <p className="small">We searched for: {lastChatVerdict.research.queries.join(' · ')}</p>}
              </article>
              <article className="arena-agent" data-agent="Fact-checker">
                <p className="agent-role">Fact-checker</p>
                <p className="small">{lastChatVerdict ? (lastChatVerdict.judges ? `Muse Spark said ${lastChatVerdict.judges.spark}; Muse Wonder said ${lastChatVerdict.judges.wonder}.` : `Decided by ${lastChatVerdict.judgedBy}.`) : 'No verdict to defend yet.'}</p>
                {lastChatVerdict && <p className="small">{lastChatVerdict.supporting?.length || 0} quotes for · {lastChatVerdict.contradicting?.length || 0} quotes against</p>}
              </article>
              <article className="arena-agent" data-agent="Skeptic">
                <p className="agent-role">Skeptic</p>
                <p className="small">{lastChatVerdict?.challenge ? `Challenged first verdict ${lastChatVerdict.preChallengeVerdict}. Still not clear: ${lastChatVerdict.challenge.unresolved}` : lastChatVerdict ? 'No second check ran on this verdict. Ask what would prove it wrong below.' : 'No verdict to attack yet.'}</p>
                {lastChatVerdict?.limitations?.length > 0 && <p className="small">Limits: {lastChatVerdict.limitations.join(' ')}</p>}
              </article>
            </div>
            <div className="chat-picker">
              <label className="small">Start from an existing claim<br />
                <select value="" onChange={(e) => seedChatFromClaim(e.target.value)} aria-label="Start from an existing claim">
                  <option value="">Pick a checked claim from your documents…</option>
                  {realDocs.map((d) => (
                    <optgroup key={d.id} label={d.title}>
                      {d.claims.filter((c) => c.verdict).map((c) => <option key={c.id} value={`${d.id}:${c.id}`}>{c.text.length > 90 ? `${c.text.slice(0, 90)}…` : c.text} ({c.verdict})</option>)}
                    </optgroup>
                  ))}
                </select>
              </label>
              {chatMessages.length > 0 && <button type="button" className="btn secondary" onClick={() => { setChatMessages([]); setChatContext(null); }}>Clear chat</button>}
            </div>
            <div className="arena-thread" data-chat-thread data-transcript>
              {chatMessages.length === 0 && <p className="small">Nothing here yet. Type any claim below. For example: Coffee stunts your growth. Or pick a claim above.</p>}
              {chatMessages.map((m, i) => m.role === 'user' ? (
                <div className="arena-msg arena-user" key={i}>
                  <p className="arena-msg-head"><span className="arena-badge tone-cyan">Y</span><span className="arena-who">You</span><span className="arena-ord">Statement {String(i + 1).padStart(2, '0')}</span><span className="challenge-pill tone-cyan">Interrogation</span></p>
                  <p>{m.text}</p>
                </div>
              ) : m.role === 'verdict' ? (
                <div className="arena-msg arena-msg-verdict" key={i}>
                  <p className="arena-msg-head"><span className="arena-badge tone-green">V</span><span className="arena-who">Triad verdict</span><span className="arena-ord">Statement {String(i + 1).padStart(2, '0')}</span><span className="challenge-pill tone-cyan">{chatMessages.slice(0, i).some((x) => x.role === 'verdict') ? 'Re-adjudication' : 'Initial thesis'}</span></p>
                  <VerdictSummary r={m.result} onOpenRecord={() => void openChatRecord()} />
                </div>
              ) : m.role === 'followup' ? (
                <div className="arena-msg arena-msg-followup" key={i}>
                  <p className="arena-msg-head"><span className="arena-badge tone-rose">F</span><span className="arena-who">Follow-up check</span><span className="arena-ord">Statement {String(i + 1).padStart(2, '0')}</span><span className={`challenge-pill ${{ 'stronger-contrary': 'tone-rose', 'prove-wrong': 'tone-rose', custom: 'tone-rose', 'stronger-support': 'tone-green', 'prove-right': 'tone-green', 'compare-author': 'tone-cyan' }[m.followup.kind] || 'tone-slate'}`}>{{ 'stronger-contrary': 'Counter-evidence', 'stronger-support': 'Supporting evidence', 'prove-wrong': 'Falsification test', 'prove-right': 'Confirmation test', 'compare-author': 'Author record', custom: 'Custom challenge' }[m.followup.kind] || m.followup.kind}</span></p>
                  <FollowupCard f={m.followup} />
                </div>
              ) : (
                <div className="notice" key={i} role="status">{m.text}</div>
              ))}
              {busy === 'chat' && liveStages.length > 0 && <AgentTimeline stages={liveStages} />}
              {busy === 'chat' && <p className="small" role="status">Investigating. This can take 30 to 60 seconds. <button type="button" className="btn secondary danger-text" onClick={cancelCheck}><Icon name="stop" />Cancel check</button></p>}
              <div ref={chatEndRef} />
              {busy === 'challenge' && <p className="small" role="status">Running your follow-up check…</p>}
            </div>
            {lastChatVerdict && (
              <div className="arena-consensus">
                <p><span className={cls(lastChatVerdict.verdict)}>{lastChatVerdict.verdict}</span></p>
                <p>{lastChatVerdict.explanation}</p>
                <p className="small">Checked by {lastChatVerdict.judgedBy}{lastChatVerdict.judges ? ` · Muse Spark ${lastChatVerdict.judges.spark} · Muse Wonder ${lastChatVerdict.judges.wonder}` : ''} · {(lastChatVerdict.supporting?.length || 0) + (lastChatVerdict.contradicting?.length || 0)} cited quotes · {chatMessages.filter((m) => m.role === 'followup').length} follow-ups</p>
              </div>
            )}
            {chatContext && lastChatVerdict && <SuggestedNext r={lastChatVerdict} onPick={(s) => void askSuggestion(s)} busy={busy} />}
            <div className="arena-console-options" data-debate>
              <ChallengeDirections onChallenge={(kind) => runChatChallenge(kind)} busy={busy} ready={!!chatContext} />
            </div>
            <div className="arena-console" data-chat-composer data-interrogation>
              <h3><Icon name="question" />Question the dialectic triad</h3>
              <p className="small">{chatContext ? 'Challenge the verdict above, or inject your own counter-evidence. We remove hidden instructions to an AI before we decide.' : 'Type any claim to open the inquest. For example: Humans only use 10% of their brains.'}</p>
              <div className="input-with-mic">
                <textarea id="debate-composer-input" value={chatText} onChange={(e) => setChatText(e.target.value)} aria-label={chatContext ? 'Your question' : 'A claim to check'} rows={3} placeholder={chatContext ? 'Or describe your own challenge…' : 'Type any claim. For example: Humans only use 10% of their brains.'} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void sendChat(); } }} />
                <MicButton variant="inline" label="Dictate a claim or follow-up" onText={(tx) => setChatText((prev) => (prev.trim() ? `${prev.trim()} ${tx}` : tx))} />
              </div>
              <p><button className="btn" onClick={() => void sendChat()} disabled={!chatText.trim() || busy === 'chat' || busy === 'challenge'}><Icon name="verify" />{busy === 'chat' || busy === 'challenge' ? 'Checking…' : 'Inject counter-evidence'}</button>{' '}<span className="small">{chatContext ? 'We will run this as a follow-up check on the claim above.' : 'We will check this as a new claim. Press Enter to send.'}</span></p>
            </div>
          </section>
        )}
        {tab === 'history' && (
          <section data-history>
            <h2><Icon name="history" />Past checks</h2>
            <p className="small">All your past checks are here. Click one to see its verdict and evidence again. New checks show here on their own.</p>
            {history.length === 0 && vaultSearched.length === 0 && <p className="small">Nothing saved yet. Run a check and it will show here.</p>}
            <div className="vault-table" data-vault-table data-history-table>
              <div className="vault-table-bar">
                <div className="vault-tabs" role="group" aria-label="Filter claims by source type">
                  {[['all', 'All Files'], ['book', 'Books & Manuscripts'], ['paper', 'Research Papers'], ['scan', 'Media & Scans']].map(([v, label]) => (
                    <button key={v} type="button" className={vaultCat === v ? 'tab on' : 'tab'} aria-pressed={vaultCat === v} onClick={() => { setVaultCat(v); setVaultPage(1); }}>{label} ({v === 'all' ? vaultDocCounts.all : vaultDocCounts[v]})</button>
                  ))}
                </div>
                <div className="vault-filters">
                  <span className="hist-search vault-search"><Icon name="search" /><input type="text" placeholder="Search extracted claims or sources..." value={vaultQuery} onChange={(e) => { setVaultQuery(e.target.value); setVaultPage(1); historySearchRef.current(e.target.value, histVerdict, histWorkflow); }} aria-label="Search extracted claims or sources" /></span>
                  <select value={histVerdict} onChange={(e) => { setHistVerdict(e.target.value); setVaultPage(1); void loadHistory(vaultQuery, e.target.value, histWorkflow); }} aria-label="Filter by verdict">
                    <option value="">Any verdict</option>
                    {['Supported', 'Partially supported', 'Contradicted', 'Misleading', 'Outdated', 'Unverifiable', 'Not fact-checkable'].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                  <select value={histWorkflow} onChange={(e) => { setHistWorkflow(e.target.value); setVaultPage(1); void loadHistory(vaultQuery, histVerdict, e.target.value); }} aria-label="Filter by tool">
                    <option value="">Any tool</option>
                    <option value="claim">Check a claim</option>
                    <option value="book">Book</option>
                    <option value="website">Website</option>
                  </select>
                  <button className="btn secondary" onClick={() => void loadHistory(vaultQuery, histVerdict, histWorkflow)}>Reload</button>
                </div>
              </div>
              <div className="table-scroll">
              <table className="claim-table">
                <thead><tr><th>Extracted Claim Statement</th><th>Source File</th><th>Adjudication Verdict</th><th>Citation Alignment</th><th>Evidence Strength</th><th>Date Checked</th><th>Actions</th></tr></thead>
                <tbody>
                  {vaultPageRows.map(({ doc: d, claim: c, single }) => {
                    const align = c.uncertainty?.faithfulness?.score;
                    const strength = c.uncertainty?.evidenceStrength?.score;
                    const at = single ? c._entry?.at : (c.history?.length ? c.history[c.history.length - 1].at : null);
                    const loc = single ? 'Single check' : d.kind === 'website' ? 'Web page' : d.kind === 'image' ? 'Caption' : (d.kind === 'video' || d.kind === 'audio') ? `Segment ${c.page ?? '?'}` : `Page${c.pages?.length > 1 ? `s ${c.pages.join(', ')}` : ` ${c.page ?? '?'}`}`;
                    const docIcon = d.kind === 'website' ? 'website' : d.kind === 'image' ? 'image' : d.kind === 'video' ? 'video' : d.kind === 'audio' ? 'audio' : 'book';
                    const openRow = single ? () => reopenHistory(c._entry) : () => { setDoc(d); setSelected(c); setTab('library'); };
                    return (
                      <tr key={single ? `single:${c.id}` : `${d.id}:${c.id}`} className="claim-row">
                        <td><button type="button" className="linklike claim-cell-text" onClick={openRow} aria-label={`Open verdict for: ${c.text}`}>“{c.text}”</button><div className="small">{loc}{c.type ? ` · ${c.type}` : ''}{single && c._duplicates > 1 ? ` · ${c._duplicates} similar checks. We show the newest.` : ''}</div></td>
                        <td><span className="claim-cell-doc"><Icon name={docIcon} />{d.title}</span></td>
                        <td>{c.verdict ? <span className={cls(c.verdict)}>{c.verdict}</span> : <span className="row-pending"><span className="stamp v-Unverifiable">Not checked yet</span> {!single && <button type="button" className="btn secondary" onClick={() => verifyClaim(c, d)} disabled={busy === 'claim'}>Verify</button>}</span>}</td>
                        <td>{Number.isFinite(align) ? <span className="align-cell"><span className="align-bar" aria-hidden="true"><span style={{ width: `${Math.round(align * 100)}%` }} /></span>{Math.round(align * 100)}% Polar</span> : <span className="small">—</span>}</td>
                        <td>{Number.isFinite(strength) ? <span className="strength-cell">{Math.round(strength * 100)}/100</span> : <span className="small">—</span>}</td>
                        <td><span className="small">{at ? timeAgo(at) : '—'}</span></td>
                        <td><span className="row-actions">
                          <button type="button" className="icon-btn" title="Telemetry & agent debate" aria-label={`Open claim: ${c.text}`} onClick={openRow}><Icon name="view" /></button>
                          {c.verdict ? <button type="button" className="icon-btn" title="Export dossier" aria-label={`Export dossier for: ${c.text}`} onClick={() => exportClaim(d.id, c.id)}><Icon name="download" /></button> : null}
                        </span></td>
                      </tr>
                    );
                  })}
                  {vaultPageRows.length === 0 && <tr><td colSpan={7}><p className="small">No claims match. Try another tab or clear the search.</p></td></tr>}
                </tbody>
              </table>
              </div>
              <div className="vault-pages">
                <span className="small">Showing {vaultPageRows.length} of {vaultSearched.length} Adjudicated Statement{vaultSearched.length === 1 ? '' : 's'} • All forensic signatures valid</span>
                <span className="vault-page-btns">
                  <button type="button" className="btn secondary" disabled={vaultPageSafe <= 1} onClick={() => setVaultPage(vaultPageSafe - 1)}>Previous</button>
                  {Array.from({ length: vaultPageCount }, (_, i) => i + 1).map((n) => (
                    <button key={n} type="button" className={n === vaultPageSafe ? 'btn' : 'btn secondary'} aria-current={n === vaultPageSafe ? 'page' : undefined} onClick={() => setVaultPage(n)}>{n}</button>
                  ))}
                  <button type="button" className="btn secondary" disabled={vaultPageSafe >= vaultPageCount} onClick={() => setVaultPage(vaultPageSafe + 1)}>Next</button>
                </span>
              </div>
            </div>
          </section>
        )}
          </div>
      </div>
      {resultPopup && (
        <Modal label="Check result" marker="data-result-popup" onClose={closeResultPopup}>
            <div className="modal-head dossier-head">
              <h2>Verification Dossier</h2>
              <button type="button" className="btn secondary" onClick={closeResultPopup} aria-label="Close result popup"><Icon name="close" />Close</button>
            </div>
            {resultPopup.result && <VerdictView r={resultPopup.result} docId={resultPopup.docId} onRerun={rerunPopupText(resultPopup.result.text)} onExport={popupExportFor(resultPopup.result, resultPopup.docId)} onDebate={() => debatePopupItem(resultPopup.result)} onAsk={() => askPopupItem(resultPopup.result)} />}
            {resultPopup.results?.map((r, i) => <div key={i}>{i > 0 && <div className="rule" />}<VerdictView r={r} onRerun={rerunPopupText(r.text)} onExport={popupExportFor(r, resultPopup.docId)} onDebate={() => debatePopupItem(r)} onAsk={() => askPopupItem(r)} /></div>)}
            <div className="rule" />
            <p className="small">This is the full answer. Closing leaves a compressed summary here, so you can type the next claim without the screen filling up.</p>
            <p>
              <button type="button" className="btn" onClick={openLibraryExtras}><Icon name="library" />More options in the Library</button>{' '}
              <button type="button" className="btn secondary" onClick={closeResultPopup}>Stay here</button>
            </p>
        </Modal>
      )}
      {viewerDoc && (
        <Modal label={`View file: ${viewerDoc.title}`} marker="data-document-viewer" onClose={() => setViewerDoc(null)}>
            <div className="modal-head">
              <h2>{viewerDoc.title}</h2>
              <button type="button" className="btn secondary" onClick={() => setViewerDoc(null)} aria-label="Close document viewer"><Icon name="close" />Close</button>
            </div>
            <p className="small">{viewerDoc.kind === 'website' ? (safeHttpUrl(viewerDoc.sourceUrl) ? <>Website · <a href={safeHttpUrl(viewerDoc.sourceUrl)} target="_blank" rel="noreferrer">Open the first page</a></> : 'Website') : viewerDoc.kind === 'image' ? 'Image · text by Muse Spark' : viewerDoc.kind === 'video' ? 'Video · text by Muse Voice Transcribe and Muse Spark' : viewerDoc.kind === 'audio' ? 'Audio · text by Muse Voice Transcribe' : viewerDoc.media?.file?.mime === 'application/pdf' ? 'PDF document' : viewerDoc.media?.file?.ext === 'docx' ? 'Word document (DOCX)' : 'Book or pasted text'} This is the file as you added it. Claims and answers are in the Library.</p>
            {viewerDoc.kind === 'image' && viewerDoc.media?.file && <img className="viewer-media" src={`/api/documents/${viewerDoc.id}/media`} alt={viewerDoc.title} loading="lazy" decoding="async" />}
            {viewerDoc.kind === 'image' && !viewerDoc.media?.file && <p className="small">We did not keep this image file. Below is the text Muse Spark wrote about it. Add the image again to see it here.</p>}
            {viewerDoc.kind === 'video' && viewerDoc.media?.file && <video className="viewer-media" src={`/api/documents/${viewerDoc.id}/media`} controls preload="metadata" aria-label={`Video: ${viewerDoc.title}`} />}
            {viewerDoc.kind === 'video' && !viewerDoc.media?.file && <p className="small">We did not keep this video file. Below is its speech and frame text. Add the video again to watch it here.</p>}
            {viewerDoc.kind === 'audio' && viewerDoc.media?.file && <audio className="viewer-media" src={`/api/documents/${viewerDoc.id}/media`} controls preload="metadata" aria-label={`Audio: ${viewerDoc.title}`} />}
            {viewerDoc.kind === 'audio' && !viewerDoc.media?.file && <p className="small">We did not keep this audio file. Below is its transcript. Add the audio again to listen here.</p>}
            {viewerDoc.media?.file?.mime === 'application/pdf' && <iframe className="viewer-frame" src={`/api/documents/${viewerDoc.id}/media`} title={`PDF: ${viewerDoc.title}`} sandbox="allow-same-origin" loading="lazy" referrerPolicy="no-referrer" />}
            {viewerDoc.media?.file && viewerDoc.media.file.ext === 'docx' && <p><a className="btn secondary" href={`/api/documents/${viewerDoc.id}/media`} download={viewerDoc.media.file.originalName || 'document.docx'}><Icon name="download" />Download the DOCX file</a>{' '}<span className="small">Your browser cannot show a DOCX file here. Its text is below.</span></p>}
            {viewerDoc.kind === 'website' && safeHttpUrl(viewerDoc.sourceUrl) && <><iframe className="viewer-frame" src={viewerDoc.sourceUrl} title={`Website: ${viewerDoc.title}`} sandbox="allow-same-origin allow-popups" loading="lazy" referrerPolicy="no-referrer" /><p className="small">If this stays blank, the site blocks it. Use "Open the first page" above. The text we loaded is below.</p></>}
            {!viewerBusy && viewerDoc.contentPages?.length > 0 && <h3>Text we read from it</h3>}
            {viewerBusy && <p className="small" role="status">Loading the file…</p>}
            {viewerDoc.viewerError && <p className="error" role="alert">{viewerDoc.viewerError}</p>}
            {!viewerBusy && viewerDoc.contentPages?.length > 0 && (
              <div className="doc-pages">
                {viewerDoc.contentPages.map((p) => (
                  <article className="doc-page" key={p.page}>
                    <div className="meta">Page {p.page}</div>
                    <p>{p.text}</p>
                  </article>
                ))}
              </div>
            )}
            {!viewerBusy && !viewerDoc.viewerError && viewerDoc.contentPages?.length === 0 && <p className="small">We have no text for this file.</p>}
            <p>
              <button type="button" className="btn secondary danger-text" onClick={() => askDelete(viewerDoc)}><Icon name="trash" />Remove file</button>
            </p>
        </Modal>
      )}
      {pendingDelete && (
        <Modal small label={`Remove file: ${pendingDelete.title}`} marker="data-delete-confirm" onClose={() => { setPendingDelete(null); setConfirmTitle(''); }}>
            <div className="modal-head">
              <h2>Remove file</h2>
              <button type="button" className="btn secondary" onClick={() => { setPendingDelete(null); setConfirmTitle(''); }} aria-label="Cancel removal"><Icon name="close" />Cancel</button>
            </div>
            <p><strong>{pendingDelete.title}</strong> and all its claims and answers will be permanently removed. You cannot undo this.</p>
            <p className="small">Type the file title to confirm: <strong>{pendingDelete.title}</strong></p>
            <p><input type="text" value={confirmTitle} onChange={(e) => setConfirmTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void removeDocument(); }} aria-label="Type the file title to confirm removal" placeholder="Type the file title" /></p>
            {deleteErr && <p className="error" role="alert">{deleteErr}</p>}
            <p>
              <button type="button" className="btn secondary" onClick={() => { setPendingDelete(null); setConfirmTitle(''); }}>Keep this file</button>{' '}
              <button type="button" className="btn danger" disabled={confirmTitle.trim() !== pendingDelete.title.trim() || busy === 'delete'} onClick={removeDocument}><Icon name="trash" />{busy === 'delete' ? 'Removing…' : 'Remove permanently'}</button>
            </p>
            {confirmTitle.trim() !== pendingDelete.title.trim() && <p className="small">Type the title exactly to turn on the Remove button.</p>}
        </Modal>
      )}
    </main>
  );
}
