import { CONFIG } from './config.mjs';
import { classifyClaim } from './claims.mjs';
import { screenContent } from './screen.mjs';
import { VectorIndex } from './vector.mjs';
import { makeVerdict, validateCitations, newestEvidenceDate } from './verdict.mjs';
import { investigateEvidenceChain } from './forensics.mjs';
import { assessUncertainty } from './uncertainty.mjs';

// Curated demo corpus. Every passage is fetched-or-dropped in live mode;
// in demo mode these stand in for verified fetched evidence and are labelled as such.
export const DEMO_EVIDENCE = [
  {
    id: 'ev-brain-1', stance: 'contradicts', keywords: ['10%', 'brain', 'brains'],
    title: 'Do People Only Use 10 Percent of Their Brains?',
    source: 'Scientific American', date: '2008-02-07',
    url: 'https://www.scientificamerican.com/article/do-we-really-use-only-10/',
    passage: 'Brain scans show activity throughout the brain, even in sleep. There is no single dormant 90 percent waiting to be unlocked; nearly every region is active over a day.',
  },
  {
    id: 'ev-brain-2', stance: 'contradicts', keywords: ['10%', 'brain', 'brains'],
    title: 'The Ten Percent Myth',
    source: 'Neuroscience review summary', date: '2019-05-14',
    url: 'https://www.britannica.com/story/do-we-really-use-only-10-percent-of-our-brain',
    passage: 'Damage to almost any area of the brain has detectable effects, and imaging shows no large silent region. The ten-percent claim has no basis in brain mapping.',
  },
  {
    id: 'ev-boil-1', stance: 'supports', keywords: ['boils', 'boiling', 'celsius', 'sea level'],
    title: 'Boiling Point of Water',
    source: 'Reference summary', date: '2021-01-01',
    url: 'https://www.britannica.com/science/boiling-point',
    passage: 'At standard atmospheric pressure at sea level, water boils at 100 degrees Celsius. The boiling point falls as pressure falls with altitude.',
  },
  {
    id: 'ev-moon-1', stance: 'supports', keywords: ['apollo 11 landed', 'landed on the moon'],
    title: 'Apollo 11 Moon Landing',
    source: 'Historical record summary', date: '2019-07-16',
    url: 'https://www.britannica.com/event/Apollo-11',
    passage: 'Apollo 11 landed on the Moon on 20 July 1969, and Neil Armstrong and Buzz Aldrin walked on the surface while Michael Collins remained in orbit.',
  },
  {
    id: 'ev-moon-2', stance: 'contradicts', keywords: ['hoax'],
    title: 'Moon Landing Hoax Claims Reviewed',
    source: 'Fact-check summary', date: '2019-07-19',
    url: 'https://www.britannica.com/event/Apollo-11',
    passage: 'Independent tracking, retroreflectors still in use, and lunar samples contradict hoax claims about the Apollo landings.',
  },
  {
    id: 'ev-pluto-old', stance: 'supports', keywords: ['pluto'],
    title: 'Pluto Listed as the Ninth Planet',
    source: 'Astronomy textbook summary', date: '2004-01-01',
    url: 'https://www.britannica.com/place/Pluto-dwarf-planet',
    passage: 'Before 2006, textbooks listed Pluto as the ninth planet of the solar system, following its discovery in 1930.',
  },
  {
    id: 'ev-pluto-new', stance: 'contradicts', keywords: ['pluto'],
    title: 'IAU Reclassifies Pluto',
    source: 'Astronomy reference summary', date: '2006-08-24',
    url: 'https://www.britannica.com/place/Pluto-dwarf-planet',
    passage: 'In 2006 the International Astronomical Union reclassified Pluto as a dwarf planet, so the statement that Pluto is a planet no longer reflects the current classification.',
  },
  {
    id: 'ev-wall-1', stance: 'misleading', keywords: ['great wall', 'visible from space'],
    title: 'Is the Great Wall Visible from Space?',
    source: 'Science reference summary', date: '2020-03-01',
    url: 'https://www.britannica.com/question/Is-the-Great-Wall-of-China-visible-from-space',
    passage: 'The Great Wall is long but narrow and hard to distinguish. Astronauts report it is not visible to the naked eye from orbit, making the popular claim materially misleading.',
  },
];

