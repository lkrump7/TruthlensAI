import { topicKeyFor } from './claims.mjs';
import { DECISIVE_VERDICTS } from './verdict.mjs';

// Knowledge Contradiction Map: claims from different documents that share a
// topic but disagree in verdict, direction, or numbers. Relational only —
// no graph database; positions carry their book and page for navigation.
const DIRECTION = [
  { re: /\b(increases?|raises?|improves?|grows?|grew|rose|doubled|tripled|more)\b/i, sign: 1 },
  { re: /\b(reduces?|decreases?|lowers?|worsens?|prevented|fell|dropped|declined|halved|fewer|less)\b/i, sign: -1 },
];
const signOf = (text) => (DIRECTION.find((d) => d.re.test(text)) || {}).sign || 0;
const yearsOf = (text) => (String(text).match(/\b(19|20)\d{2}\b/g) || []);

export function buildContradictionMap(docs = []) {
  const groups = new Map();
  for (const doc of docs || []) {
    for (const claim of doc.claims || []) {
      // Group on topic alone: the numeric suffix that keeps research
      // pools apart must not split one topic into per-number groups.
      const key = topicKeyFor(claim.text).split('|')[0];
      if (!key) continue;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ docId: doc.id, docTitle: doc.title, claimId: claim.id, text: claim.text, verdict: claim.verdict, page: claim.page, sign: signOf(claim.text), years: yearsOf(claim.text) });
    }
  }
  const entries = [];
  for (const [topic, positions] of groups) {
    if (new Set(positions.map((p) => p.docId)).size < 2) continue;
    const signs = new Set(positions.map((p) => p.sign).filter(Boolean));
    const verdicts = new Set(positions.map((p) => p.verdict));
    if (signs.size < 2 && !DECISIVE_VERDICTS.every((v) => verdicts.has(v))) continue;
    const years = [...new Set(positions.flatMap((p) => p.years))];
    const decisive = positions.filter((x) => DECISIVE_VERDICTS.includes(x.verdict));
    const verifiedDisagreement = DECISIVE_VERDICTS.every((v) => verdicts.has(v)) || (signs.size >= 2 && decisive.length >= 2);
    entries.push({
      topic, verifiedDisagreement,
      positions: positions.map(({ sign: _sign, years: _y, ...rest }) => rest),
      scopeNote: years.length > 1 ? `Positions span different periods (${years.join(', ')}); check whether they describe the same timeframe.` : 'Positions appear to address the same question; inspect period, population, and definitions before treating them as a direct disagreement.',
    });
  }
  return entries.sort((a, b) => b.positions.length - a.positions.length);
}
