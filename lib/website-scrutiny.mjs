function wordsOf(text) {
  return String(text || '').split(/\s+/).map((w) => w.trim()).filter(Boolean);
}

function paragraphsOf(doc) {
  const pages = Array.isArray(doc.pages) ? doc.pages : [];
  const fromPages = pages.map((p) => String(p?.text || '').trim()).filter(Boolean);
  if (fromPages.length) return fromPages;
  return String(doc.text || '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
}

export function scrutinyTelemetry(doc = {}) {
  const claims = Array.isArray(doc.claims) ? doc.claims.filter((c) => !c?.dismissed) : [];
  const dismissed = Array.isArray(doc.claims) ? doc.claims.filter((c) => c?.dismissed).length : 0;
  const paras = paragraphsOf(doc);
  const words = wordsOf(paras.join('\n')).length;
  const tally = (name) => claims.filter((c) => String(c.verdict || '').toLowerCase() === name).length;
  const supported = tally('supported');
  const contradicted = tally('contradicted');
  const partial = claims.filter((c) => {
    const v = String(c.verdict || '').toLowerCase();
    return v === 'partially supported' || v === 'partially-supported' || v === 'partial'
      || v === 'misleading' || v === 'outdated';
  }).length;
  let host = '';
  try {
    host = new URL(doc.sourceUrl || '').hostname.replace(/^www\./, '');
  } catch { host = ''; }
  return {
    words,
    paragraphs: paras.length,
    total: claims.length,
    supported,
    contradicted,
    partial,
    neutralized: Number(doc.quarantined || 0),
    host,
    dismissed,
  };
}
