// Text processing for retrieval: tokenization, Porter stemming, and
// term extraction (stemmed unigrams + bigrams, stopwords removed).
// Classical IR, deterministic, no model downloads. Stemming unifies the
// word variants a hashed bag-of-words kept apart (brains/brain,
// studies/studying, reduced/reduction); bigrams keep short phrases
// ("blood pressure") from dissolving into unrelated single words.

export function tokenize(text) {
  return String(text || '').toLowerCase().match(/[\p{L}\p{N}%]+/gu) || [];
}

const STOPWORDS = new Set(('a,an,the,and,or,of,to,in,on,for,with,by,at,from,was,were,is,are,be,been,being,'
  + 'it,its,this,that,these,those,as,an,had,has,have,having,do,does,did,but,if,then,than,so,such,'
  + 'no,not,only,over,under,after,before,between,into,through,during,each,other,more,most,can,will,'
  + 'would,could,should,may,might,must,shall,also,about,among,within,without,upon,per,via,one,two,'
  + 'all,any,both,few,many,much,own,same,too,very,just,once,here,there,when,where,which,who,whom,how,what').split(','));

// Porter stemmer (Porter, 1980). Numbers and short tokens pass through.
export function stem(word) {
  const w = String(word || '');
  if (w.length <= 2 || /^\d/.test(w)) return w;
  const cons = (s, i) => {
    const c = s[i];
    if ('aeiou'.includes(c)) return false;
    if (c === 'y') return i === 0 ? true : !cons(s, i - 1);
    return true;
  };
  const measure = (s) => {
    // Porter measure: [C](VC)^m[V]. Count vowel blocks that a consonant
    // block follows; a trailing vowel block adds nothing.
    let n = 0, i = 0;
    while (i < s.length && cons(s, i)) i++;
    while (i < s.length) {
      while (i < s.length && !cons(s, i)) i++;
      if (i >= s.length) break;
      n++;
      while (i < s.length && cons(s, i)) i++;
    }
    return n;
  };
  const hasVowel = (s) => [...s].some((_, i) => !cons(s, i));
  const doubleCons = (s) => s.length >= 2 && s[s.length - 1] === s[s.length - 2] && cons(s, s.length - 1);
  const cvc = (s) => s.length >= 3 && cons(s, s.length - 3) && !cons(s, s.length - 2) && cons(s, s.length - 1) && !'wxy'.includes(s[s.length - 1]);

  let out = w;
  // Step 1a: plurals.
  if (out.endsWith('sses')) out = out.slice(0, -2);
  else if (out.endsWith('ies')) out = out.slice(0, -2);
  else if (out.endsWith('ss')) { /* keep */ }
  else if (out.endsWith('s')) out = out.slice(0, -1);
  // Step 1b: -eed, -ed, -ing.
  if (out.endsWith('eed')) {
    if (measure(out.slice(0, -3)) > 0) out = out.slice(0, -1);
  } else {
    let stemmed = null;
    if (out.endsWith('ed') && hasVowel(out.slice(0, -2))) stemmed = out.slice(0, -2);
    else if (out.endsWith('ing') && hasVowel(out.slice(0, -3))) stemmed = out.slice(0, -3);
    if (stemmed !== null) {
      out = stemmed;
      if (/(at|bl|iz)$/.test(out)) out += 'e';
      else if (doubleCons(out) && !/[lsz]$/.test(out)) out = out.slice(0, -1);
      else if (measure(out) === 1 && cvc(out)) out += 'e';
    }
  }
  // Step 1c: terminal y.
  if (out.endsWith('y') && hasVowel(out.slice(0, -1))) out = out.slice(0, -1) + 'i';
  // Step 2: derivational suffixes, measure > 0.
  const step2 = [
    ['ational', 'ate'], ['tional', 'tion'], ['enci', 'ence'], ['anci', 'ance'], ['izer', 'ize'],
    ['bli', 'ble'], ['alli', 'al'], ['entli', 'ent'], ['eli', 'e'], ['ousli', 'ous'],
    ['ization', 'ize'], ['ation', 'ate'], ['ator', 'ate'], ['alism', 'al'], ['iveness', 'ive'],
    ['fulness', 'ful'], ['ousness', 'ous'], ['aliti', 'al'], ['iviti', 'ive'], ['biliti', 'ble'], ['logi', 'log'],
  ];
  for (const [suffix, repl] of step2) {
    if (out.endsWith(suffix)) {
      const base = out.slice(0, -suffix.length);
      if (measure(base) > 0) out = base + repl;
      break;
    }
  }
  // Step 3: more derivational suffixes, measure > 0.
  const step3 = [['icate', 'ic'], ['ative', ''], ['alize', 'al'], ['iciti', 'ic'], ['ical', 'ic'], ['ful', ''], ['ness', '']];
  for (const [suffix, repl] of step3) {
    if (out.endsWith(suffix)) {
      const base = out.slice(0, -suffix.length);
      if (measure(base) > 0) out = base + repl;
      break;
    }
  }
  // Step 4: residual suffixes, measure > 1.
  const step4 = ['ement', 'ance', 'ence', 'able', 'ible', 'ment', 'ant', 'ent', 'ism', 'ate', 'iti', 'ous', 'ive', 'ize', 'al', 'er', 'ic', 'ou'];
  let step4Done = false;
  for (const suffix of step4) {
    if (out.endsWith(suffix)) {
      const base = out.slice(0, -suffix.length);
      if (measure(base) > 1) { out = base; step4Done = true; }
      break;
    }
  }
  if (!step4Done && out.endsWith('ion')) {
    const base = out.slice(0, -3);
    if (measure(base) > 1 && /[st]$/.test(base)) out = base;
  }
  // Step 5a: terminal e.
  if (out.endsWith('e')) {
    const base = out.slice(0, -1);
    const m = measure(base);
    if (m > 1 || (m === 1 && !cvc(base))) out = base;
  }
  // Step 5b: terminal double l.
  if (measure(out) > 1 && out.endsWith('ll')) out = out.slice(0, -1);
  return out;
}

