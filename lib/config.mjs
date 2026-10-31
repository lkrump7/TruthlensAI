/**
 * @typedef {'Supported'|'Partially supported'|'Contradicted'|'Misleading'|'Outdated'|'Unverifiable'|'Not fact-checkable'} Verdict
 * @typedef {'supports'|'contradicts'|'misleading'|'unknown'} Stance
 * @typedef {{ id: string, title?: string, source?: string, url?: string, date?: string|null, passage: string, stance?: Stance }} Evidence
 * @typedef {{ text: string, type: string, verdict: Verdict, judgedBy: string, supporting: Evidence[], contradicting: Evidence[], explanation: string, limitations: string[], historicalAssessment?: string, currentAssessment?: string }} VerdictResult
 */

// Named pipeline constants. Tune from the evaluation set, not by feel.
export const CONFIG = {
  VECTOR_DIM: 512,
  RELEVANCE_THRESHOLD: 0.12,
  // Semantic relevance (sidecar embeddings): a passage with no lexical
  // overlap still counts as touching the claim at or above this cosine.
  // Calibrated on all-mpnet-base-v2: 6 relevant pairs scored >= 0.411,
  // 6 irrelevant pairs <= 0.327; 0.37 is the gap midpoint. Small sample;
  // see docs/MATHEMATICS.md.
  SEMANTIC_RELEVANCE_THRESHOLD: 0.37,
  // Semantic chunking: a new chunk starts where adjacent-sentence
  // cosine drops below this (a topic change within one page).
  SEMANTIC_CHUNK_THRESHOLD: 0.3,
  // Book passages are context, not evidence: the bar is lower, because a
  // claim split across a page break leaves each page sharing few terms.
  BOOK_PASSAGE_THRESHOLD: 0.05,
  // TF-IDF cosine scale, measured: duplicate/contradiction pairs score
  // >= 0.877, topically distinct claims <= 0.603 (docs/MATHEMATICS.md).
  DEDUPE_THRESHOLD: 0.8,
  CHUNK_SIZE: 480,
  PASSAGE_WINDOW_CHARS: 420,
  SOURCE_TIER_WEIGHT: 0.04,
  UTILITY_OVERLAP_WEIGHT: 0.1,
  UTILITY_LENGTH_WEIGHT: 0.01,
  KEYWORD_OVERLAP_MIN: 2,
  MAX_POOL_PER_DOMAIN: 3,
  MAX_CLAIMS_PER_DOCUMENT: 20,
  DOCUMENT_CLAIM_CONCURRENCY: 2,
  MAX_CLAIM_CHARS: 2000,
  MAX_DOCUMENT_CHARS: 200000,
  RESEARCH_CACHE_TTL_MS: 600000,
  MAX_CONCURRENT_LIVE_CALLS: 4,
  FETCH_CONCURRENCY: 4,
  BREAKER_THRESHOLD: 3,
  BREAKER_COOLDOWN_MS: 30000,
};
export const VERDICTS = ['Supported', 'Partially supported', 'Contradicted', 'Misleading', 'Outdated', 'Unverifiable', 'Not fact-checkable'];
export const ESCALATION_VERDICTS = ['Contradicted', 'Partially supported', 'Misleading', 'Outdated'];
