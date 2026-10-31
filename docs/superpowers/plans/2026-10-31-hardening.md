# Hardening Implementation Plan

**Goal:** Harden the six present-but-soft concepts without new services or dependencies.

**Architecture:** Small shared helpers (`lib/limit.mjs`, `lib/events.mjs`), choke-point wiring in existing modules, one SSE route. No queue, no pub/sub broker, no worker threads.

**Tech Stack:** Node `node:test`, existing LangGraph pipeline, Next routes.

## Global Constraints

- No new dependencies. Single process stays.
- Every task: failing test first, then minimal fix, then focused suite green.
- Existing contracts stay: a throwing judge still propagates at pipeline level; SSE keeps the 3s poll as fallback.

## Tasks

### Task 1: Restart-safe background verification
- Files: `lib/documents.mjs`, test `tests/reader.test.mjs`
- Orphaned docs (`status: verifying`, pending auto claims, no live job, not paused) resume when listed or fetched.
- Test: save an orphaned doc with no job; `listDocuments` settles its pending claim.

### Task 2: Judge fault tolerance
- Files: `lib/meta.mjs`, test `tests/meta.test.mjs`
- `MetaClient` retries retryable HTTP failures (429/5xx) via existing `withRetry`; non-retryable errors fail fast.
- Test: 503 once then 200 yields a verdict with exactly 2 fetch calls; 400 yields 1 call.

### Task 3: Global live-call backpressure
- Files: `lib/limit.mjs` (new), `lib/meta.mjs`, `lib/search.mjs`, `lib/config.mjs`, test `tests/limit.test.mjs`
- One shared limiter, `CONFIG.MAX_CONCURRENT_LIVE_CALLS = 4`, wraps Meta completions and Meta search.
- Test: 10 concurrent limited calls peak at 4 and all complete.

### Task 4: Bounded fetch fan-out
- Files: `lib/limit.mjs`, `lib/evidence.mjs`, `lib/config.mjs`, test `tests/research.test.mjs`
- Source fetches run through `mapWithConcurrency` at `CONFIG.FETCH_CONCURRENCY = 4`, order preserved.
- Test: 6 delayed fetches peak at 4 or fewer and evidence order is stable.

### Task 5: Streaming progress (SSE with poll fallback)
- Files: `lib/events.mjs` (new), `lib/documents.mjs`, `app/api/documents/[id]/events/route.js` (new), `app/page.js`, tests `tests/reader.test.mjs`, `tests/ui.test.mjs`
- Document saves emit a change event; SSE sends the current snapshot on connect and on change; UI opens `EventSource` for the open document and keeps polling as fallback.
- Test: events route responds `text/event-stream` and its first chunk carries the document id.

### Task 6: Enforced status transitions
- Files: `lib/documents.mjs`, test `tests/reader.test.mjs`
- `DOC_TRANSITIONS` and `CLAIM_TRANSITIONS` maps plus a guard used at every status assignment; illegal jumps throw.
- Test: guard rejects `ready -> verified`-style illegal document jumps and allows the legal cycle.

## Verification

- Per task: its focused test file green.
- Final: `npm test`, `npm run lint`, `npm run typecheck` all green.

## Decisions from the stack audit (2026-10-31)

- Circuit breaker: per dependency (Meta completions, Meta search), opens after 3 consecutive retryable failures, 30s cooldown, one half-open probe. Thresholds in `CONFIG`, tuned by eval, not buried.
- Idempotency: `Idempotency-Key` on assess and verify-claim only. Same key and body replays; same key and different body is 409; same key in flight is 409 ("already investigating"). Keys live on the document record.
- Inngest deferred, not rejected. Adopt when any trigger holds: jobs must survive a deploy, a job exceeds ~10 minutes, or more than one process serves traffic. Until then resume-on-sight covers restart loss.
- No `p-limit` (lib/limit.mjs already does this), no TypeScript source migration (tsc checks the JSDoc), no queue service.
