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
  DEDUPE_THRESHOLD: 0.92,
  CHUNK_SIZE: 480,
  PASSAGE_WINDOW_CHARS: 420,
  SOURCE_TIER_WEIGHT: 0.04,
  KEYWORD_OVERLAP_MIN: 2,
  MAX_CLAIMS_PER_DOCUMENT: 20,
  DOCUMENT_CLAIM_CONCURRENCY: 2,
  MAX_CLAIM_CHARS: 2000,
  MAX_DOCUMENT_CHARS: 200000,
  RESEARCH_CACHE_TTL_MS: 600000,
};
export const VERDICTS = ['Supported', 'Partially supported', 'Contradicted', 'Misleading', 'Outdated', 'Unverifiable', 'Not fact-checkable'];
export const ESCALATION_VERDICTS = ['Contradicted', 'Partially supported', 'Misleading', 'Outdated'];
