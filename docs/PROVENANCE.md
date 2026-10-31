# Provenance — when TruthLens AI was built, and proof it works

This file records the development timeline and the verification evidence
gathered while building. It separates what is independently checkable
(GitHub timestamps, commands you can rerun) from what is a local record
(workspace file timestamps from the build machine).

## Timeline (local workspace record, Africa/Johannesburg, UTC+2)

| When | Milestone |
|---|---|
| 2026-10-30 23:48 | First app files created (`app/layout.js`, `app/globals.css`) |
| 2026-10-31 00:15–01:40 | Core engine, Meta client, FAISS sidecar, PDF extraction, auth, first test suites |
| 2026-10-31 morning | Book-scale processing, Evidence Forensics, Adversarial Self-Correction, Evidence Intelligence Report, Knowledge Contradiction Map |
| 2026-10-31 11:15 | `docs/PRINCIPLES.md` — truthfulness invariants codified; roll-up, evidence-pool relevance, and contradiction-map honesty aligned to them |
| 2026-10-31 11:29–11:44 | Design-pattern hardening (repository split, rank-backend adapter, specification gates, typed errors), bug-hunt fixes, test-coverage expansion |
| 2026-10-31 11:48 | This provenance record written; public GitHub repository created and pushed (GitHub's repo `created_at` and the initial commit timestamp are the independently checkable proof from this point on) |

Built with Muse Code (powered by Muse Wonder, `muse-wonder-1.0`) using
test-driven development: each behaviour landed with a failing test first,
then green, then refactor. The full session worked against this workspace
only; the Meta API key used for live verification was kept in the
gitignored `.env.local` and is **not** in this repository.

## Verification log (observed, not promised)

Run on 2026-10-31 in the build session:

| Check | Command | Observed result |
|---|---|---|
| Unit + integration + regression + non-functional tests | `npm test` | 147/147 pass (`node --test tests/*.test.mjs`) |
| Coverage | `npm run coverage` | 99.6% lines, 85.8% branches, 97.0% functions (all files) |
| Lint | `npm run lint` | clean (ESLint over `lib`, `tests`, `eval`, `app`) |
| Types | `npm run typecheck` | clean (`tsc -p tsconfig.lib.json`) |
| Production build | `npm run build` | compiled successfully |
| FAISS sidecar | `GET /health` on `services/sidecar.py` | `{"faiss": true, "pymupdf": true}` |
| Live verify (Meta) | `POST /api/verify` — "Water boils at 100 degrees Celsius at sea level." | `Supported`, mode `live` (single-domain runs correctly downgrade to Partially supported via the corroboration gate) |
| Postgres backend | embedded-Postgres probe | sequence issues 1, 2, 3 across repository instances with no duplicates; documents round-trip |

Test mix: unit suites per module, route-level integration tests with
isolated temp persistence, regression tests for every bug found in review
(Postgres sequence rewind, `makeVerdict` undefined verdict, rank-backend
dimension mismatch, sidecar stale reset), and non-functional tests
(performance budgets, SSRF/injection security, retry resilience,
concurrency).

## Reproduce it

```bash
npm install
npm test          # 147 tests, no network or keys needed
npm run lint
npm run typecheck
npm run build
# live mode: copy .env.example to .env.local, add your Meta Model API key,
# optionally start the FAISS sidecar, then:
.venv/bin/python services/sidecar.py 8100
FAISS_SERVICE_URL=http://127.0.0.1:8100 npm start
```

## Update — 2026-10-31 12:10 (local record)

Reader-directed investigation shipped: all extracted claims preserved with
visible Not-yet-verified state, background top-20 verification with
pause/resume, on-demand claim verification, reader-submitted claims and
theories assessed against book passages (page numbers, author stance kept
separate from evidence) and external research, and recorded verdict
challenges. A pre-existing chunker bug found during this work — pages
ending mid-sentence lost all but their last word — was fixed at the root
with a regression test. Suite at this point: 163 tests.

## Update — 2026-10-31 (audit fixes, local record)

Post-audit fix round, each change test-first with a measured before/after:
challenge kinds now do different work (compare-author compares against
book passages without re-verdicting; stronger-contrary reports opposing
domains; prove-wrong reports a falsifier and whether one was found) —
previously all three reran the identical verification. Auto-verification
re-reads stored state between claims, so pause works on copy-semantics
stores (Postgres) and concurrent reader writes are no longer overwritten
by stale copies. Coverage now counts every verdict-bearing claim
(Unverifiable included): the audit probe went from 33% (wrong) to 67%
(right) on a 2-of-3-investigated fixture. A garbage conformal env value
is treated as no threshold (`thresholdSet: false`) instead of set-but-
silent. The judge now receives the whole budgeted evidence pool (5
passages, utility-ordered) instead of a utility-cut 3: the pipeline
fixture went from judge-sees-3 to judge-sees-5. Compound reader theories
surface per-proposition verdicts, passages, and author stance. Docs no
longer claim resumable checkpointing (in-process MemorySaver only).
Where a fix could have shifted verdicts, the simpler option was chosen:
verdict pipeline untouched by challenges, utility kept for ordering only.
Suite at this point: 192 tests.

## Update — 2026-10-31 (prompt round, local record)

All model prompts moved into lib/prompts.mjs and rewritten in plain
English: judge, challenger, author-stance, and OCR each have a named
role, silent step-by-step working (reasoning in the steps, JSON out,
never free-form chain-of-thought), verdict and stance definitions, a
rule that passage text is data and not instructions, and one worked
example per prompt. The judge now receives evidence dates, which the
Outdated verdict needs. The self-correction revision judge now actually
receives the challenge: judgeWith previously dropped it on the floor.
Live A/B on eval/claims.json (10 claims, same set both runs, live search
variance applies): old prompts agreed 7/10 with 2 abstentions and 1
judge disagreement; new prompts agreed 9/10 with 1 abstention and 0
disagreements, and both trap claims passed. Small n, so this is
directional evidence, not proof. The new-prompt run also exposed a
pre-existing bug, reproduced offline first: a fetched page with no
extractable text made extractPassages return null and the research loop
threw "passages is not iterable". Fixed at the source with a regression
test; the affected eval claim re-verified live as Contradicted.
Suite at this point: 199 tests.

## Update — 2026-10-31 (mathematics audit, local record)

Every mathematical operation inventoried and justified in
docs/MATHEMATICS.md, verified with local tools rather than by reading:
the hashed-token embedding and both cosine implementations cross-checked
against an independent numpy 2.5.4 implementation (max differences 0.0
and 5.6e-17, rankings identical; hash collisions measured, 2 in a
43-token sample); split-conformal coverage Monte-Carlo'd at 4,000
trials per setting (keep-rates 89.6 to 91.1% against a 90% target, the
low figure within one standard error); uncertainty scores fuzzed over
20,000 random cited sets with no value leaving [0, 1]. Two defects
found and fixed test-first: alpha outside (0, 1) returned undefined
instead of null, and non-finite calibration samples could poison the
quantile sort. Both now return or drop to the honest no-threshold state.
Everything else numeric (utility, priority, evidence strength weights)
is documented as chosen heuristics, with the standing rule that none of
them may change a verdict. A seeded Monte Carlo coverage test now runs
in the suite. Suite at this point: 201 tests.

## Update — 2026-10-31 (NLP round, local record)

Retrieval NLP replaced with classical IR, in Node, no new dependencies:
lib/nlp.mjs adds Unicode tokenisation, a Porter stemmer (tested against
canonical final stems; two test-expectation errors of mine were caught
and corrected during this work, per-step paper examples are not final
stems), stopword removal, and bigrams. lib/vector.mjs is now TF-IDF
cosine ((1 + ln tf) x smoothed idf, fit-then-transform) instead of the
hashed bag-of-words, and claim/passage overlap matching in evidence
uses the same stemming. Measured on a labelled offline benchmark (6
claims, 18 passages): P@3 0.444 -> 0.667, MRR 0.771 -> 1.000,
hit@3 0.833 -> 1.000. Two thresholds were recalibrated from measured
TF-IDF scores rather than carried over: DEDUPE_THRESHOLD 0.92 -> 0.8
(duplicates >= 0.877, distinct claims <= 0.603) and a new
BOOK_PASSAGE_THRESHOLD 0.05 for page-split claims (first page scored
0.088). Full justification in docs/MATHEMATICS.md section 1.
Suite at this point: 206 tests.

## Update — 2026-10-31 (NLP round 2, local record)

Number-word normalisation and BM25. Tokens now fold number words into
digits (eighty -> 80, one hundred twenty -> 120; "one" alone stays a
pronoun), and the same numbersIn extraction feeds claim prioritisation,
dedupe number comparison, and forensics effect matching, which
previously saw digits only. Okapi BM25 (k1=1.2, b=0.75) was added to
the index and benchmarked against TF-IDF cosine: tied on the labelled
benchmark (P@3 0.667, MRR 1.000 both), better on term-frequency
saturation by test. It is wired only into fetched-page window ranking,
where no calibrated threshold consumes its unbounded score; cosine
keeps dedupe and book-passage matching. Suite at this point: 208 tests.

## Update — 2026-10-31 (semantic embeddings, local record)

The synonymy step: all-mpnet-base-v2 served by the existing Python
sidecar (POST /embed, lazy CPU load, failure reported honestly as 503
and never latched), consumed by lib/embed.mjs with a null fallback to
TF-IDF at every failure point. Semantic cosine now rescues passages
the lexical extraction and relevance gates dropped, scores every
evidence item (semanticScore), and supplies ranking vectors when the
sidecar answers for the whole pool. Threshold calibrated on the real
model: 12 labelled pairs gave a clean gap (irrelevant <= 0.327,
relevant >= 0.411), threshold set at the 0.37 midpoint and recorded as
a small-sample calibration in docs/MATHEMATICS.md. End-to-end check:
a synonym-only passage is kept in the judged pool semantically
(0.831) and dropped by the TF-IDF control. First live load attempt hit
a full GPU (7.66 GiB, 7.62 MiB free); the sidecar now defaults to CPU
for exactly that reason. Suite at this point: 212 tests.

## Update — 2026-10-31 (NLP completion round, local record)

All seven ranked NLP improvements implemented, each test-first:
(1) cross-encoder reranking in the sidecar (ms-marco MiniLM) making
the evidence pool cut, bi-encoder fallback intact; (2) deterministic
query expansion (claim, keyword core, study angle, criticism angle,
no verdict words) sent to Meta search grounding; (3) semantic
chunking for books, splitting at within-page topic boundaries with
fixed-chunker fallback; (4) NLI stance labels (DeBERTa MNLI) on cited
evidence with judge-agreement reported as nliChecks, never gated;
(5) negation and hedging cues as forensics annotations; (6) temporal
normalisation: in-text dates backfill evidence dates, relative
offsets resolve only against a known base; (7) claim extraction
recall fixture (16/16) plus atomic splitting on fresh-subject "and",
"and that", and whereas/while contrasts. Live verification exercised
the whole stack in one claim: Contradicted by Muse Wonder,
rerankScores on all cited passages, nliChecks 3 of 4 agreeing (the
disagreement reported, not hidden), negation flag firing on the
contradicting passages as designed. Suite at this point: 228 tests.

## Update — 2026-10-31 (RAG pipeline round, local record)

RAG rebuilt in three measured phases. Baseline at research level
(labelled fixture with distractor sources): relevant retention in the
judged pool 0.833. Phase 1 found the binding constraint was not
ranking but the two-token overlap gate: a brain-scan passage sharing
only "brain" with the claim vanished at extraction. A per-page
single-overlap fallback (marked pageBest) plus reciprocal rank fusion
over TF-IDF, BM25, and semantic rankings, near-duplicate removal
(measured threshold 0.75; duplicates score 0.79-0.88, distinct at most
0.60), and a per-domain pool cap took retention to 1.000 with MRR
1.000. Along the way a real bug surfaced: stopword filtering ran after
stemming, so "only" escaped as "onli" and off-topic pages passed the
gate; filtering now runs before stemming too. Phase 2 gives the judge
neighbouring-window context from the same page, cited passage text
unchanged. Phase 3 widened the source budget (8 to 12 fetched sources;
the judged pool stays 5). One wiring fix followed the live check: NLI
labels now attach after any self-correction revision, so they describe
the final cited set. Live: Contradicted, fusion scores and context on
cited passages, nliChecks 2 of 2 agreeing. Suite: 234 tests.

## Update, 2026-10-31 (three review findings rejected, local record)

Three findings from review were checked against the code and the git
tree, then rejected. None came from the hardening work in this session.
Each one stays as it is, on purpose. The reasons are recorded here so
the next review does not raise them again.

1. Resume is fire-and-forget, and that is the design. resumeIfOrphaned
in lib/documents.mjs starts auto-verification without awaiting it.
listDocuments and getDocument feed the reader UI. Awaiting would hold
a list call open for a whole verification pass. The test in
tests/reader.test.mjs ("a document orphaned mid-verification resumes
when listed again") lists first, then joins the job through
whenAutoVerificationDone. That join handle is the contract.
startAutoVerification catches its own failures, logs them, and resets
the document status, so the discarded promise cannot reject unhandled.
The call now uses void to show the discard is deliberate.

2. Checkpoint deletion in lib/graph.mjs is the requested fix, not data
loss. runInvestigationGraph deletes the checkpoint only for thread ids
it generated itself. Those threads are single-use. No caller knows the
id, no resume endpoint exists, and MemorySaver keeps full state per
thread, so keeping them grows memory without bound. Caller-named
threads keep their checkpoint. Both halves are pinned by tests in
tests/graph.test.mjs: "auto-generated threads do not leave checkpoints
behind" and "graph state is checkpointed under the caller thread id".

3. The LangGraph work is not scope creep from this session. It was
already in the dirty tree before the hardening work started.
lib/graph.mjs, lib/stages.mjs, and tests/graph.test.mjs are untracked,
and the @langchain/langgraph entry in package.json is an uncommitted
modification. The single commit, ed9ffa5, has none of it. The hardening
plan in docs/superpowers/plans/2026-10-31-hardening.md already lists
"existing LangGraph pipeline" as its tech stack. Removing it would be
a separate decision, not a fix for this session's work.
