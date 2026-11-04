# Issue tracker

This file is the single record for review findings in this repo. A finding
lives here from the day a review raises it until the day it is fixed,
rejected on record, or accepted as a known limit. Nothing gets fixed from
chat memory alone. If it is not in this file, it is not tracked.

## How to use this file

- One issue per finding. Give it the next free ID, `TL-` plus three digits.
- Put it in one section only. The section names the risk, not the file.
- Set the status from the list below. Keep the status line current.
- Link the code with `path:line` and link the test that proves the fix.
- When you fix an issue, move it to Closed and name the commit. When you
  decide not to fix it, move it to Decided and write the reason in one or
  two plain sentences. A decided issue stays readable so the next review
  does not raise it again.
- Plans in `docs/superpowers/plans/` implement issues from this file.
  A plan step names the TL ID it closes.

Statuses.

- `open` means confirmed in code and not yet fixed.
- `planned` means an open issue with a task in a named plan.
- `decided` means checked and left as it is, on purpose, with a reason.
- `needs-owner` means a product call is still missing. Code work waits.
- `closed` means fixed and pinned by a test.

Severity.

- `high` means a user can get a false verdict, a forged report, or reach
  a private address.
- `medium` means a verdict, count, or contract is wrong in a case a user
  can hit.
- `low` means cost, clarity, or upkeep. No wrong answer by itself.

## Review of 2026-10-31, base `ed9ffa5`

Base `ed9ffa5`, head `bd7e000`. Two commits, 112 files. Gates at review
time were green. `npm test` passed 328 of 328, and lint and typecheck
passed. The findings below are the ones those gates do not catch.

Fix work for the open findings is in
`docs/superpowers/plans/2026-10-31-review-fixes.md`. That plan runs in
phases. Phase 1 closes the trust boundary issues first, because a wrong
verdict is worse when anyone can forge or leak it.

### Section 1. Trust boundaries

These decide who can make the app say something, and what network it
will touch to say it. Fix them before any verdict work.

| ID | Severity | Status | Finding |
|---|---|---|---|
| TL-001 | high | closed | Fetcher allows IPv4-mapped IPv6 private addresses |
| TL-002 | high | closed | Export renders any record the client posts |
| TL-003 | medium | closed | Document event stream has no owner check |
| TL-019 | medium | closed | Export loads any document by ID with no owner check |
| TL-021 | low | closed | Fetcher fails open on an unparseable mapped IPv6 tail |

TL-001. Fetcher allows IPv4-mapped IPv6 private addresses.
`isPrivateHost` in `lib/fetch.mjs:5` strips brackets and checks `::1`,
`fe80:`, `fc`, and `fd`, then a dotted IPv4 pattern. `[::ffff:127.0.0.1]`
matches none of those, so `assertPublicUrl` allows it. `[::]` is allowed
too. The same `fc` test also blocks a plain domain that starts with `fc`.
That is a false block sitting next to a real hole. It breaks principle 1
in `docs/PRINCIPLES.md`, since evidence fetching is the guarded path the
whole verdict rests on. Plan phase 1, Task 1.

TL-002. Export renders any record the client posts.
`app/api/export/route.js:6` takes `record` from the request body and
hands it to `buildInvestigationReport`. There is no lookup of a stored
verdict and no check that cited passages exist. Anyone can post an
invented claim, verdict, and passages and get a TruthLens report back.
That breaks principles 1 and 2 in `docs/PRINCIPLES.md`. The report is the
artifact a journalist files, so a forgeable report is worse than a wrong
on-screen verdict. Plan phase 1, Task 2.

TL-003. Document event stream has no owner check.
`app/api/documents/[id]/events/route.js:5` loads any document by ID and
streams every later change to the caller. With `AUTH_ENABLED=true` the
README promises owner-scoped documents. This route is new in the diff
and it leaks for as long as the connection stays open. The other `[id]`
routes share the pattern, so the fix sets the pattern for all of them.
Plan phase 1, Task 3.

