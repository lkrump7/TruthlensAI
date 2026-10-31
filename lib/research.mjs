// Barrel: the original research surface, now implemented by focused modules.
export { responsesUrl, parseSearchResponse, metaSearch } from './search.mjs';
export { BUDGET, assertPublicUrl, fetchPageText } from './fetch.mjs';
export { extractPassage, extractPassages, extractPublishedDate, sourceTier, researchClaim, clearResearchCache, passageTouchesClaim, utilityScore, rankJudgeEvidence } from './evidence.mjs';
export { verifyResearchedClaim } from './pipeline.mjs';
