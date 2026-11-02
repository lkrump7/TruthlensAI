import { useEffect, useRef, useState } from 'react';

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
export function MicButton({ onText, label = 'Dictate', variant = 'button' }) {
  const [state, setState] = useState('idle');
  const [note, setNote] = useState('');
  const rec = useRef(null);
  const stopTimer = useRef(null);
  const transcribeAbort = useRef(null);
  useEffect(() => () => {
    if (stopTimer.current) { clearTimeout(stopTimer.current); stopTimer.current = null; }
    if (transcribeAbort.current) { try { transcribeAbort.current.abort(); } catch { /* already done */ } transcribeAbort.current = null; }
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    try { r.processor.disconnect(); r.source.disconnect(); } catch { /* already closed */ }
    r.stream.getTracks().forEach((t) => t.stop());
    r.ctx.close().catch(() => {});
  }, []);
  async function start() {
    if (state === 'listening' || state === 'working') return;
    setNote('');
    if (!navigator?.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') return setNote('This browser cannot record your voice. Please type.');
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
      if (stopTimer.current) clearTimeout(stopTimer.current);
      stopTimer.current = setTimeout(() => { stopTimer.current = null; void stop(); }, 60000);
    } catch { setNote('The mic is blocked. Allow it in your browser, or type.'); }
  }
  async function stop() {
    if (state !== 'listening' || !rec.current) return;
    if (stopTimer.current) { clearTimeout(stopTimer.current); stopTimer.current = null; }
    const { stream, ctx, processor, source, frames, rate } = rec.current;
    rec.current = null;
    try { processor.disconnect(); source.disconnect(); } catch { /* already closed */ }
    stream.getTracks().forEach((t) => t.stop());
    const total = frames.reduce((n, c) => n + c.length, 0);
    const merged = new Float32Array(total);
    let at = 0; for (const c of frames) { merged.set(c, at); at += c.length; }
    ctx.close().catch(() => {});
    if (!total) { setState('idle'); return setNote('We did not hear you. Hold the button, speak, then let go.'); }
    setState('working');
    if (transcribeAbort.current) { try { transcribeAbort.current.abort(); } catch { /* replaced */ } }
    transcribeAbort.current = new AbortController();
    try {
      const wav = encodeWav(resampleTo(merged, rate, 24000), 24000);
      const fd = new FormData(); fd.append('audio', wav, 'dictation.wav');
      const r = await fetch('/api/transcribe', { method: 'POST', body: fd, signal: transcribeAbort.current.signal });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) setNote(d.error || 'We could not turn your voice into text. Please type.');
      else if (d.transcript) onText(d.transcript);
    } catch (e) {
      if (e?.name === 'AbortError') return;
      setNote('We could not turn your voice into text. Please type.');
    } finally { transcribeAbort.current = null; setState('idle'); }
  }
  const hold = {
    onPointerDown: (e) => { e.preventDefault(); start(); },
    onPointerUp: stop,
    onPointerLeave: () => { if (state === 'listening') stop(); },
    onKeyDown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); start(); } },
    onKeyUp: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); stop(); } },
  };
  const aria = `${label} with Muse Voice Transcribe. Hold to speak, release to fill the box.`;
  if (variant === 'inline') {
    return (
      <span data-mic data-mic-inline className="mic-inline">
        <button type="button" className="mic-icon" data-state={state} title={aria} aria-label={aria} {...hold} disabled={state === 'working'}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 14.5a3.25 3.25 0 0 0 3.25-3.25v-5A3.25 3.25 0 1 0 8.75 6.25v5A3.25 3.25 0 0 0 12 14.5Z" /><path fill="currentColor" d="M17.1 11.25a5.1 5.1 0 0 1-10.2 0H5.4a6.6 6.6 0 0 0 5.85 6.54v3.46H9.5a.75.75 0 0 0 0 1.5h5a.75.75 0 0 0 0-1.5h-1.75v-3.46A6.6 6.6 0 0 0 18.6 11.25h-1.5Z" /></svg>
          <span className="mic-sr">{state === 'listening' ? 'Listening. Release to fill the box.' : state === 'working' ? 'Transcribing.' : label}</span>
        </button>
        {state !== 'idle' && <span className="mic-live" role="status">{state === 'listening' ? 'Listening… release to fill the box' : 'Transcribing…'}</span>}
        {note && <span className="mic-note" role="status">{note}</span>}
      </span>
    );
  }
  return (
    <span data-mic>
      <button type="button" className="btn secondary" aria-label={aria} {...hold} disabled={state === 'working'}>
        {state === 'listening' ? 'Listening… release to fill the box' : state === 'working' ? 'Transcribing…' : label}
      </button>
      <span className="small"> Hold the button and speak. Your words go in the box. You can edit them. </span>
      {note && <span className="small" role="status">{note}</span>}
    </span>
  );
}
