import { Icon } from './icons.js';
import { cls } from './verdict.js';

// Website Scrutiny and Ingestion workbench. Every number shown comes from the
// loaded document: word and paragraph counts, claim verdict tallies, and the
// quarantined snippet count. Nothing here invents crawl timings or hashes.
export function WebsiteScrutiny({
  doc,
  telemetry,
  claims,
  counts,
  activeFilter,
  onFilter,
  selectedId,
  onInspect,
  onChallenge,
  onExport,
  onRecrawl,
  onDebate,
  busy,
}) {
  const t = telemetry || { words: 0, paragraphs: 0, total: 0, supported: 0, contradicted: 0, partial: 0, neutralized: 0, host: '' };
  const shortId = String(doc.id || '').slice(0, 8) || 'unknown';
  const checking = doc.status === 'verifying';
  const unchecked = t.total - (t.supported + t.contradicted + t.partial);
  const filters = [
    ['All', ''],
    [`Supported (${t.supported})`, 'Supported'],
    [`Contradicted (${t.contradicted})`, 'Contradicted'],
    [`Partial (${t.partial})`, 'Partially supported'],
    [`Not checked yet (${unchecked})`, 'unchecked'],
  ];
  return (
    <section data-website-scrutiny aria-label="Website scrutiny and ingestion">
      <p className="scr-crumb">
        <span>Workspace</span><span aria-hidden="true"> / </span>
        <span>Ingestion Workflows</span><span aria-hidden="true"> / </span>
        <strong>Website Scrutiny &amp; Ingestion</strong>
        <span className="scr-id">Doc #{shortId}</span>
      </p>
      <div className="scr-top">
        <p className="scr-shield">
          <Icon name="verify" />
          <span>Prompt-injection shield active</span>
          <span className="stamp v-Supported">{t.neutralized} neutralized</span>
        </p>
        <div className="scr-actions">
          <button type="button" className="btn secondary" onClick={onRecrawl} disabled={busy === 'recheck'}>
            <Icon name="refresh" />{busy === 'recheck' ? 'Re-crawling…' : 'Re-crawl'}
          </button>
          <button type="button" className="btn secondary" onClick={onDebate}>
            <Icon name="question" />Send to Debate Arena
          </button>
        </div>
      </div>

      <div className="scr-urlbar">
        <Icon name="website" />
        <a href={doc.sourceUrl} target="_blank" rel="noreferrer">{doc.sourceUrl}</a>
        <span className="scr-host">{t.host || 'saved page'}</span>
        <span className={checking ? 'stamp v-Unverifiable' : 'stamp v-Supported'}>{checking ? 'Checking' : 'Loaded'}</span>
      </div>

      <div className="scr-cards">
        <div className="scr-card">
          <span className="meta">Crawl status</span>
          <strong>{checking ? 'Checking now' : 'Loaded'}</strong>
          <span className="small">{checking ? 'Claims are being extracted.' : 'Text extracted. Scripts and styles removed.'}</span>
        </div>
        <div className="scr-card">
          <span className="meta">Lexical scope</span>
          <strong>{t.words.toLocaleString()} words</strong>
          <span className="small">{t.paragraphs} paragraph{t.paragraphs === 1 ? '' : 's'}</span>
        </div>
        <div className="scr-card">
          <span className="meta">Assertion yield</span>
          <strong>{t.total} claim{t.total === 1 ? '' : 's'}</strong>
          <span className="small">{t.contradicted} fail / {t.supported} pass{unchecked > 0 ? ` / ${unchecked} unchecked` : ''}</span>
        </div>
        <div className="scr-card">
          <span className="meta">Injection deflector</span>
          <strong>{t.neutralized} neutralized</strong>
          <span className="small">{t.neutralized > 0 ? 'Hidden instructions removed before checking.' : 'No hidden instructions found.'}</span>
        </div>
      </div>

      <div className="scr-workbench">
        <div className="scr-dom">
          <div className="scr-dom-head">
            <h3><Icon name="website" />Extracted article DOM</h3>
            <span className="scr-sanitized">Sanitized tree</span>
          </div>
          <div className="scr-record">
            <span className="meta">Target publication record</span>
            <p className="scr-title">{doc.title}</p>
            <p className="small">{t.host}{doc.createdAt ? ` · saved ${String(doc.createdAt).slice(0, 10)}` : ''}</p>
          </div>
          {t.neutralized > 0 && (
            <p className="scr-quarantine">
              <Icon name="verify" />
              <span>Adversarial vector neutralized (prompt injection). {t.neutralized} hidden snippet{t.neutralized === 1 ? '' : 's'} removed. {t.neutralized === 1 ? 'It did' : 'They did'} not change the verdict.</span>
            </p>
          )}
          {claims.length === 0 && <p className="small">No claims extracted yet. {checking ? 'The check is still running.' : 'Run batch verification or check a claim by hand.'}</p>}
          {claims.map((c, i) => (
            <button
              type="button"
              key={c.id}
              className="scr-para"
              data-selected={selectedId === c.id ? 'true' : 'false'}
              onClick={() => onInspect(c)}
            >
              <span className="scr-para-head"><span className="meta">Claim {i + 1}</span>{c.verdict ? <span className={cls(c.verdict)}>{c.verdict}</span> : <span className="stamp v-Unverifiable">Not checked yet</span>}</span>
              <span className="scr-para-text">{c.text}</span>
            </button>
          ))}
          <p className="scr-audit small">Source: {doc.sourceUrl} · Parser removed scripts, styles, and navigation boilerplate before extraction.</p>
        </div>

        <div className="scr-rail">
          <div className="scr-tabs" role="group" aria-label="Filter claims by verdict">
            {filters.map(([label, value]) => (
              <button
                type="button"
                key={label}
                className={activeFilter === value ? 'tab on' : 'tab'}
                aria-pressed={activeFilter === value}
                onClick={() => onFilter(value)}
              >{label}</button>
            ))}
          </div>
          <p className="small">{counts.shown} of {counts.total} shown · document order</p>
          {claims.length === 0 && counts.total > 0 && <p className="small">No claims match. Try another filter.</p>}
          {claims.map((c) => {
            const supporting = c.supporting?.length || 0;
            const contradicting = c.contradicting?.length || 0;
            const align = c.uncertainty?.faithfulness?.score;
            return (
              <article className="scr-claim" key={c.id}>
                <div className="scr-claim-head">
                  {c.verdict ? <span className={cls(c.verdict)}>{c.verdict}</span> : <span className="stamp v-Unverifiable">Not checked yet</span>}
                </div>
                <p className="scr-claim-text">“{c.text}”</p>
                <p className="small">
                  {supporting + contradicting > 0 ? `${supporting} for · ${contradicting} against` : 'No quotes yet'}
                  {Number.isFinite(align) ? ` · alignment ${Math.round(align * 100)}%` : ''}
                </p>
                <div className="scr-claim-actions">
                  <button type="button" className="linklike" onClick={() => onInspect(c)}><Icon name="view" />Inspect snippet</button>
                  {c.verdict && <button type="button" className="linklike" onClick={() => onChallenge(c)}><Icon name="question" />Challenge</button>}
                  {c.verdict && <button type="button" className="linklike" onClick={() => onExport(c)}><Icon name="download" />Save dossier</button>}
                </div>
              </article>
            );
          })}
        </div>
      </div>

      <p className="scr-prov small">
        <span>Document #{shortId}</span>
        <span> · </span>
        <span>{t.supported + t.contradicted + t.partial} of {t.total} claims checked</span>
      </p>
    </section>
  );
}
