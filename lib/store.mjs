// Facade: the original store surface, now split into a repository
// (lib/repositories.mjs) and a document service (lib/documents.mjs).
export { FileRepository, PostgresRepository, repository, storeBackend } from './repositories.mjs';
export { listDocuments, getDocument, createDocument, recheckDocument, seedDemo, whenAutoVerificationDone, startAutoVerification, verifyDocumentClaim, assessDocumentClaim, bookPassagesFor, challengeDocumentClaim, CHALLENGE_KINDS, setAutoPaused } from './documents.mjs';
