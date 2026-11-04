# Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the open findings from the 2026-10-31 review of `ed9ffa5...HEAD`, in risk order, without removing shipped features and without weakening any truthfulness gate.

**Architecture:** Six phases follow the six sections of the issue tracker. Trust boundaries first, then verdict meaning, then concurrency, then input contracts, then what the screen and the report show, then upkeep. Each task is one TL issue, one failing test first, one small fix, one commit. Decided and owner-call issues get no code task. They stay in the tracker with their reasons.

**Tech Stack:** Node 22 ESM, `node --test`, Next 14, TypeScript `checkJs` gate, ESLint flat config.

**Spec:** `docs/agents/issue-tracker.md` sections 1 to 6, against `docs/PRINCIPLES.md` and the design docs under `docs/superpowers/specs/`.

## Global Constraints

- No verdict without fetched, relevance-checked evidence. See principles 1, 2, and 4 in `docs/PRINCIPLES.md`.
- Test first for every code change. Run the new test, watch it fail for the right reason, then write the fix. One behavior per cycle.
- All 328 current tests keep passing. `npm run typecheck`, `npm run lint`, and `npm run build` stay green after every phase.
- No new runtime dependencies.
- Do not touch TL-D01, TL-D02, or TL-D03. They are decided on record in the tracker and in `docs/PROVENANCE.md`.
- Do not touch TL-N01 or TL-N02. They wait for an owner call. No task below removes website ingestion, the LangGraph workflow, or any verdict-adjacent machinery.
- With `AUTH_ENABLED` off, behavior stays as it is now. Owner checks apply only when accounts are on.
- Work on the `review-fixes` branch in the worktree. One commit per task, and the commit message names the TL ID.

## Review Focus

- A URL host written as `[::ffff:127.0.0.1]` or `[::]`. Expect a block, same as `127.0.0.1`. A normal domain that starts with `fc` must still load.
- A posted export record that names a document and claim the server never stored. Expect a refusal, not a report.
- Two readers acting on one excerpt at the same time. Expect both writes to survive, and the auto-verify count to stay at 20 even when claim text repeats.
- An image the model reads as blank, and a video file ffmpeg cannot parse. Expect 422 for the blank read and a clear failure for the broken file. A silent video must still become a document.
- A compound claim with one checked part and one opinion part. Expect `Partially supported` or `Unverifiable`, never a clean decisive verdict.

Each line above has its test in the task that owns the code.

---

## Phase 1. Trust boundaries

Closes TL-001, TL-002, TL-003. Nothing else ships until these land.
A forgeable report and an open fetcher make every later verdict fix
worth less.

### Task 1: Block mapped and unspecified IPv6 hosts (TL-001)

**Files:**
- Modify: `lib/fetch.mjs:5-15` (`isPrivateHost`)
- Test: `tests/reader.test.mjs` or a new `tests/fetch.test.mjs` beside the existing fetcher tests. Put it where the current `assertPublicUrl` tests live.

**Interfaces:**
- Consumes: `assertPublicUrl(url)` in `lib/fetch.mjs`, unchanged signature.
- Produces: same function. It now blocks `::ffff:` mapped IPv4 hosts whose tail is private, blocks `::`, and no longer treats a plain domain starting with `fc` or `fd` as an IPv6 literal.

- [ ] **Step 1: Write the failing tests.** Assert `assertPublicUrl` throws for `http://[::ffff:127.0.0.1]/`, `http://[::ffff:10.0.0.5]/`, and `http://[::]/`. Assert it returns the URL for `https://fcexample.com/` and for a public mapped host such as `http://[::ffff:8.8.8.8]/`. Assert the existing private cases still throw.
- [ ] **Step 2: Run the new tests.** Run `node --test tests/fetch.test.mjs` (or the file from Step 1). Expect the mapped and `[::]` cases to fail because they are allowed today.
- [ ] **Step 3: Implement.** In `isPrivateHost`, handle IPv6 form only when the host contains a colon. For a `::ffff:` prefix, parse the dotted tail with the existing IPv4 rules. Block `::` outright. Run the `fe80:`, `fc`, and `fd` prefix checks only for colon hosts.
- [ ] **Step 4: Run tests.** Run the fetcher tests, then `npm test`. Expect all green.
- [ ] **Step 5: Commit.** `git commit -m "fix: block mapped IPv6 private hosts in fetcher (TL-001)"`. Then update TL-001 in `docs/agents/issue-tracker.md` to closed with this commit.

