import { useEffect, useRef, useState } from 'react';

export function encodeWav(samples, sampleRate) {
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
export function resampleTo(samples, fromRate, toRate) {
  if (fromRate === toRate) return samples;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(Math.max(start + 1, Math.floor((i + 1) * ratio)), samples.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}
export function micConstraintsFor(devices) {
  const found = Array.isArray(devices) ? devices.find((d) => d && d.kind === 'audioinput' && d.deviceId) : null;
  if (found) return { audio: { deviceId: { exact: found.deviceId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true } };
  return { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } };
}
export function micErrorMessage(err) {
  if (typeof window !== 'undefined' && window.isSecureContext === false) return 'Mic needs a secure connection (HTTPS or localhost). Type instead, or reopen this page over HTTPS.';
  const name = err?.name || '';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone found. Plug one in, or type.';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'The mic is blocked. Click the site icon in the address bar, allow the mic, then try again. Or type.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'The mic is busy. Close the other app using it, or type.';
  return 'The mic is blocked. Allow it in your browser, or type.';
}
export function MicButton({ onText, label = 'Dictate', variant = 'button' }) {
  const [state, setState] = useState('idle');
  const [note, setNote] = useState('');
  const rec = useRef(null);
  const starting = useRef(false);
  const stopRequested = useRef(false);
  const stopTimer = useRef(null);
  const transcribeAbort = useRef(null);
  useEffect(() => () => {
    stopRequested.current = true;
    if (stopTimer.current) { clearTimeout(stopTimer.current); stopTimer.current = null; }
    if (transcribeAbort.current) { try { transcribeAbort.current.abort(); } catch { /* already done */ } transcribeAbort.current = null; }
    const r = rec.current;
    if (!r) return;
    rec.current = null;
    try { r.processor.disconnect(); r.source.disconnect(); r.silent?.disconnect(); } catch { /* already closed */ }
    r.stream.getTracks().forEach((t) => t.stop());
    r.ctx.close().catch(() => {});
  }, []);
  async function start() {
    if (rec.current || starting.current) return;
    setNote('');
    const AudioCtor = typeof window !== 'undefined' ? (window.AudioContext || window.webkitAudioContext) : undefined;
    if (!navigator?.mediaDevices?.getUserMedia || typeof AudioCtor === 'undefined') return setNote('This browser cannot record your voice. Please type.');
    starting.current = true;
    stopRequested.current = false;
    let stream = null;
    try {
      try {
        stream = await navigator.mediaDevices.getUserMedia(micConstraintsFor());
      } catch (e) {
        const name = e?.name || '';
        if (name !== 'NotFoundError' && name !== 'OverconstrainedError') throw e;
        let devices = [];
        try {
          if (typeof navigator.mediaDevices.enumerateDevices === 'function') devices = await navigator.mediaDevices.enumerateDevices();
        } catch { devices = []; }
        const retry = micConstraintsFor(devices);
        if (!retry?.audio?.deviceId) throw e;
        stream = await navigator.mediaDevices.getUserMedia(retry);
      }
      const ctx = new AudioCtor();
      try {
        if (typeof ctx.resume === 'function' && ctx.state === 'suspended') await ctx.resume();
        const source = ctx.createMediaStreamSource(stream);
        const processor = ctx.createScriptProcessor(4096, 1, 1);
        const frames = [];
        processor.onaudioprocess = (e) => frames.push(new Float32Array(e.inputBuffer.getChannelData(0)));
        // ScriptProcessorNodes only fire when connected downstream, but routing
        // the live mic to the speakers feeds back. A zero-gain node keeps the
        // callback alive while staying silent.
        const silent = ctx.createGain();
        silent.gain.value = 0;
        source.connect(processor); processor.connect(silent); silent.connect(ctx.destination);
        // The permission prompt can outlast a tap: pointerup fires stop()
        // while getUserMedia is still pending, so stop() no-ops on the empty
        // ref and start() would otherwise leave the mic stuck open.
        if (stopRequested.current) {
          try { processor.disconnect(); source.disconnect(); silent?.disconnect(); } catch { /* already closed */ }
          stream.getTracks().forEach((t) => t.stop());
          ctx.close().catch(() => {});
          stream = null;
          return;
        }
        rec.current = { stream, ctx, processor, source, silent, frames, rate: ctx.sampleRate };
        stream = null;
        setState('listening');
        if (stopTimer.current) clearTimeout(stopTimer.current);
        stopTimer.current = setTimeout(() => { stopTimer.current = null; void stop(); }, 60000);
      } catch (setupErr) {
        try { await ctx.close(); } catch { /* already closed */ }
        throw setupErr;
      }
    } catch (e) { setNote(micErrorMessage(e)); }
    finally {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      starting.current = false;
    }
  }
  async function stop() {
    // Guard on the ref, not render-time state: the 60s auto-stop timer
    // captures this closure before setState('listening') re-renders,
    // so a state check here would no-op the timer every time.
    stopRequested.current = true;
    if (!rec.current) return;
    if (stopTimer.current) { clearTimeout(stopTimer.current); stopTimer.current = null; }
    const { stream, ctx, processor, source, silent, frames, rate } = rec.current;
    rec.current = null;
    try { processor.disconnect(); source.disconnect(); silent?.disconnect(); } catch { /* already closed */ }
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
    onPointerDown: (e) => { e.preventDefault(); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* no capture */ } start(); },
    onPointerUp: stop,
    onPointerCancel: stop,
    onPointerLeave: () => { if (state === 'listening') stop(); },
    onKeyDown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); start(); } },
    onKeyUp: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); stop(); } },
  };
  const aria = `${label} with Muse Voice Transcribe. Hold to speak, release to fill the box.`;
  if (variant === 'inline') {
    return (
      <span data-mic data-mic-inline className="mic-inline">
        <button type="button" className="mic-icon" data-state={state} title={aria} aria-label={aria} aria-pressed={state === 'listening'} {...hold} disabled={state === 'working'}>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 14.5a3.25 3.25 0 0 0 3.25-3.25v-5A3.25 3.25 0 1 0 8.75 6.25v5A3.25 3.25 0 0 0 12 14.5Z" /><path fill="currentColor" d="M17.1 11.25a5.1 5.1 0 0 1-10.2 0H5.4a6.6 6.6 0 0 0 5.85 6.54v3.46H9.5a.75.75 0 0 0 0 1.5h5a.75.75 0 0 0 0-1.5h-1.75v-3.46A6.6 6.6 0 0 0 18.6 11.25h-1.5Z" /></svg>
          <span className="mic-sr">{state === 'listening' ? 'Listening. Release to fill the box.' : state === 'working' ? 'Transcribing.' : label}</span>
        </button>
        {state !== 'idle' && <span className="mic-live" role="status">{state === 'listening' ? 'Listening… release to fill the box' : 'Transcribing…'}</span>}
        {note && <span className="mic-note" role="status">{note}<button type="button" className="mic-note-close" aria-label="Dismiss microphone message" onClick={() => setNote('')}>Dismiss</button></span>}
      </span>
    );
  }
  return (
    <span data-mic>
      <button type="button" className="btn secondary" aria-label={aria} aria-pressed={state === 'listening'} {...hold} disabled={state === 'working'}>
        {state === 'listening' ? 'Listening… release to fill the box' : state === 'working' ? 'Transcribing…' : label}
      </button>
      <span className="small"> Hold the button and speak. Your words go in the box. You can edit them. </span>
      {note && <span className="small" role="status">{note} <button type="button" className="mic-note-close" aria-label="Dismiss microphone message" onClick={() => setNote('')}>Dismiss</button></span>}
    </span>
  );
}
