import { assertPublicUrl, fetchPageText } from './fetch.mjs';
import { htmlToText } from './evidence.mjs';
import { TruthLensError } from './errors.mjs';

export class WebsiteError extends TruthLensError {
  constructor(message, opts = {}) { super(message, { code: 'website', ...opts }); }
}

// A page below this much readable text is a script shell, a paywall stub,
// or a redirect notice. Creating a document from it would extract claims
// from boilerplate, so the ingestion refuses it honestly instead.
export const MIN_WEBSITE_CHARS = 200;

const decodeEntities = (s) => String(s || '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
  .replace(/&#39;|&rsquo;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

export function extractWebsiteTitle(html) {
  const s = String(html || '');
  const m = s.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)
    || s.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return null;
  const title = decodeEntities(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  return title || null;
}

// Fetch one public page and shape it as a one-page document source.
// The fetch itself is the guarded fetcher evidence already uses: private
// addresses blocked, redirects capped, download capped. Text extraction
// is the same tag stripping, so a website claim is kept as written,
// never rewritten by a model before checking.
const BOILERPLATE = /<(nav|header|footer|aside|form|button|select|textarea|noscript)[\s\S]*?<\/\1>/gi;

export async function fetchWebsitePages(url, { fetchText = fetchPageText } = {}) {
  const clean = assertPublicUrl(String(url || '').trim());
  const html = await fetchText(clean);
  const text = htmlToText(String(html || '').replace(BOILERPLATE, ' '));
  if (text.length < MIN_WEBSITE_CHARS) {
    throw new WebsiteError(`That page gave too little readable text (${text.length} characters). It may need JavaScript to render, sit behind a paywall, or block fetching. Paste the article text as a document instead.`);
  }
  return { url: clean, title: extractWebsiteTitle(html), pages: [{ page: 1, text }] };
}