### Task 2: Export only stored verdicts (TL-002)

**Files:**
- Modify: `app/api/export/route.js`
- Modify: `app/page.js` (the export call near line 114 sends IDs, not the record)
- Test: `tests/export.test.mjs`

**Interfaces:**
- Consumes: `getDocument(id)` in `lib/documents.mjs`, `buildInvestigationReport(record)` in `lib/export.mjs`. Both keep their signatures.
- Produces: `POST /api/export` accepts `{ docId, claimId }`. It loads the document, finds the stored claim, and renders that claim. Unknown document gives 404. Unknown claim gives 404. A claim with no verdict yet gives 422. A body with a bare `record` and no IDs gives 400.

- [ ] **Step 1: Write the failing tests.** Seed a document with a verified claim through the existing test helpers. Assert export with its IDs returns 200 and the claim text. Assert a forged record body returns 400. Assert unknown IDs return 404. Assert an unverified claim returns 422.
- [ ] **Step 2: Run the new tests.** Expect the forged-record test to fail because the route renders it today.
- [ ] **Step 3: Implement.** Replace the `record` read in the route with `docId` and `claimId`. Load with `getDocument`, find the claim, render the stored claim object. Update the page to send the IDs it already holds.
- [ ] **Step 4: Run tests.** Run `node --test tests/export.test.mjs tests/ui.test.mjs`, then `npm test` and `npm run build`. Expect all green.
- [ ] **Step 5: Commit.** `git commit -m "fix: export stored verdicts only (TL-002)"`. Update TL-002 in the tracker.

### Task 3: Owner-check the document event stream (TL-003)

**Files:**
- Modify: `app/api/documents/[id]/events/route.js`
- Test: `tests/auth.test.mjs` plus a route test in `tests/reader.test.mjs`

**Interfaces:**
- Consumes: `requestUser(req)` in `lib/auth.mjs:80`, `getDocument(id)` in `lib/documents.mjs`, and the visible-owner rule already used by `listDocuments(owner)`. A document is visible when its owner matches the caller or is `demo`.
- Produces: the same SSE stream. With accounts on, a caller who cannot see the document gets 404, same as a missing document, and no stream opens. With accounts off, the stream works as it does today.

- [ ] **Step 1: Write the failing tests.** With `AUTH_ENABLED=true` and a session for user A, assert the events route for a document owned by user B returns 404. Assert user A still gets 200 for their own document and for a `demo` document. Assert accounts-off requests still get 200.
- [ ] **Step 2: Run the new tests.** Expect the user B case to fail because the route streams it today.
- [ ] **Step 3: Implement.** After loading the document, apply the `listDocuments` visibility rule with `requestUser(req)?.username`. Return the existing 404 shape when the rule fails. Do not add a new error shape.
- [ ] **Step 4: Run tests.** Run the auth and reader tests, then `npm test`. Expect all green.
- [ ] **Step 5: Commit.** `git commit -m "fix: owner-check document event stream (TL-003)"`. Update TL-003 in the tracker. Note in the commit body that the other `[id]` routes still need the same check as follow-up work, tracked as a new issue if the owner wants it.

**Phase 1 gate:** `npm test`, `npm run typecheck`, `npm run lint`, `npm run build` all green. Hand-check the mapped-IPv6 block and the forged-export refusal by hand against a running dev server.

---

## Phase 2. Verdict invariants

Closes TL-004, TL-005, TL-006. These change verdicts, so each task runs
the full suite plus the verdict, research, and fusion tests by name.

