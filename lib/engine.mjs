// Barrel: the original engine surface, now implemented by focused modules.
export { screenContent } from './screen.mjs';
export { chunkDocument } from './chunk.mjs';
export { tokenize, cosine, VectorIndex } from './vector.mjs';
export { splitAtomicClaims, classifyClaim, topicKeyFor, extractClaimsFromText, extractClaimsFromPages, splitSentences, scoreClaimPriority, prioritizeClaims } from './claims.mjs';
export { makeVerdict, validateCitations, applyGates, GATES } from './verdict.mjs';
export { DEMO_EVIDENCE, verifyClaim } from './demo.mjs';