TL-019. Export loads any document by ID with no owner check.
TL-002 made export render a stored verdict named by document and claim
ID, but `app/api/export/route.js` loaded that document with no owner
gate. Document IDs are sequential, so with accounts on, any signed-in
reader could export another reader's verdicts. The fix adds one shared
rule, `canView` in `lib/auth.mjs`: accounts off means open, accounts on
means the owner or a demo document. The export route and the event
stream in TL-003 now both use it, so the two rules cannot drift. Raised
by the final whole-branch review.

TL-021. Fetcher fails open on an unparseable mapped IPv6 tail.
`isPrivateHost` in `lib/fetch.mjs` parses the tail of a `::ffff:` host
as dotted IPv4 or as hex. A tail that parses as neither returned
`false`, public. A URL cannot carry such a tail, the parser rejects it
first, but `assertHostResolvesPublic` feeds raw DNS answers to the same
check, and a malformed answer would pass as public. The tail now fails
closed. `isPrivateHost` is exported as the test seam, because the bad
shape cannot arrive through `assertPublicUrl`. Raised by the final
whole-branch review; first noted as a deferred minor under TL-001.


### Section 2. Verdict invariants

These decide whether a verdict means what the principles say it means.

| ID | Severity | Status | Finding |
|---|---|---|---|
| TL-004 | medium | closed | Compound roll-up can be decisive over a `Not fact-checkable` element |
| TL-005 | medium | closed | One-word overlap passages can reach the judge as `pageBest` |
| TL-006 | medium | closed | Stability gate downgrades too narrowly and repeat judging costs too much |

TL-004. Compound roll-up can be decisive over an opinion element.
`rollupCompound` in `lib/pipeline.mjs:17` drops `Unverifiable` and
`Not fact-checkable` from the decisive list, then lets one remaining
decisive verdict win. A claim split into `Supported` plus
`Not fact-checkable` rolls up to `Supported`. Principle 4 in
`docs/PRINCIPLES.md` says a decisive verdict needs every element decisive
and in agreement. Plan phase 2, Task 4.

TL-005. One-word overlap passages can reach the judge.
`lib/evidence.mjs:152` falls back to `minOverlap: 1` when no passage meets
the normal floor of 2, and marks the result `pageBest`. `lib/stages.mjs:33`
then keeps a `pageBest` passage without the relevance check other
passages get. One shared word is enough. Principle 1 asks for passages
relevance-checked against that claim. Plan phase 2, Task 5.

TL-006. Stability gate is too narrow, and repeat judging is wasteful.
`applyStabilityGate` in `lib/verdict.mjs:62` only downgrades `Supported`
and `Contradicted`, and only ever to `Partially supported`. The design
also allows `Unverifiable` when the evidence cannot settle the split.
`lib/stages.mjs:61` runs repeat judging for every verdict, not just the
ones that can be downgraded, and the revision repeats at
`lib/stages.mjs:125` call the judge without the `challenge` argument the
first revision got at `lib/stages.mjs:115`. So the app pays for runs it
cannot use and measures the revision under different terms than it set.
Plan phase 2, Task 6.

### Section 3. Concurrency and limits

These are quiet now and loud under load. Two readers on one excerpt is
enough to hit them.

| ID | Severity | Status | Finding |
|---|---|---|---|
| TL-007 | medium | closed | `applyVerdict` still loses concurrent writes |
| TL-008 | low | closed | Duplicate claim text breaks the 20-claim auto-verify cap |
| TL-020 | medium | closed | Reader-pick marking saves outside the document lock |
| TL-023 | medium | closed | Unlocked saves and owner checks on the remaining document routes |

TL-007. `applyVerdict` still loses concurrent writes.
`applyVerdict` in `lib/documents.mjs:80` reloads the document, changes
its copy, then saves. That load-to-save window is not locked. A follow-up
saved inside the window is gone when the verdict lands. `runDocLocked`
at `lib/documents.mjs:43` guards the two idempotency writes only. The
comment above `applyVerdict` claims this race is closed. It is not.
Plan phase 3, Task 7.