function relevantEvidence(claimText, evidence) {
  const idx = new VectorIndex();
  for (const e of evidence || []) idx.add(e.id, `${e.title} ${e.passage}`);
  const byId = new Map((evidence || []).map((e) => [e.id, e]));
  const claimLow = claimText.toLowerCase();
  return idx.search(claimText, 6)
    .map((h) => ({ ...byId.get(h.id), score: h.score }))
    .filter((e) => e.score > CONFIG.RELEVANCE_THRESHOLD && (e.keywords || []).some((k) => claimLow.includes(k.toLowerCase())));
}

export async function verifyClaim(claim, evidence = DEMO_EVIDENCE) {
  const text = claim.text || String(claim || '');
  const type = classifyClaim(text);
  if (type === 'Not fact-checkable') {
    return makeVerdict({ text, type, verdict: 'Not fact-checkable', explanation: 'This reads as opinion or value judgement, so there is no factual claim to test against evidence.' });
  }
  const safeEvidence = (evidence || []).filter((e) => screenContent(e.passage || '').action === 'allow');
  const found = relevantEvidence(text, safeEvidence);
  const supporting = found.filter((e) => e.stance === 'supports');
  const contradicting = found.filter((e) => e.stance === 'contradicts');
  const misleading = found.filter((e) => e.stance === 'misleading');
  const contested = supporting.length > 0 && contradicting.length > 0;
  if (!found.length) {
    return makeVerdict({ text, type, verdict: 'Unverifiable', explanation: 'No verified evidence passage matched this claim. That is different from the claim being false — the honest result is that we could not test it.', limitations: ['No fetched evidence passed relevance and verification checks.'] });
  }
  const cited = [...supporting, ...contradicting, ...misleading].map((e) => e.id);
  const check = validateCitations(cited, safeEvidence);
  if (!check.ok) throw new Error(`Judge cited unknown evidence: ${check.bad.join(',')}`);
  let verdict, explanation, historicalAssessment, currentAssessment;
  const newest = newestEvidenceDate;
  const outdated = contested && newest(contradicting) > newest(supporting);
  if (misleading.length) { verdict = 'Misleading'; explanation = 'The claim creates a materially inaccurate impression, as the passage below shows. It is not a clean true/false case.'; }
  else if (outdated) {
    verdict = 'Outdated';
    historicalAssessment = `Supported by the evidence available at the time (${newest(supporting)}).`;
    currentAssessment = `Contradicted by more recent evidence (${newest(contradicting)}).`;
    explanation = 'This was supportable when written and is not now. The older and newer passages below are the change, with dates.';
  }
  else if (contested) { verdict = 'Partially supported'; explanation = 'Verified evidence pulls both ways. The supporting and contradicting passages below are the disagreement, in the sources’ own terms.'; }
  else if (contradicting.length) { verdict = 'Contradicted'; explanation = 'The verified evidence we could fetch contradicts this claim. Read the contradicting passages directly — the verdict follows them, not the other way round.'; }
  else { verdict = 'Supported'; explanation = 'The verified evidence we could fetch supports this claim, with the qualifications in the passages below.'; }
  const result = makeVerdict({
    text, type, verdict,
    judgedBy: contested || contradicting.length || misleading.length ? 'Muse Wonder' : 'Muse Spark 1.3',
    supporting, contradicting: [...contradicting, ...misleading],
    explanation, historicalAssessment, currentAssessment,
    limitations: ['Verdict rests only on the fetched passages listed here, not on the full literature.'],
  });
  result.forensics = investigateEvidenceChain(text, [...supporting, ...contradicting, ...misleading], { verdict });
  result.uncertainty = assessUncertainty({ cited: [...supporting, ...contradicting, ...misleading], supporting, contradicting: [...contradicting, ...misleading], unclassified: [] });
  return result;
}