const NUM_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const NUM_MULTIPLIERS = { hundred: 100, thousand: 1000, million: 1000000 };

// Tokens with number words folded into digits: "eighty" -> "80",
// "one hundred twenty" -> "120". Claims and evidence mix the two forms
// freely, and before this they were simply different terms.
export function normalizedTokens(text) {
  const raw = tokenize(text);
  const out = [];
  let cur = null;
  const flush = () => { if (cur !== null) { out.push(String(cur)); cur = null; } };
  for (let i = 0; i < raw.length; i++) {
    const tok = raw[i];
    // "one" is usually a pronoun, not a count: fold it only in
    // "one hundred / one thousand ..." or mid-sequence.
    if (tok === 'one' && cur === null && !Object.hasOwn(NUM_MULTIPLIERS, raw[i + 1] || '')) { flush(); out.push(tok); continue; }
    if (Object.hasOwn(NUM_MULTIPLIERS, tok)) { cur = (cur === null ? 1 : cur) * NUM_MULTIPLIERS[tok]; continue; }
    if (Object.hasOwn(NUM_WORDS, tok)) { cur = (cur === null ? 0 : cur) + NUM_WORDS[tok]; continue; }
    flush();
    out.push(tok);
  }
  flush();
  return out;
}

// Every number in a text, digits or words, in order of appearance.
export function numbersIn(text) {
  return normalizedTokens(text).map((t) => String(t).replace(/%$/, '')).filter((t) => /^\d+$/.test(t)).map(Number);
}

const MONTHS = { january: '01', february: '02', march: '03', april: '04', may: '05', june: '06', july: '07', august: '08', september: '09', october: '10', november: '11', december: '12' };

// First date stated inside a text, ISO format: "June 2019" -> 2019-06-01,
// a bare year -> January of that year. The Outdated gate compares these
// lexicographically, so nothing non-ISO may come out of here.
export function inTextDate(text) {
  const s = String(text || '');
  const named = s.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+([12]\d{3})\b/i);
  if (named) return `${named[2]}-${MONTHS[named[1].toLowerCase()]}-01`;
  const year = s.match(/\b([12]\d{3})\b/);
  return year ? `${year[1]}-01-01` : null;
}

const WORD_NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20 };

// "Five years later" resolved against a known base date. Without a base
// date the honest answer is null; relative phrasing alone proves nothing.
export function relativeDate(text, baseISO) {
  if (!baseISO || !/^\d{4}-\d{2}-\d{2}$/.test(baseISO)) return null;
  const s = String(text || '').toLowerCase();
  let years = null;
  const m = s.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|fifteen|twenty|\d+)\s+years?\s+later\b/);
  if (m) years = WORD_NUMBERS[m[1]] ?? Number(m[1]);
  else if (/\ba decade later\b/.test(s)) years = 10;
  else if (/\bthe following year\b/.test(s)) years = 1;
  if (years === null || !Number.isFinite(years)) return null;
  return `${Number(baseISO.slice(0, 4)) + years}${baseISO.slice(4)}`;
}

// Negation and hedging cues. Deterministic wording signals, nothing
// more: a passage can negate a claim or hedge it, and overlap-based
// matching is blind to both. Stance remains the judge's and NLI's job;
// these flags exist so forensics can mark the wording honestly.
const NEGATION_RE = /\b(no significant|no evidence|no effect|did not|does not|do not|failed to|not associated|never found|not shown)\b/i;
const HEDGING_RE = /\b(may|might|could|suggests?|suggested|possibly|appears? to|seems? to|modest|preliminary|tentative)\b/i;
export const hasNegation = (text) => NEGATION_RE.test(String(text || ''));
export const hasHedging = (text) => HEDGING_RE.test(String(text || ''));

// Stemmed content terms for a text: unigrams (repeated per occurrence,
// so term frequency survives) plus adjacent bigrams. Stopwords are
// dropped before pairing, so bigrams join neighbouring content words.
export function termsOf(text) {
  // Filter before stemming too: "only" stems to "onli" and escapes the list.
  const stems = normalizedTokens(text).filter((t) => !STOPWORDS.has(t)).map((t) => stem(String(t).replace(/%$/, ''))).filter((t) => t.length > 1 && !STOPWORDS.has(t));
  const terms = [...stems];
  for (let i = 0; i + 1 < stems.length; i++) terms.push(`${stems[i]}~${stems[i + 1]}`);
  return terms;
}