TL-008. Duplicate claim text breaks the 20-claim cap.
`createDocument` in `lib/documents.mjs:144` builds the auto-selected set
from claim text. Two claims with the same text both match, so both get
`autoSelected`. The cap in `CONFIG.MAX_CLAIMS_PER_DOCUMENT` is 20 and the
README promises 20 deep checks per excerpt. Duplicate text in a real excerpt
is common, so the overrun is common too. Plan phase 3, Task 8.

TL-020. Reader-pick marking saves outside the document lock.
`verifyClaimLocked` in `lib/documents.mjs` applied the verdict inside
`runDocLocked`, then set `source` to `reader-pick` on that copy and
saved again outside the lock. A follow-up saved between the two saves
was erased by the second one, the TL-007 window one step later. The
marking now happens inside the locked apply, before the report is
built, so there is no second save. Raised by the final whole-branch
review.

TL-023. Unlocked saves and owner checks on the remaining routes. Closed.
Both halves are in the tree. `recheckDocument` and `setAutoPaused` in
`lib/documents.mjs` save inside `runDocLocked`, and the assess, auto,
recheck, claim verify and challenge routes all 404 a document the
requester cannot view under `canView` in `lib/auth.mjs`. Pinned by
`tests/integration.test.mjs`: with accounts on, a second user gets 404
from all five routes on another user's document while the owner still
gets through. Demo documents stay visible to everyone by design, the
same rule `canView` documents, so history listing keeps merging demo
documents; private owners never leak, pinned by `tests/history.test.mjs`.

### Section 4. Media input contracts

The route status codes are the contract here. Callers act on them.

| ID | Severity | Status | Finding |
|---|---|---|---|
| TL-009 | medium | closed | Blank image caption returns 502 and the 422 branch is dead |
| TL-010 | medium | closed | Video document omits `durationSec` and hides ffmpeg failure |

TL-009. Blank image caption returns the wrong status.
`captionImage` in `lib/caption.mjs:42` throws on a blank caption.
`app/api/documents/image/route.js` maps every throw to 502, so the 422
check below it can never run. The image-video design says a blank result
is 422 and a model failure is 502. The route also trusts `file.type`, so
a type the model cannot read can reach the model call instead of failing
at 400 first. Plan phase 4, Task 9.

TL-010. Video document omits `durationSec` and hides ffmpeg failure.
The image-video plan stores `media` with `durationSec`, `model`, and
`voiceModel`. `app/api/documents/video/route.js:31` stores `transcript`
instead of `durationSec`. `ffmpegAudioChunk` in `lib/video.mjs:90` treats
every ffmpeg error as no audio track, so a broken video becomes a
frames-only document with no sign that anything failed. A silent video
should still work. A corrupt one should not pretend to. Plan phase 4,
Task 10.

### Section 5. Stream and export contracts

The screen and the downloaded report have to show the same record.

| ID | Severity | Status | Finding |
|---|---|---|---|
| TL-011 | low | closed | Specs disagree on demo-mode stream stages |
| TL-012 | low | closed | Progress events carry model and counts for some stages only |
| TL-013 | medium | closed | Export omits run date and the model list |
| TL-014 | low | closed | Demo arc is pinned in demo mode only |

TL-011. Specs disagree on demo-mode stream stages.
The hackathon-win plan says demo mode emits the same stage names with
the demo record. The hackathon-win design says a stage that has not run
is never shown as run. `app/api/verify/stream/route.js:23` follows the
design and emits no stages in demo mode. The code is the honest choice.
One spec has to change so the next reader does not have to guess. This
is a doc fix plus a test that pins whichever wording wins. Plan phase 5,
Task 11.

