import { useEffect, useState } from 'react';
import { Icon } from './icons.js';

const CHALLENGE_DIRECTIONS = [
  { kind: 'stronger-contrary', icon: 'search', title: 'Find stronger evidence against it', dir: 'Looks for the best evidence against this claim, in new sources.', tag: 'Counter-evidence', tone: 'tone-rose' },
  { kind: 'stronger-support', icon: 'verify', title: 'Find stronger evidence for it', dir: 'Looks for the best evidence for this claim, in new sources.', tag: 'Supporting evidence', tone: 'tone-green' },
  { kind: 'prove-wrong', icon: 'question', title: 'What would prove this wrong?', dir: 'Says what evidence would show the claim is wrong. Then looks for that evidence.', tag: 'Falsification test', tone: 'tone-rose' },
  { kind: 'prove-right', icon: 'verify', title: 'What would confirm this?', dir: 'Says what evidence would show the claim is right. Then looks for that evidence.', tag: 'Confirmation test', tone: 'tone-green' },
  { kind: 'compare-author', icon: 'excerpt', title: 'What does the author say?', dir: 'For excerpts and websites. Puts our answer next to what the author wrote. No new check.', tag: 'Author record', tone: 'tone-cyan' },
];
export function ChallengeDirections({ onChallenge, busy, ready }) {
  return (
    <div data-challenge-options>
      <h3><Icon name="search" />Question this answer in 5 ways</h3>
      <p className="small">{ready ? 'Pick one. The answer will show in this chat. The first answer stays saved.' : 'Check a claim first. When you have an answer, these 5 buttons will work.'}</p>
      {busy === 'challenge' && <p className="small" role="status">Running your follow-up check… This re-checks the claim against fresh sources and can take a minute.</p>}
      {!!busy && busy !== 'challenge' && <p className="small" role="status">A check is running. These wait until it finishes.</p>}
      <div className="challenge-options">
        {CHALLENGE_DIRECTIONS.map((o, n) => (
          <button type="button" className="challenge-option" key={o.kind} onClick={() => onChallenge(o.kind)} disabled={!ready || !!busy} aria-busy={busy === 'challenge' ? 'true' : undefined}>
            <span className="challenge-top"><span className="challenge-num">{String(n + 1).padStart(2, '0')}</span><span className={`challenge-pill ${o.tone}`}>{o.tag}</span></span>
            <span className={`format-icon ${o.tone}`}><Icon name={o.icon} /></span>
            <strong>{o.title}</strong>
            <span>{o.dir}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
export function suggestKey(r) {
  if (!r) return '';
  return [
    r.text, r.verdict, r.followups?.length || 0,
    r.supporting?.length || 0, r.contradicting?.length || 0, r.unclassified?.length || 0,
    r.research?.fetched || 0, r.research?.sourcesFound || 0,
  ].join('::');
}
export function suggestStateFromResponse(ok, status, data) {
  const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
  const source = typeof data?.source === 'string' ? data.source : '';
  const reason = typeof data?.reason === 'string' ? data.reason : '';
  if (!ok) {
    const message = typeof data?.error === 'string' && data.error.trim()
      ? data.error.trim()
      : `Ideas did not load (HTTP ${status}). Retry by picking a button below.`;
    return { loading: false, suggestions: [], source: '', reason: '', error: message };
  }
  if (typeof data?.error === 'string' && data.error.trim() && suggestions.length === 0) {
    return { loading: false, suggestions: [], source: '', reason: '', error: data.error.trim() };
  }
  if (suggestions.length === 0) {
    return { loading: false, suggestions: [], source: '', reason: '', error: 'Ideas did not load. Retry by picking a button below.' };
  }
  return { loading: false, suggestions, source, reason, error: '' };
}
export function SuggestedNext({ r, onPick, busy }) {
  const [state, setState] = useState({ loading: true, suggestions: [], source: '', reason: '', error: '' });
  const [retry, setRetry] = useState(0);
  const verdictKey = suggestKey(r);
  useEffect(() => {
    if (!r) return undefined;
    let alive = true;
    setState({ loading: true, suggestions: [], source: '', reason: '', error: '' });
    fetch('/api/claims/suggest', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ result: r }) })
      .then(async (res) => {
        const d = await res.json().catch(() => ({}));
        if (alive) setState(suggestStateFromResponse(res.ok, res.status, d));
      })
      .catch(() => { if (alive) setState({ loading: false, suggestions: [], source: '', reason: '', error: 'Ideas did not load. Retry by picking a button below.' }); });
    return () => { alive = false; };
    // Verdict identity is the input; the whole record travels in the body.
  }, [verdictKey, retry]);
  if (!r) return null;
  return (
    <div className="ev guidance" data-ai-guidance>
      <h3><Icon name="question" />Good next questions</h3>
      {state.loading && <p className="small" role="status">Looking for good next questions…</p>}
      {!state.loading && state.source === 'ai' && <p className="small">Muse Spark wrote these from the claim and its evidence. Pick one to check it here.</p>}
      {!state.loading && state.source === 'local' && state.reason === 'rate-limited' && <p className="small">High demand right now, so these are local ideas from the evidence we have: sources, dates, and numbers. Pick one to check it here.</p>}
      {!state.loading && state.source === 'local' && state.reason !== 'rate-limited' && <p className="small">Live AI is off here. So we made these questions from the evidence we have: sources, dates, and numbers.</p>}
      {!state.loading && state.error && <p className="small" role="status">{state.error} <button type="button" className="btn secondary" onClick={() => setRetry((n) => n + 1)} disabled={!!busy}>Retry ideas</button></p>}
      {state.suggestions.map((s, i) => (
        <p key={i}><button type="button" className="btn secondary" onClick={() => onPick(s)} disabled={!!busy}><Icon name="verify" />{s.question}</button>{' '}<span className="small">{s.why}</span></p>
      ))}
    </div>
  );
}
export function ChallengeButtons({ onChallenge, busy }) {
  return (
    <>
      <p>
        <button type="button" className="btn secondary" onClick={() => onChallenge('stronger-contrary')} disabled={busy === 'challenge'}><Icon name="search" />Find stronger evidence against it</button>{' '}
        <button type="button" className="btn secondary" onClick={() => onChallenge('stronger-support')} disabled={busy === 'challenge'}><Icon name="verify" />Find stronger evidence for it</button>
      </p>
      <p>
        <button type="button" className="btn secondary" onClick={() => onChallenge('prove-wrong')} disabled={busy === 'challenge'}><Icon name="question" />What would prove this wrong?</button>{' '}
        <button type="button" className="btn secondary" onClick={() => onChallenge('prove-right')} disabled={busy === 'challenge'}><Icon name="verify" />What would confirm this?</button>{' '}
        <button type="button" className="btn secondary" onClick={() => onChallenge('compare-author')} disabled={busy === 'challenge'}><Icon name="excerpt" />What does the author say?</button>
      </p>
    </>
  );
}