### Task 4: Keep compound roll-up honest over opinion elements (TL-004)

**Files:**
- Modify: `lib/pipeline.mjs:14-22` (`rollupCompound`)
- Test: `tests/fusion.test.mjs`

**Interfaces:**
- Consumes: subclaim verdict objects `{ verdict, judgedBy, supporting, contradicting, unclassified }`, unchanged.
- Produces: same roll-up result shape. The rule changes. Any `Not fact-checkable` element caps the roll-up at `Partially supported` when a decisive element exists, and gives `Unverifiable` when none does. `Unverifiable` keeps its current cap.

- [ ] **Step 1: Write the failing tests.** Assert `[Supported, Not fact-checkable]` rolls up to `Partially supported`. Assert `[Not fact-checkable]` alone rolls up to `Unverifiable`. Assert `[Supported, Supported]` still gives `Supported` and `[Supported, Contradicted]` still gives `Partially supported`.
- [ ] **Step 2: Run the new tests.** Expect the first two to fail.
- [ ] **Step 3: Implement.** Stop filtering `Not fact-checkable` out of the roll-up math. Treat it like `Unverifiable` for the cap, and keep the two apart in the explanation count.
- [ ] **Step 4: Run tests.** Run `node --test tests/fusion.test.mjs tests/verdict.test.mjs tests/research.test.mjs`, then `npm test`. Expect all green, and expect some existing roll-up fixtures to need a second look before changing any of them. A fixture that expected a decisive roll-up over an opinion element was pinning the bug.
- [ ] **Step 5: Commit.** `git commit -m "fix: cap compound roll-up over opinion elements (TL-004)"`. Update TL-004 in the tracker.

### Task 5: Hold `pageBest` passages to the relevance floor (TL-005)

**Files:**
- Modify: `lib/evidence.mjs:151-175`
- Modify: `lib/stages.mjs:33`
- Test: `tests/research.test.mjs`

**Interfaces:**
- Consumes: `extractPassages(htmlOrText, claim, count, isHtml, { minOverlap })` and `passageTouchesClaim(passage, claim)` in `lib/evidence.mjs`, unchanged signatures.
- Produces: no passage reaches `researchStage` output on a one-word overlap alone. The `pageBest` mark may stay for ranking, but it no longer skips the relevance check in `stages.mjs`.

- [ ] **Step 1: Write the failing tests.** Build a page whose best window shares exactly one content word with the claim. Assert `researchStage` output holds no passage from that page. Assert a page with a two-word overlap still contributes its passage.
- [ ] **Step 2: Run the new tests.** Expect the one-word case to fail because the passage is kept today.
- [ ] **Step 3: Implement.** Remove the `minOverlap: 1` fallback, or raise it to `CONFIG.KEYWORD_OVERLAP_MIN`. Drop the `e.pageBest` exemption in the `stages.mjs` filter. Keep the semantic-score path as it is.
- [ ] **Step 4: Run tests.** Run the research and evidence tests, then `npm test`. Watch the eval-adjacent fixtures. More abstentions are the expected cost, per the trade-offs in `docs/PRINCIPLES.md`.
- [ ] **Step 5: Commit.** `git commit -m "fix: hold fallback passages to relevance floor (TL-005)"`. Update TL-005 in the tracker.

### Task 6: Fix the stability gate and stop paying for unused runs (TL-006)

**Files:**
- Modify: `lib/verdict.mjs:62` (`applyStabilityGate`)
- Modify: `lib/stages.mjs:55-70` (`judgeStage`) and `lib/stages.mjs:108-130` (`challengeStage` revision)
- Test: `tests/stability.test.mjs` and `tests/verdict.test.mjs`

**Interfaces:**
- Consumes: `summariseStability(verdicts)` in `lib/stability.mjs`, `CONFIG.STABILITY_RUNS` (now 3), and the judge call shape `{ claim, evidence, model, challenge? }`. All unchanged.
- Produces: repeat judging runs only when the first verdict is one the stability gate can downgrade. The gate downgrades a split decisive verdict to `Partially supported` when cited evidence exists on both sides, and to `Unverifiable` when the split leaves no cited evidence standing. Revision repeats get the same `challenge` argument as the revision itself.

