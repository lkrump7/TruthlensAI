import { test } from 'node:test';
import assert from 'node:assert/strict';
import { utilityScore, rankJudgeEvidence } from '../lib/evidence.mjs';
import { parseSearchResponse, verifyResearchedClaim, researchClaim } from '../lib/research.mjs';
import { BUDGET } from '../lib/fetch.mjs';

test('BUDGET has no dead judge-call cap (TL-015)', () => {
  assert.equal(BUDGET.maxJudgeCalls, undefined);
});

test('utilityScore rewards claim overlap and source tier', () => {
  const claim = 'Humans only use 10% of their brains';
  const gov = utilityScore({ passage: 'Brain scans of brains show the 10% claim is false', source: 'nih.gov' }, claim);
  const blog = utilityScore({ passage: 'Some blog mentions brains once', source: 'blog.example' }, claim);
  assert.ok(gov > blog, `${gov} vs ${blog}`);
});

test('rankJudgeEvidence orders by utility but drops nothing the budget fetched', () => {
  const claim = 'Humans only use 10% of their brains';
  const evidence = [
    { id: 'e1', source: 'blog.example', passage: 'Brains are interesting organs' },
    { id: 'e2', source: 'nih.gov', passage: 'Brain scans show brains active; the 10% brains claim fails' },
    { id: 'e3', source: 'who.int', passage: 'The 10% brains myth: brains imaging contradicts it' },
    { id: 'e4', source: 'blog.example', passage: 'Use your brains, a motivational brains post' },
    { id: 'e5', source: 'nature.com', passage: 'Neuroscience: brains at 10% is wrong about brains' },
  ];
  const ranked = rankJudgeEvidence(evidence, claim);
  assert.equal(ranked.length, 5, 'every budgeted passage reaches the judge; utility orders, it does not cut');
  assert.equal(ranked[0].id, 'e2', 'most useful passage first');
  assert.ok(ranked.some((e) => e.id === 'e1'), 'even the weakest passage is retained for the judge to weigh');
});

test('research fetches every budgeted source in parallel (early stopping disabled: verdict quality over fetch savings)', async () => {
  const sources = Array.from({ length: 8 }, (_, i) => ({ title: 'S' + i, url: `https://s${i}.example/brain` }));
  const search = async () => ({ queries: ['q'], sources, citations: [] });
  let fetches = 0;
  const fetchText = async (url) => { fetches++; const n = Number(url.match(/s(\d)/)[1]); return n % 2
    ? '<body><p>Neuroscience mapping of brains shows activity across the whole brain daily; the ten percent myth about brains fails.</p></body>'
    : '<body><p>Brain scans show activity throughout the brain every day, contradicting the ten percent myth about brains.</p></body>'; };
  const r = await researchClaim('Humans only use 10% of their brains.', { search, fetchText, cache: false });
  assert.ok(r.evidence.length >= 1);
  assert.equal(fetches, 8);
  assert.equal(r.stoppedEarly, false);
});

test('evidence carries neighbouring-window context for the judge, citation text unchanged', async () => {
  const page = `<body><p>The committee toured the reservoir in spring and inspected the dam gates, the spillway charts, the access roads, and the maintenance sheds along the eastern shore of the lake. Flooding deaths fell by sixty percent after the reservoir opened, the county report states, citing coroner records from every valley town over the five following years. Tourism boats now rent from the new marina each summer, and the visitor centre sells maps, tackle, and local honey to weekend visitors from the city.</p></body>`;
  const search = async () => ({ queries: ['q'], sources: [{ title: 'County', url: 'https://county.example/reservoir' }], citations: [] });
  const fetchText = async () => page;
  const r = await researchClaim('The reservoir reduced flooding deaths by 60 percent.', { search, fetchText, cache: false, embedTexts: async () => null, rerankTexts: async () => null });
  const item = r.evidence.find((e) => /Flooding deaths fell/.test(e.passage));
  assert.ok(item, 'the on-point window is extracted');
  assert.ok(item.context && (/spillway|marina/.test(item.context)), `neighbouring windows attached as context, got: ${item.context}`);
  assert.doesNotMatch(item.passage, /marina/, 'the cited passage itself stays the extracted window');
});

