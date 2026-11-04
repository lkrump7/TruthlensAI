// Barrel: the original engine surface, now implemented by focused modules.
export { screenContent } from './screen.mjs';
export { guardVerdicts, screenTextsWithGuard } from './guard.mjs';
export { chunkDocument, chunkDocumentSemantic } from './chunk.mjs';
export { tokenize, cosine, VectorIndex } from './vector.mjs';
export { splitAtomicClaims, dedupeAtomics, atomicKeyFor, classifyClaim, cleanMediaClaim, isMediaDescription, isCheckableClaimText, topicKeyFor, extractClaimsFromText, extractClaimsFromPages, splitSentences, scoreClaimPriority, prioritizeClaims, refineWebsiteClaims, CLAIM_FILTER_BATCH } from './claims.mjs';
export { makeVerdict, validateCitations, applyGates, GATES } from './verdict.mjs';
export { DEMO_EVIDENCE, verifyClaim, verifyClaim as verifyDemoClaim } from './demo.mjs';