- [ ] **Step 1: Write the failing tests.** Assert a judge spy is called once for an `Unverifiable` first verdict. Assert a split over `Supported` with no cited evidence gives `Unverifiable`. Assert a split with cited evidence gives `Partially supported`. Assert revision repeats receive the `challenge` object.
- [ ] **Step 2: Run the new tests.** Expect all four to fail on current code.
- [ ] **Step 3: Implement.** Gate the repeat loop in `judgeStage` on the downgrade-able verdict set. Pass `challenge` in the revision repeat call. Extend `applyStabilityGate` with the no-evidence branch. Keep `STABILITY_RUNS` at 3.
- [ ] **Step 4: Run tests.** Run the stability and verdict tests, then `npm test`. Expect all green.
- [ ] **Step 5: Commit.** `git commit -m "fix: stability gate target and repeat-run cost (TL-006)"`. Update TL-006 in the tracker.

**Phase 2 gate:** full suite, typecheck, lint, build green. Run `npm run eval` if a Meta key is set and record the number in the tracker. The eval number may move toward more abstentions. That is accepted. A move toward more decisive verdicts needs a second look before the phase closes.

---

## Phase 3. Concurrency and limits

Closes TL-007, TL-008. Both tasks touch `lib/documents.mjs`, so run
them in order and never in parallel.

### Task 7: Lock the verdict write (TL-007)

**Files:**
- Modify: `lib/documents.mjs:43-49` (`runDocLocked`) and `lib/documents.mjs:80-95` (`applyVerdict`)
- Test: `tests/reader.test.mjs`

**Interfaces:**
- Consumes: `runDocLocked(id, fn)` in `lib/documents.mjs`, unchanged signature. `repository().save(doc)` and `getDocument(id)`, unchanged.
- Produces: `applyVerdict(doc, claim, verdictResult)` with the whole load-change-save body inside `runDocLocked`. Return shape unchanged. The comment above it now tells the truth.

- [ ] **Step 1: Write the failing test.** Start a verdict apply with a slow fake verify step. Save a follow-up to the same document during that window through the public follow-up path. Assert both the verdict and the follow-up are present at the end.
- [ ] **Step 2: Run the new test.** Expect the follow-up to be missing.
- [ ] **Step 3: Implement.** Move the fresh load, the claim assign, the report rebuild, and `saveDoc` inside one `runDocLocked(doc.id, ...)` call. Keep the existing locked idempotency writes as they are. They join the same chain.
- [ ] **Step 4: Run tests.** Run the reader and store tests, then `npm test`. Run the reader tests three times in a row. A race fix that passes once proves little.
- [ ] **Step 5: Commit.** `git commit -m "fix: lock verdict writes per document (TL-007)"`. Update TL-007 in the tracker.

### Task 8: Select auto-verify claims by ID, not text (TL-008)

**Files:**
- Modify: `lib/documents.mjs` in `createDocument`, near line 144
- Test: `tests/reader.test.mjs`

**Interfaces:**
- Consumes: `prioritizeClaims(found, CONFIG.MAX_CLAIMS_PER_DOCUMENT)` in `lib/engine.mjs`, unchanged. It returns claim objects from the same `found` array `createDocument` maps over.
- Produces: selection tracked by object identity or by index in `found`, not by text. At most `CONFIG.MAX_CLAIMS_PER_DOCUMENT` claims get `autoSelected: true`, even when claim text repeats.

- [ ] **Step 1: Write the failing test.** Create a document whose extracted claims hold the same text three times, with a cap that admits one of them. Assert exactly one gets `autoSelected` and `deferredClaims` counts the rest.
- [ ] **Step 2: Run the new test.** Expect all three to be selected today.
- [ ] **Step 3: Implement.** Build the selected set from the returned objects themselves. Match by reference when mapping `found` to stored claims, and fall back to index if the prioritizer returns copies. Check what `prioritizeClaims` returns before picking one.
- [ ] **Step 4: Run tests.** Run the reader tests, then `npm test`. Expect all green.
- [ ] **Step 5: Commit.** `git commit -m "fix: cap auto-verification by claim identity (TL-008)"`. Update TL-008 in the tracker.