TL-012. Progress events are uneven.
The design says progress events carry stage name, model, and counts.
`lib/graph.mjs:29` and `lib/graph.mjs:39` send a model for `judge` and
counts for `research` only. `app/page.js:364` shows the model for the
judge stage only. A reader watching a live check cannot tell which model
ran the other stages. Plan phase 5, Task 12.

TL-013. Export omits run date and the model list.
The design asks the report to record model names, prompt version, run
date, run count, and agreement. `buildInvestigationReport` in
`lib/export.mjs:20` prints one `Judged by` line and an `Exported` date.
Run date and the full model list are missing, and prompt version prints
only when the record happens to hold one. Fix it with TL-002 so the
report is both honest and complete, not one or the other. Plan phase 5,
Task 13.

TL-014. Demo arc is pinned in demo mode only.
The design says the three demo claims are pinned only after they pass in
demo mode and in live mode. `tests/demo-arc.test.mjs:7` pins the demo
engine only. Live mode needs a Meta key, so the live half cannot run in
the normal suite. Keep it out of `npm test` and run it as a named manual
gate before a release. Plan phase 5, Task 14.

### Section 6. Cost and upkeep

No wrong answers here. These cost money or slow down the next change.

| ID | Severity | Status | Finding |
|---|---|---|---|
| TL-015 | low | closed | `BUDGET.maxJudgeCalls` is dead config |
| TL-016 | low | closed | Duplicated idempotency tail and duplicated stability loop |
| TL-017 | low | closed | Verdict strings are listed in four-plus places |
| TL-018 | low | closed | Trajectory labels do not match graph node names |
| TL-022 | low | open | Upkeep bundle from the final review |

TL-015. `BUDGET.maxJudgeCalls` is dead config.
`BUDGET.maxJudgeCalls` is 2 in `lib/fetch.mjs:3` and nothing reads it,
while `lib/stages.mjs` runs up to three stability judgements plus
escalation and revision rounds. Dead config is worse than no config,
because the next reader trusts it. Delete it or wire it. Plan phase 6,
Task 15.

TL-016. Two code shapes are copied.
The locked idempotency tail at `lib/documents.mjs:191` repeats at
`lib/documents.mjs:316`. The stability loop at `lib/stages.mjs:64`
repeats at `lib/stages.mjs:124`. Each copy will drift from the other.
Extract one helper per shape. Plan phase 6, Task 16.

TL-017. Verdict strings are listed again and again.
The same verdict values appear in `GATES`, `ESCALATION_VERDICTS`,
`DISPUTED`, and `lib/stages.mjs:109`. One new verdict value means editing
four or more places, and missing one is silent. One shared list ends
that. Plan phase 6, Task 17.

TL-018. Trajectory labels do not match node names.
Graph nodes are `researchNode` and `challengeNode` in `lib/graph.mjs:32`,
and the trajectory records `research` and `challenge`. The record should
name what ran. Rename one side so they match. Plan phase 6, Task 18.

TL-022. Upkeep bundle from the final review. Open.
Small items with no wrong answer by themselves, grouped so they land
in one tidy-up change. The `pageBest` mark in `lib/evidence.mjs` is
inert since TL-005: it still tags fallback passages, and nothing reads
the tag. The `DISPUTED` alias of `ESCALATION_VERDICTS` in
`lib/report.mjs` merges two meanings under one name. Progress events
and trajectory entries name the same stages two ways. The final review
also left test and seam minors: mid-file imports and slow re-seeding
in `tests/export.test.mjs`, the wider `deps.extractClaims` seam, the
reused judge arguments object, and per-chunk ffprobe calls. None of
these changes behaviour on its own. Raised by the final whole-branch
review.

## Decided. Checked and left as it is

Do not raise these again without new evidence. Each one was checked
against the code when it was decided.

