import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, stem, termsOf, normalizedTokens, numbersIn, inTextDate, relativeDate } from '../lib/nlp.mjs';
import { VectorIndex } from '../lib/vector.mjs';

test('stemmer follows Porter on the canonical examples', () => {
  const pairs = {
    caresses: 'caress', ponies: 'poni', ties: 'ti', caress: 'caress', cats: 'cat',
    feed: 'feed', agreed: 'agre', plastered: 'plaster', motoring: 'motor', sing: 'sing',
    conflated: 'conflat', troubled: 'troubl', sized: 'size', hopping: 'hop', tanned: 'tan',
    falling: 'fall', hissing: 'hiss', fizzed: 'fizz', failing: 'fail', filing: 'file',
    happy: 'happi', sky: 'sky', relational: 'relat', conditional: 'condit', rational: 'ration',
    valenci: 'valenc', hesitanci: 'hesit', digitizer: 'digit', radicalli: 'radic',
    differentli: 'differ', vileli: 'vile', vietnamization: 'vietnam', predication: 'predic',
    operator: 'oper', feudalism: 'feudal', decisiveness: 'decis', hopefulness: 'hope',
    callousness: 'callous', formaliti: 'formal', sensitiviti: 'sensit', sensibiliti: 'sensibl',
    revival: 'reviv', allowance: 'allow', inference: 'infer', airliner: 'airlin',
    adjustable: 'adjust', defensible: 'defens', irritant: 'irrit', replacement: 'replac',
    adjustment: 'adjust', dependent: 'depend', adoption: 'adopt', communism: 'commun',
    activate: 'activ', angulariti: 'angular', effective: 'effect', bowdlerize: 'bowdler',
    probate: 'probat', rate: 'rate', cease: 'ceas', controll: 'control', roll: 'roll',
  };
  for (const [word, expected] of Object.entries(pairs)) {
    assert.equal(stem(word), expected, `stem(${word})`);
  }
});

test('stemmer unifies the word variants retrieval actually meets', () => {
  assert.equal(stem('brains'), stem('brain'));
  assert.equal(stem('studies'), stem('studying'));
  assert.equal(stem('reduced'), stem('reduces'));
  assert.equal(stem('hospitalisations'), stem('hospitalisation'));
  assert.equal(stem('patients'), stem('patient'));
  assert.equal(stem('flooding'), stem('floods'));
  assert.equal(stem('10%'), '10%', 'numbers and percentages pass through unstemmed');
});

test('tokenize keeps words, numbers, and percentages; termsOf drops stopwords and adds bigrams', () => {
  assert.deepEqual(tokenize('Blood-pressure fell by 12.5% in 1998.'), ['blood', 'pressure', 'fell', 'by', '12', '5%', 'in', '1998']);
  const terms = termsOf('The brain and the brain scans');
  assert.ok(!terms.includes('the') && !terms.includes('and'), 'stopwords removed');
  assert.ok(terms.filter((t) => t === 'brain').length === 2, 'unigram counts preserved');
  assert.ok(terms.some((t) => t.includes('~')), 'bigram terms present');
});

test('termsOf drops stopwords before stemming, so only/this do not leak as onli/thi', () => {
  const terms = termsOf('Only this claim holds water');
  assert.ok(!terms.includes('onli'));
  assert.ok(!terms.includes('thi'));
  assert.ok(terms.includes('claim'));
});

test('number words normalize to digits so 80 and eighty are the same term', () => {
  assert.ok(normalizedTokens('Deaths fell by eighty percent.').includes('80'));
  assert.ok(normalizedTokens('Twelve patients recovered.').includes('12'));
  assert.ok(normalizedTokens('One hundred twenty adults enrolled.').includes('120'));
  assert.ok(termsOf('Deaths fell by eighty percent.').includes('80'));
  assert.deepEqual(numbersIn('Mortality fell by 40 percent from eighty deaths to 12.'), [40, 80, 12]);
  assert.deepEqual(numbersIn('No numbers in this sentence at all.'), []);
});

test('temporal normalisation reads in-text dates and relative offsets', () => {
  assert.equal(inTextDate('Results were published in June 2019 in the journal.'), '2019-06-01');
  assert.equal(inTextDate('The reservoir opened in 1998 after construction.'), '1998-01-01');
  assert.equal(inTextDate('No date is mentioned anywhere in this passage.'), null);
  assert.equal(relativeDate('Five years later, deaths had fallen sharply.', '2010-06-01'), '2015-06-01');
  assert.equal(relativeDate('The following year, the trial was repeated.', '2010-06-01'), '2011-06-01');
  assert.equal(relativeDate('A decade later the results still held.', '2010-06-01'), '2020-06-01');
  assert.equal(relativeDate('Nothing temporal is stated here.', '2010-06-01'), null);
  assert.equal(relativeDate('Five years later, deaths had fallen.', null), null, 'no base date, no invented date');
});

test('vector index matches word variants the hashed index missed', () => {
  const idx = new VectorIndex();
  idx.add('scan', 'Brain imaging shows activity across the whole brain during ordinary tasks.');
  idx.add('coach', 'Our coaching program promises to unlock your silent potential in ten sessions.');
  const hits = idx.search('Humans only use 10% of their brains.', 1);
  assert.equal(hits[0].id, 'scan', 'brains must match brain');
  assert.ok(hits[0].score > 0);
});

test('BM25 ranks by saturated term frequency and document length', () => {
  const idx = new VectorIndex();
  idx.add('stuffed', 'vaccine ' + 'vaccine '.repeat(20) + 'news page about schedules and clinics and opinions.');
  idx.add('matching', 'The vaccine trial reduced hospitalisations among elderly residents substantially.');
  idx.add('filler', 'The committee published its annual report on regional spending and staffing levels.');
  const hits = idx.searchBM25('vaccine reduced hospitalisations elderly', 2);
  assert.equal(hits[0].id, 'matching', 'three distinct query terms once beat one term repeated twenty times');
  assert.ok(hits[0].score > hits[1].score);
});

test('TF-IDF ranks a rare shared term above a common shared word', () => {
  const idx = new VectorIndex();
  idx.add('common', 'The study was conducted and the results were reported in the journal.');
  idx.add('rare', 'The cohort tracked hypertension outcomes over a decade of follow-up.');
  idx.add('filler1', 'The committee met and the report was discussed at length by the members.');
  idx.add('filler2', 'The journal published the study and the editors welcomed the debate.');
  const hits = idx.search('hypertension cohort study', 2);
  assert.equal(hits[0].id, 'rare', 'rare discriminating terms outweigh the common word "study"');
});