**Phase 3 gate:** full suite green, reader tests run three times, typecheck and lint green.

---

## Phase 4. Media input contracts

Closes TL-009, TL-010. Status codes and the stored `media` shape are
the contract. Pin both.

### Task 9: Return 422 for a blank caption and 400 before the model (TL-009)

**Files:**
- Modify: `lib/caption.mjs:42` (`captionImage`)
- Modify: `app/api/documents/image/route.js`
- Test: `tests/caption.test.mjs` and `tests/media-documents.test.mjs`

**Interfaces:**
- Consumes: `captionImage(bytes, { mime, visionImpl, client })`, unchanged signature. `mimeForImageFile(name)` and `MAX_IMAGE_BYTES`, unchanged.
- Produces: a typed blank-caption error from `lib/caption.mjs`. Export it as `BlankCaptionError` from that file. The route maps it to 422, keeps model failures at 502, and rejects a mime outside the supported set at 400 before any model call. Extension wins over `file.type` when both exist.

- [ ] **Step 1: Write the failing tests.** Assert the route returns 422 when the vision stub returns an empty string. Assert it returns 400 for an SVG upload and that the vision stub was never called. Assert a vision throw still returns 502.
- [ ] **Step 2: Run the new tests.** Expect 502 where 422 and 400 belong.
- [ ] **Step 3: Implement.** Throw `BlankCaptionError` for the blank case in `captionImage`. In the route, check the resolved mime against the supported set before the live check, and catch `BlankCaptionError` apart from other errors.
- [ ] **Step 4: Run tests.** Run the caption and media tests, then `npm test` and `npm run build`. Expect all green.
- [ ] **Step 5: Commit.** `git commit -m "fix: image caption status codes (TL-009)"`. Update TL-009 in the tracker.

### Task 10: Store video duration and surface ffmpeg failure (TL-010)

**Files:**
- Modify: `lib/video.mjs` near line 90 (`ffmpegAudioChunk`) and the result of `processVideo`
- Modify: `app/api/documents/video/route.js:31`
- Test: `tests/video.test.mjs`

**Interfaces:**
- Consumes: the injected deps of `processVideo(buffer, deps)`, unchanged shape. `ffprobeDuration` already returns seconds or throws.
- Produces: `processVideo` result gains `durationSec`. The route stores `media: { durationSec, transcript, model, voiceModel }`. A failed audio chunk still gives a silent-video result only when the probe shows no audio stream. An ffmpeg run failure on a file with audio throws, and the route keeps its existing error shape.

- [ ] **Step 1: Write the failing tests.** Assert a processed video result holds `durationSec` from the probe stub. Assert the stored document `media.durationSec` matches. Assert an audio-chunk failure with audio present surfaces an error, and a no-audio video still produces pages from frames.
- [ ] **Step 2: Run the new tests.** Expect the duration asserts to fail first.
- [ ] **Step 3: Implement.** Return `durationSec` beside the pages. Split the audio-chunk catch. No audio stream keeps the current null path. A run error throws `MetaApiError` with the ffmpeg message in it. Pass `durationSec` into the route `media` object.
- [ ] **Step 4: Run tests.** Run `node --test tests/video.test.mjs`, then `npm test`. Expect all green.
- [ ] **Step 5: Commit.** `git commit -m "fix: store video duration and surface ffmpeg failures (TL-010)"`. Update TL-010 in the tracker.

**Phase 4 gate:** full suite and build green. Hand-check one silent video and one broken file if ffmpeg is on the machine, and record what happened in the tracker.

---

## Phase 5. Stream and export contracts

Closes TL-011, TL-012, TL-013, TL-014. TL-011 is a spec fix first and a
code test second. Do it before TL-012, since the wording decides what
the events should carry.