TL-D01. Orphan resume is fire-and-forget, on purpose.
`resumeIfOrphaned` in `lib/documents.mjs` starts auto-verification
without waiting for it. `listDocuments` and `getDocument` feed the reader
UI, and a list call that waits for a full verification pass is a broken
list call. Callers that need the end state join the job through
`whenAutoVerificationDone`. `startAutoVerification` catches its own
failures, logs them, and resets the document status, so the dropped
promise cannot reject unhandled. Full record in `docs/PROVENANCE.md`
under the 2026-10-31 rejected-findings update.

TL-D02. LangGraph and its dependency are not scope creep to remove.
`lib/graph.mjs`, `lib/stages.mjs`, and `@langchain/langgraph` in
`package.json` were already in the tree before the hardening work, and
the hardening plan names the existing LangGraph pipeline as its stack.
Removing the workflow engine is a product decision, not a review fix.
Full record in `docs/PROVENANCE.md` under the same update.

TL-D03. DNS rebinding window stays open, on record.
The fetcher checks resolved addresses, then `fetch` resolves again.
A hostile DNS answer could change between the two. The bug-review plan
accepted this as a known limit and no code change was taken. It stays in
the README limits. Pinning the resolved address is the fix if this is
ever reopened. TL-001 is a different bug. That one is a plain allow-list
miss and it gets fixed.

## Needs an owner call. No code until then

TL-N01. Website ingestion shipped without a plan clause.
`POST /api/documents/url`, `lib/website.mjs`, and the website tool in
`app/page.js` came in with head `bd7e000`. The media plan says existing
website behavior stays unchanged, and the README now documents website
documents as a feature. Keep it or cut it is a product call. Cutting it
deletes a shipped, tested feature, so no agent should do that from a
review alone. If the owner keeps it, write the missing spec clause and
move this to closed with no code change.

TL-N02. New verdict-adjacent machinery and a threshold change.
The diff adds NLI second opinion, conformal calibration, uncertainty
scoring, semantic relevance, BM25 and rerank stages, and query
expansion. It also moves `DEDUPE_THRESHOLD` from 0.92 to 0.8 in
`lib/config.mjs`. The hackathon-win design says no new verdict logic.
Principle 7 in `docs/PRINCIPLES.md` says annotations never change
verdicts, and most of this machinery is annotation. The owner call is
narrow. Ratify the machinery as annotation-only, and either ratify 0.8
with eval numbers or put 0.92 back. Until then, no task in the fix plan
touches it. `npm run eval` numbers settle the threshold half.

## Closed

TL-001. Fetcher allows IPv4-mapped IPv6 private addresses. Closed in
`fix: block mapped IPv6 private hosts in fetcher (TL-001)`. Pinned by
`tests/fetch.test.mjs`.

TL-002. Export renders any record the client posts. Closed in
`fix: export stored verdicts only (TL-002)`. Pinned by
`tests/export.test.mjs`.

TL-003. Document event stream has no owner check. Closed in
`fix: owner-check document event stream (TL-003)`. Pinned by
`tests/reader.test.mjs` and `tests/auth.test.mjs`.

TL-004. Compound roll-up can be decisive over a `Not fact-checkable`
element. Closed in
`fix: cap compound roll-up over opinion elements (TL-004)`. Pinned by
`tests/fusion.test.mjs`.

TL-005. One-word overlap passages can reach the judge as `pageBest`.
Closed in `fix: hold fallback passages to relevance floor (TL-005)`.
Pinned by `tests/research.test.mjs` and `tests/utility.test.mjs`.

TL-006. Stability gate is too narrow, and repeat judging is wasteful.
Closed in `fix: stability gate target and repeat-run cost (TL-006)`.
Pinned by `tests/stability.test.mjs` and `tests/verdict.test.mjs`.

TL-007. `applyVerdict` still loses concurrent writes. Closed in
`fix: lock verdict writes per document (TL-007)`. Pinned by
`tests/reader.test.mjs`.

TL-008. Duplicate claim text breaks the 20-claim auto-verify cap.
Closed in `fix: cap auto-verification by claim identity (TL-008)`.
Pinned by `tests/reader.test.mjs`.