test('research drops a page whose only window shares one strong term (TL-005)', async () => {
  const sources = [
    { title: 'Scan', url: 'https://scan.example/brain' },
    { title: 'Myth', url: 'https://myth.example/brain' },
  ];
  const search = async () => ({ queries: ['q'], sources, citations: [] });
  const fetchText = async (url) => (url.includes('scan')
    ? '<body><p>Brain imaging shows activity across the whole brain during a day of ordinary tasks and sleep.</p></body>'
    : '<body><p>Neuroscientists call the ten percent brain story a myth with no basis in scanning studies of brains.</p></body>');
  const r = await researchClaim('Humans only use 10% of their brains.', { search, fetchText, cache: false, embedTexts: async () => null, rerankTexts: async () => null });
  assert.ok(!r.evidence.some((e) => /imaging shows activity/.test(e.passage)), 'single-overlap page is below the relevance floor');
  assert.ok(r.evidence.some((e) => /ten percent brain story/.test(e.passage)), 'two-word-overlap page still contributes');
});

test('research tolerates a fetched page with no extractable text', async () => {
  const sources = [
    { title: 'Empty', url: 'https://empty.example/brain' },
    { title: 'Full', url: 'https://full.example/brain' },
  ];
  const search = async () => ({ queries: ['q'], sources, citations: [] });
  const fetchText = async (url) => (url.includes('empty') ? '' : '<body><p>Brain scans show activity throughout the brain every day, contradicting the ten percent myth about brains.</p></body>');
  const r = await researchClaim('Humans only use 10% of their brains.', { search, fetchText, cache: false });
  assert.ok(r.evidence.length >= 1, 'the good page still yields evidence');
  assert.equal(r.failures.length, 0, 'an empty page is not a fetch failure, just no passages');
});

test('research never sacrifices a late novel source for fetch savings', async () => {
  const sources = Array.from({ length: 9 }, (_, i) => ({ title: 'S' + i, url: `https://s${i}.example/brain` }));
  const search = async () => ({ queries: ['q'], sources, citations: [] });
  let fetches = 0;
  const fetchText = async (url) => {
    fetches++;
    const n = Number(url.match(/s(\d)/)[1]);
    if (n >= 6) return '<body><p>Electrophysiology recordings of brains show the ten percent myth about brains is false: every brain region is active across the day.</p></body>';
    return '<body><p>Brain scans show activity throughout the brain every day, contradicting the ten percent myth about brains.</p></body>';
  };
  const r = await researchClaim('Humans only use 10% of their brains.', { search, fetchText, cache: false, maxSources: 9 });
  assert.equal(fetches, 9);
  assert.ok(r.evidence.some((e) => /Electrophysiology/.test(e.passage)), 'late novel passage must survive');
});

test('marginal-gain stopping: research keeps fetching while batches add new passages', async () => {
  const sources = Array.from({ length: 8 }, (_, i) => ({ title: 'S' + i, url: `https://s${i}.example/brain` }));
  const search = async () => ({ queries: ['q'], sources, citations: [] });
  let fetches = 0;
  const findings = [
    'Brain scans show activity throughout the brain every day, contradicting the ten percent myth.',
    'Electrophysiology recordings find every brain region active across the sleep cycle, against the ten percent story.',
    'Lesion studies show damage anywhere in the brain impairs some function; no silent region supports the ten percent claim.',
    'Metabolic measurements find the brain consumes steady energy in all regions at rest, never idle at ten percent.',
    'Neuroimaging reviews conclude the ten percent figure about brains has no basis in scan data.',
    'Stimulation mapping locates function across the whole cortex of the brain, not in ten percent of it.',
    'Longitudinal scans track widespread daily activity in every lobe of the brain, refuting the ten percent figure.',
    'Case series of brain injuries show deficits from lesions in every region studied, with no ten percent refuge.',
  ];
  const fetchText = async (url) => { fetches++; const n = Number(url.match(/s(\d)/)[1]); return `<body><p>${findings[n]}</p></body>`; };
  const r = await researchClaim('Humans only use 10% of their brains.', { search, fetchText, cache: false });
  assert.equal(fetches, 8);
  assert.ok(r.evidence.length >= 3);
});