### Task 11: Settle the demo stream wording (TL-011)

**Files:**
- Modify: `docs/superpowers/plans/2026-10-31-hackathon-win.md` (the demo stream line)
- Test: `tests/stream.test.mjs`

**Interfaces:**
- Consumes: `POST /api/verify/stream` in `app/api/verify/stream/route.js`, unchanged.
- Produces: one rule in both spec files. Demo mode emits no stage events, because the demo engine runs no stages. The test pins that. The plan line changes to match the design line, which already says a stage that has not run is never shown as run.

- [ ] **Step 1: Write the failing test.** Assert a demo-mode stream sends one verdict event and zero progress events. It may already pass. A passing test here is the pin, not a TDD break. Say so in the commit.
- [ ] **Step 2: Run it.** Run `node --test tests/stream.test.mjs`. Record the result honestly.
- [ ] **Step 3: Edit the plan wording.** Change the demo stream line in the hackathon-win plan to match the design. Touch no code.
- [ ] **Step 4: Run tests.** Run `npm test`. Expect all green.
- [ ] **Step 5: Commit.** `git commit -m "docs: settle demo stream stage wording (TL-011)"`. Update TL-011 in the tracker.

### Task 12: Carry model and counts on every progress event (TL-012)

**Files:**
- Modify: `lib/graph.mjs:29-50` (the `emitProgress` calls)
- Modify: `app/page.js` near line 364 (stage rendering)
- Test: `tests/stream.test.mjs` and `tests/graph.test.mjs`

**Interfaces:**
- Consumes: `emitProgress(config, stage, detail)` in `lib/graph.mjs`, unchanged signature. `getModels()` in `lib/meta.mjs` gives `{ spark, wonder }`.
- Produces: every progress detail holds `model` and, where the stage produces a count, `counts`. Use these keys. `triage` sends the spark model name. `research` sends the spark model name plus its current stats. `judge` keeps `judgedBy` and adds `model`. `gates` and `assemble` send the deciding model name. `challenge` sends the spark model name. The page shows the model on every stage row that has one.

- [ ] **Step 1: Write the failing tests.** Drive the graph with stub deps and a progress collector. Assert each stage event holds a `model` string. Assert the research event holds its counts.
- [ ] **Step 2: Run the new tests.** Expect the non-judge stages to fail.
- [ ] **Step 3: Implement.** Add the fields at each `emitProgress` call from the models the stage already uses. Render `detail.model` in the page stage row. Add no new model calls.
- [ ] **Step 4: Run tests.** Run the stream, graph, and UI tests, then `npm test` and `npm run build`. Expect all green.
- [ ] **Step 5: Commit.** `git commit -m "fix: carry model and counts on progress events (TL-012)"`. Update TL-012 in the tracker.

### Task 13: Complete the export record (TL-013)

**Files:**
- Modify: `lib/export.mjs:20-32` (`buildInvestigationReport`)
- Test: `tests/export.test.mjs`

**Interfaces:**
- Consumes: the stored claim record the route now loads after Task 2. Fields already on the record include `verdict`, `judgedBy`, `judges`, `stability`, `history`, `trajectory`, and `promptVersion` when set.
- Produces: the report prints a `Run:` date line from the last `history` entry, a `Models:` line that names every model in `judges` plus `judgedBy`, the `Exported:` line kept apart from the run date, and the run count and agreement it already prints from `stability`. Missing history gives `Run: not recorded`. It invents nothing.

- [ ] **Step 1: Write the failing tests.** Build a record with two history entries and a `judges` pair. Assert the report names both models, shows the later history date as the run date, and shows the export date on its own line.
- [ ] **Step 2: Run the new tests.** Expect the model list and run date asserts to fail.
- [ ] **Step 3: Implement.** Read the dates and models from the record fields above. Fall back to `not recorded`. Change no other report section.
- [ ] **Step 4: Run tests.** Run `node --test tests/export.test.mjs`, then `npm test`. Expect all green.
- [ ] **Step 5: Commit.** `git commit -m "fix: record run date and models in export (TL-013)"`. Update TL-013 in the tracker.