TL-009. Blank image caption returns the wrong status.
Closed in `fix: image caption status codes (TL-009)`.
Pinned by `tests/caption.test.mjs` and `tests/media-documents.test.mjs`.

TL-010. Video document omits `durationSec` and hides ffmpeg failure.
Closed in `fix: store video duration and surface ffmpeg failures (TL-010)`.
Pinned by `tests/video.test.mjs` and `tests/media-documents.test.mjs`.
Hand-check with ffmpeg 8.0.1: a 3s silent `testsrc` video returned
frame pages with `durationSec: 3`; a garbage file failed at the
ffprobe duration step instead of becoming a frames-only document.

TL-011. Specs disagree on demo-mode stream stages.
Closed in `docs: settle demo stream stage wording (TL-011)`.
Pinned by `tests/stream.test.mjs`. The pin passed on its first run,
before any wording change, so it pins existing behaviour rather than
a new feature.

TL-012. Progress events are uneven.
Closed in `fix: carry model and counts on progress events (TL-012)`.
Pinned by `tests/graph.test.mjs` and `tests/ui.test.mjs`.

TL-013. Export omits run date and the model list.
Closed in `fix: record run date and models in export (TL-013)`.
Pinned by `tests/export.test.mjs`.

TL-014. Demo arc is pinned in demo mode only.
Closed in `feat: live demo-arc release gate (TL-014)`.
Gate is `eval/live-arc.mjs`, run by hand before a release and kept
out of `npm test`. No Meta key was at hand when this closed, so the
live run has not been run. Without a key the gate exits 1 with a
plain message. The live pass is left to the release checklist.

TL-015. `BUDGET.maxJudgeCalls` is dead config.
Closed in `chore: remove dead judge-call budget (TL-015)`.
Pinned by `tests/utility.test.mjs`. Judge cost stays governed by
`CONFIG.STABILITY_RUNS` and the stability gate.

TL-016. Two code shapes are copied.
Closed in `refactor: share idempotency write in documents (TL-016)`
and `refactor: share stability repeat loop in stages (TL-016)`.
No behaviour change: pinned by `tests/reader.test.mjs` and
`tests/stability.test.mjs`, green before and after each extraction.

TL-017. Verdict strings are listed again and again.
Closed in `refactor: share verdict value lists (TL-017)`.
Pinned by `tests/verdict.test.mjs`. No behaviour change:
`DECISIVE_VERDICTS` in `lib/verdict.mjs` now holds the one
decisive set, and `lib/report.mjs` reuses the existing
`ESCALATION_VERDICTS` from `lib/config.mjs`.

TL-018. Trajectory labels do not match node names.
Closed in `fix: match trajectory labels to graph nodes (TL-018)`.
Pinned by `tests/graph.test.mjs`. The trajectory side moved:
`research` and `challenge` in the trajectory are now
`researchNode` and `challengeNode`, matching the registered
LangGraph nodes. The node side could not move, because
`research` and `challenge` are state channel names and
LangGraph rejects a node name that matches a channel.

TL-019. Export loads any document by ID with no owner check.
Closed in `fix: owner-check document export (TL-019)`.
Pinned by `tests/export.test.mjs`. One shared rule, `canView` in
`lib/auth.mjs`, now gates both the export route and the TL-003 event
stream: another reader's document 404s, the owner's and demo
documents return 200, and accounts off stays open.

TL-020. Reader-pick marking saves outside the document lock.
Closed in `fix: mark reader-pick inside locked verdict apply (TL-020)`.
Pinned by `tests/reader.test.mjs`. The marking moved into the locked
verdict apply, so a follow-up saved after the verdict survives.

TL-021. Fetcher fails open on an unparseable mapped IPv6 tail.
Closed in `fix: fail closed on unparseable mapped IPv6 tail (TL-021)`.
Pinned by `tests/fetch.test.mjs` through the exported `isPrivateHost`
seam, because a malformed mapped tail cannot arrive through a URL.
