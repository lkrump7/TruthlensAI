// Prompt-injection screening for untrusted book and web text.
const INJECTION = [
  /ignore (all )?(previous|prior|above) instructions/i,
  /reveal (your )?(system prompt|instructions)/i,
  /disregard (your|the) (rules|instructions)/i,
  /you are now (a|an|in)\b/i,
  /(reveal|show|print|leak|tell me) (your |the )?(system prompt|initial instructions)/i,
  /jailbreak/i,
];

export function screenContent(text) {
  const t = String(text || '');
  for (const re of INJECTION) {
    if (re.test(t)) return { action: 'quarantine', category: 'prompt-injection', matched: String(re) };
  }
  return { action: 'allow', category: null, matched: null };
}