### Task 14: Pin the demo arc in live mode as a manual gate (TL-014)

**Files:**
- Create: `eval/live-arc.mjs`
- Modify: `README.md` (release checklist line, next to the eval line)
- Test: `tests/demo-arc.test.mjs` stays demo-only and unchanged

**Interfaces:**
- Consumes: `verifyResearchedClaim(text)` in `lib/research.mjs` and the three demo claims already pinned in `tests/demo-arc.test.mjs`. Read the claim strings from that test. Do not copy new ones.
- Produces: `node eval/live-arc.mjs` exits 1 with a plain message when no Meta key is set. With a key, it runs the three claims live and exits 0 only when each verdict lands in the acceptable set the demo test uses.

- [ ] **Step 1: Write the check.** The script prints each claim, its live verdict, and pass or fail. No new test file, since this gate needs a key and stays out of `npm test`.
- [ ] **Step 2: Run it without a key.** Expect exit 1 and the plain message. That is the red state for this task.
- [ ] **Step 3: Run it with a key if one is at hand.** Expect exit 0. If no key is at hand, record that in the tracker and leave the live run to the release checklist. Do not fake it.
- [ ] **Step 4: Add the README line.** One line in the release checks. Run `npm test` to prove the suite is untouched.
- [ ] **Step 5: Commit.** `git commit -m "feat: live demo-arc release gate (TL-014)"`. Update TL-014 in the tracker, with the live result or the missing-key note.

**Phase 5 gate:** full suite, typecheck, lint, build green. Open one exported report and check the run date and model list by eye.

---

## Phase 6. Cost and upkeep

Closes TL-015 to TL-018. Small, separate commits. Any task here can be
dropped without touching the phases above.

### Task 15: Delete the dead judge budget (TL-015)

**Files:**
- Modify: `lib/fetch.mjs:3` (`BUDGET`)
- Test: `tests/utility.test.mjs`

**Interfaces:**
- Consumes: `BUDGET` importers. Search for `maxJudgeCalls` and `BUDGET` across `lib/`, `app/`, and `tests/` first.
- Produces: `BUDGET` without `maxJudgeCalls`, or a wired cap if the search finds a real reader. Deletion is the expected outcome. Judge cost stays governed by `CONFIG.STABILITY_RUNS` and the gate in Task 6.

- [ ] **Step 1: Search.** Run a repo search for `maxJudgeCalls`. Expect the definition only.
- [ ] **Step 2: Write the failing test.** Assert `BUDGET.maxJudgeCalls` is undefined. Trivial, and it pins the deletion.
- [ ] **Step 3: Implement.** Remove the field.
- [ ] **Step 4: Run tests.** Run `npm test`, typecheck, and lint. Expect all green.
- [ ] **Step 5: Commit.** `git commit -m "chore: remove dead judge-call budget (TL-015)"`. Update TL-015 in the tracker.

### Task 16: Extract the two duplicated shapes (TL-016)

**Files:**
- Modify: `lib/documents.mjs` (idempotency tails near lines 191 and 316)
- Modify: `lib/stages.mjs` (stability loops near lines 64 and 124)
- Test: existing `tests/reader.test.mjs` and `tests/stability.test.mjs` coverage, no new file

**Interfaces:**
- Produces: `saveIdempotencyKey(docId, key, claimId)` in `lib/documents.mjs`, module-private, wrapping the locked fresh-load and save. Produces `repeatJudgeVerdicts(judge, args, runsWanted)` in `lib/stages.mjs`, module-private, returning the verdict list starting with the first verdict. Both call sites use the helper. No exported signature changes.