test('rankJudgeEvidence keeps every domain for corroboration', () => {
  const claim = 'Humans only use 10% of their brains';
  const evidence = [
    { id: 'g1', source: 'nih.gov', passage: 'Brain scans brains 10% brains myth brains' },
    { id: 'g2', source: 'nih.gov', passage: 'Brains brains brains 10% myth brains scans' },
    { id: 'g3', source: 'nih.gov', passage: 'Brains 10% brains brains myth imaging brains' },
    { id: 'w1', source: 'who.int', passage: 'Brains myth brains scans' },
  ];
  const ranked = rankJudgeEvidence(evidence, claim);
  assert.equal(ranked.length, 4);
  assert.equal(new Set(ranked.map((e) => e.source)).size, 2);
});

test('judge citations are validated against the evidence the judge actually saw', async () => {
  const SAMPLE = { output: [{ type: 'web_search_call', action: { query: 'q' }, results: [
    { title: 'A', url: 'https://a.example/brain' }, { title: 'B', url: 'https://b.example/brain' }, { title: 'C', url: 'https://c.example/brain' }, { title: 'D', url: 'https://d.example/brain' },
  ] }] };
  const search = async () => parseSearchResponse(SAMPLE);
  const fetchText = async (url) => `<body><p>Brain scans show activity throughout the brain every day ${url}, contradicting the ten percent myth about brains and brains imaging.</p><p>More brains research: the brain and brains myth again with brains evidence daily.</p></body>`;
  let sawIds = [];
  const judge = async ({ evidence }) => { sawIds = evidence.map((e) => e.id); const unseen = ['ev-web-8', 'ev-web-7', 'ev-web-6', 'ev-web-5', 'ev-web-4'].find((id) => !evidence.some((e) => e.id === id)); return { verdict: 'Contradicted', citedIds: [unseen], stances: {}, explanation: 'cites unseen' }; };
  await assert.rejects(() => verifyResearchedClaim('Humans only use 10% of their brains.', { search, fetchText, judge, challenge: null, cache: false }), /unknown evidence/i);
  assert.ok(sawIds.length >= 1 && sawIds.length <= 5);
});

test('pipeline sends the whole budgeted pool to the judge, utility-ordered', async () => {
  const SAMPLE = { output: [{ type: 'web_search_call', action: { query: 'q' }, results: [
    { title: 'A', url: 'https://a.example/brain' }, { title: 'B', url: 'https://b.example/brain' }, { title: 'C', url: 'https://c.example/brain' }, { title: 'D', url: 'https://d.example/brain' }, { title: 'E', url: 'https://e.example/brain' },
  ] }] };
  const search = async () => parseSearchResponse(SAMPLE);
  const distinct = {
    'https://a.example/brain': 'Brain scans show activity throughout the brain every day, contradicting the ten percent myth about brains and brains imaging.',
    'https://b.example/brain': 'Electrophysiology recordings find every brain region active across the sleep cycle, against the ten percent story.',
    'https://c.example/brain': 'Lesion studies show damage anywhere in the brain impairs function; no silent ninety percent of brains exists behind the ten percent claim.',
    'https://d.example/brain': 'Metabolic measurements find the brain consuming steady energy in all regions, brains never idle at ten percent.',
    'https://e.example/brain': 'Neuroimaging reviews conclude the ten percent figure for brains has no basis in any scan data collected.',
  };
  const fetchText = async (url) => `<body><p>${distinct[url]}</p></body>`;
  let judgeSaw = 0;
  const judge = async ({ evidence }) => { judgeSaw = evidence.length; return { verdict: 'Contradicted', citedIds: evidence.map((e) => e.id), stances: Object.fromEntries(evidence.map((e) => [e.id, 'contradicts'])), explanation: 'x' }; };
  const r = await verifyResearchedClaim('Humans only use 10% of their brains.', { search, fetchText, judge, challenge: null, cache: false });
  assert.equal(r.verdict, 'Contradicted');
  assert.equal(judgeSaw, 5, `judge must see the whole budgeted pool of 5, saw ${judgeSaw}`);
});