- [ ] **Step 1: Run the owning tests.** Expect green. This task changes no behavior, so green before and after is the test.
- [ ] **Step 2: Extract the documents helper.** Move one tail onto the helper, run the reader tests, then move the second tail and run them again.
- [ ] **Step 3: Extract the stages helper.** Same order. One call site at a time, tests between.
- [ ] **Step 4: Run tests.** Run `npm test` and typecheck. Expect all green.
- [ ] **Step 5: Commit.** One commit per file. `git commit -m "refactor: share idempotency write in documents (TL-016)"`, then `git commit -m "refactor: share stability repeat loop in stages (TL-016)"`. Update TL-016 in the tracker.

### Task 17: One shared verdict list (TL-017)

**Files:**
- Modify: `lib/verdict.mjs` (`GATES` and the verdict value lists)
- Modify: `lib/stages.mjs` (the list near line 109) and any other file the search names
- Test: `tests/verdict.test.mjs`

**Interfaces:**
- Consumes: a repo search for each verdict string, done as Step 1.
- Produces: exported consts from `lib/verdict.mjs`. Name them `DECISIVE_VERDICTS` for `Supported` and `Contradicted`, and `DOWNGRADEABLE_VERDICTS` only if the search shows a second distinct set. Every former literal list imports from there. Gate behavior unchanged.

- [ ] **Step 1: Search.** Find every literal verdict list. Write the sets down in the commit body.
- [ ] **Step 2: Write the failing test.** Assert the exported const holds the expected values. Expect a missing-export failure.
- [ ] **Step 3: Implement.** Add the consts and swap the literal lists for imports, one file at a time, tests between files.
- [ ] **Step 4: Run tests.** Run the verdict, stages, and fusion tests, then `npm test` and typecheck. Expect all green.
- [ ] **Step 5: Commit.** `git commit -m "refactor: share verdict value lists (TL-017)"`. Update TL-017 in the tracker.

### Task 18: Match trajectory labels to node names (TL-018)

**Files:**
- Modify: `lib/graph.mjs:28-50` (node names or trajectory labels, one side only)
- Test: `tests/graph.test.mjs`

**Interfaces:**
- Consumes: `runInvestigationGraph` in `lib/graph.mjs`, unchanged signature. Trajectory consumers are the verdict record and `app/page.js`.
- Produces: trajectory entries equal to the LangGraph node names. Rename the trajectory labels `research` and `challenge` to `researchNode` and `challengeNode`, or rename the nodes. Pick the side with fewer consumers. The search in Step 1 decides, and the commit body says which side moved and why.

- [ ] **Step 1: Search.** Find every reader of the trajectory strings. Count consumers per side.
- [ ] **Step 2: Write the failing test.** Run a stub investigation and assert the trajectory entries match the registered node names. Expect a mismatch on the two renamed entries.
- [ ] **Step 3: Implement.** Rename on the low-consumer side. Update any reader the search found.
- [ ] **Step 4: Run tests.** Run the graph and UI tests, then `npm test` and `npm run build`. Expect all green.
- [ ] **Step 5: Commit.** `git commit -m "fix: match trajectory labels to graph nodes (TL-018)"`. Update TL-018 in the tracker.

**Phase 6 gate:** full suite, typecheck, lint, build green.

---

## Close-out

- [ ] Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` on the final commit. Record the counts.
- [ ] Run `npm run eval` with a Meta key if one is set. Record the number. Skip it in the open if no key exists, and say so.
- [ ] Move every fixed TL issue in `docs/agents/issue-tracker.md` to Closed with its commit hash. Leave TL-D01 to TL-D03 and TL-N01 to TL-N02 where they are.
- [ ] Add one dated entry to `docs/PROVENANCE.md` with the phase list, the test count, and the eval number or the missing-key note.
- [ ] Whole-branch review of `main...review-fixes` on both axes, standards and spec, before merge. Phase 1 and Phase 2 findings get re-checked by hand even if the review is clean.

Execution choice. Subagent-driven fits this plan. The tasks are small,
one issue each, and the costly mistakes sit in Phases 1 and 2 where a
fresh reviewer per task earns its keep. Native execution works too and
costs less. It gives up the per-task gate, so the close-out review has
to be strict.
