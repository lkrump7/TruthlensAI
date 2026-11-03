# Truthlens pipeline bugfixes implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 14 ordinary-user pipeline bugs in scoped phases without breaking the green suite.

**Architecture:** Keep every fix narrow. Each task adds one failing test, makes it pass with the smallest change, then cleans up. File shape stays as is. No new layers.

**Tech Stack:** Node with `node --test`, Next 14 API routes, file and Postgres repositories in `lib`.

**Spec:** Bug hunt synthesis from the 2026-11-03 workflow run. The 8 ordinary-user paths are single-claim check, batch check, paste and media ingest, doc-claim verify and auto-verify, theory submit and challenge, export and history recall, test gate, eval gate. Each task below pins its own trigger and expected result, so the task text is the spec for that fix.

## Global Constraints

- Run tests with `node --test tests/*.test.mjs`. A single file runs with `node --test tests/<name>.test.mjs`.
- Keep `npm run typecheck` and `npm run lint` green.
- Stay offline in tests. Use `stabilityRuns: 1`, `TRUTHLENS_NO_CHALLENGE=1`, `TRUTHLENS_NO_NLI=1` where the code reads them. No live Meta calls.
- One behavior per cycle. Do not widen scope while green is red.
- Do not delete, skip, or weaken existing tests.

## Review Focus

- Disk full or unwritable store on save. A caller should see a 500, not a 200 that loses data on restart.
- Wonder throws after Spark reached Contradicted. A reader should keep the Spark verdict, not get Unverifiable.
- Revision judge cites unseen evidence after a material challenge. The run should keep the pre-challenge verdict.
- Batch abort with 2 workers finishing out of order. Finished items after the first hole should survive.
- Idempotency-Key reuse on the stream route. The client should see 409 like the blocking route, not a 200 event.

---

### Task 1: Store write path reports errors

**Files:**
- Modify: `lib/repositories.mjs:7-24,86-110`
- Test: `tests/store.test.mjs` plus new `tests/repositories.test.mjs` if needed

**Interfaces:**
- Consumes: `FileRepository.save(doc)`, `FileRepository.nextSeq()`, `FileRepository.persist()`
- Produces: `save()` and `nextSeq()` reject on write failure instead of resolving. `acquireFileLock` creates parent dirs recursively. Callers see the rejection.

- [ ] **Step 1: Write the failing test**

```js
test('save rejects when the store path is unwritable', async () => {
  const repo = new FileRepository('/nonexistent-root-xyz/documents.json');
  await assert.rejects(() => repo.save({ id: 'doc-1' }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/repositories.test.mjs`
Expected: FAIL because `save()` resolves today.

- [ ] **Step 3: Implement in `lib/repositories.mjs`**

Make `persist()` throw after logging. Make `acquireFileLock` run `mkdirSync(dirname(file), { recursive: true })` before the lock dir. Clean tmp orphans on next successful `load()`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/repositories.test.mjs tests/store.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/repositories.mjs tests/repositories.test.mjs tests/store.test.mjs
git commit -m "fix: surface store write errors instead of resolving"
```

### Task 2: User save reports errors

**Files:**
- Modify: `lib/auth.mjs:48-56`
- Test: `tests/auth.test.mjs`

**Interfaces:**
- Consumes: `saveUsers(users)` from Task 1 pattern
- Produces: `saveUsers` throws on failure. `registerUser` rejects instead of claiming success.

- [ ] **Step 1: Write the failing test**

```js
test('registerUser rejects when users file cannot be written', async () => {
  process.env.TRUTHLENS_USERS_FILE = '/nonexistent-root-xyz/users.json';
  await assert.rejects(() => registerUser('alice', 'password123'));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/auth.test.mjs`
Expected: FAIL because `saveUsers` swallows today.

- [ ] **Step 3: Implement in `lib/auth.mjs`**

Throw after logging in `saveUsers`. Restore env in test teardown.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/auth.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/auth.mjs tests/auth.test.mjs
git commit -m "fix: surface user save errors"
```

### Task 3: Wonder failure keeps Spark verdict

**Files:**
- Modify: `lib/stages.mjs:58-81`
- Test: `tests/stages.test.mjs`

**Interfaces:**
- Consumes: `judgeStage(text, evidence, deps)` with `deps.judge`
- Produces: Spark Contradicted or Partially-supported survives a Wonder throw. `judgedBy` stays Spark.

- [ ] **Step 1: Write the failing test**

```js
test('judgeStage keeps spark verdict when wonder throws', async () => {
  const deps = { judge: async ({ model }) => {
    if (String(model).includes('wonder')) throw new Error('wonder down');
    return { verdict: 'Contradicted', citedIds: [] };
  }};
  const out = await judgeStage('water boils at 100C', [], deps);
  assert.equal(out.result.verdict, 'Contradicted');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/stages.test.mjs`
Expected: FAIL with `wonder down`.

- [ ] **Step 3: Implement in `lib/stages.mjs`**

Wrap the Wonder call in try/catch. On throw keep Spark result and skip stability repeat for Wonder.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/stages.test.mjs tests/research.test.mjs tests/graph.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/stages.mjs tests/stages.test.mjs
git commit -m "fix: keep spark verdict when wonder fails"
```

### Task 4: Bad revision citation keeps prior verdict

**Files:**
- Modify: `lib/stages.mjs:113-151`
- Test: `tests/stages.test.mjs`

**Interfaces:**
- Consumes: `challengeStage` with `deps.challenge` and `deps.judge`
- Produces: Hallucinating revision judge does not reject the run. Prior verdict stands.

- [ ] **Step 1: Write the failing test**

```js
test('challengeStage keeps prior verdict on bad revision citation', async () => {
  const out = await challengeStage('claim', currentWithSupported, evidence, {
    challenge: async () => ({ material: true }),
    judge: async () => ({ verdict: 'Contradicted', citedIds: ['ev-hallucinated'] }),
  });
  assert.equal(out.gated.verdict, 'Supported');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/stages.test.mjs`
Expected: FAIL with `Judge cited unknown evidence`.

- [ ] **Step 3: Implement in `lib/stages.mjs`**

Catch `gateStage` around line 145. On `JudgeError` set `challenge = null` and keep prior `cited` and `gated`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/stages.test.mjs tests/stability.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/stages.mjs tests/stages.test.mjs
git commit -m "fix: tolerate hallucinating revision judge"
```

### Task 5: Batch abort keeps finished work

**Files:**
- Modify: `lib/history.mjs:300-307`
- Test: `tests/history.test.mjs`

**Interfaces:**
- Consumes: `verifyClaimBatch(texts, { verifyOne, signal })`
- Produces: Abort returns every completed index in order. Holes stay out. No silent drop after the first hole.

- [ ] **Step 1: Write the failing test**

```js
test('aborted batch keeps later finished items', async () => {
  const out = await verifyClaimBatch(['a', 'b', 'c'], { verifyOne: slowThenAbort });
  assert.ok(out.filter(Boolean).length >= 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/history.test.mjs`
Expected: FAIL because the first-hole break drops later done items.

- [ ] **Step 3: Implement in `lib/history.mjs`**

Collect all set slots instead of breaking at the first hole.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/history.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/history.mjs tests/history.test.mjs
git commit -m "fix: keep finished batch items on abort"
```

### Task 6: Empty input never hits live search

**Files:**
- Modify: `lib/pipeline.mjs:42-47`, `lib/history.mjs:232-250`
- Test: `tests/research.test.mjs`

**Interfaces:**
- Consumes: `verifyResearchedClaim(text)`, `verifyStandalone(text)`
- Produces: Blank input returns Unverifiable without a search call.

- [ ] **Step 1: Write the failing test**

```js
test('empty claim returns unverifiable without running the graph', async () => {
  let progressed = false;
  const out = await verifyResearchedClaim('   ', { onProgress: () => { progressed = true; } });
  assert.equal(out.verdict, 'Unverifiable');
  assert.equal(progressed, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/research.test.mjs`
Expected: FAIL because a search runs today.

- [ ] **Step 3: Implement in `lib/pipeline.mjs`**

Return an Unverifiable verdict early when trimmed text is empty. Mirror it in `verifyStandalone`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/research.test.mjs tests/graph.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/pipeline.mjs lib/history.mjs tests/research.test.mjs
git commit -m "fix: guard empty claims before live search"
```

### Task 7: Stream matches blocking route

**Files:**
- Modify: `app/api/verify/stream/route.js:25-71`
- Test: `tests/stream.test.mjs`, `tests/loop-fixes.test.mjs`

**Interfaces:**
- Consumes: `verifyRateLimited`, `findHistoryByKey`, `recordInvestigation`
- Produces: Stream enforces the same 429 rule and returns 409 on idempotency conflict before SSE starts.

- [ ] **Step 1: Write the failing test**

```js
test('stream rejects idempotency conflict with 409', async () => {
  const res = await POST(conflictRequest);
  assert.equal(res.status, 409);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/stream.test.mjs`
Expected: FAIL with status 200 today.

- [ ] **Step 3: Implement in `app/api/verify/stream/route.js`**

Call `verifyRateLimited` at the top. Check conflict with `findHistoryByKey` before creating the stream and return 409 on mismatch.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/stream.test.mjs tests/loop-fixes.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/verify/stream/route.js tests/stream.test.mjs
git commit -m "fix: give stream route rate limit and 409 parity"
```

### Task 8: Batch and history input rules

**Files:**
- Modify: `lib/history.mjs:26-42`, `app/api/history/route.js:11-16`, `app/api/verify/batch/route.js:21-26`
- Test: `tests/history.test.mjs`

**Interfaces:**
- Consumes: `parseClaimBatch(input)`, `listHistory(owner, { limit })`
- Produces: Non-string batch input gets 400. Bad limit falls back to 100. `dropped` becomes a count plus cap.

- [ ] **Step 1: Write the failing test**

```js
test('parseClaimBatch rejects non-string object input', () => {
  assert.throws(() => parseClaimBatch({ a: 1 }));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/history.test.mjs`
Expected: FAIL because it returns `['[object Object]']` today.

- [ ] **Step 3: Implement in `lib/history.mjs` and routes**

Throw on non-string, non-array input. Validate limit as a positive int. Change `dropped` to `{ count, sample }`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/history.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add lib/history.mjs app/api/history/route.js app/api/verify/batch/route.js tests/history.test.mjs
git commit -m "fix: validate batch and history inputs"
```

### Task 9: Small correctness wins

**Files:**
- Modify: `app/api/transcribe/route.js:12-14`, `app/api/documents/[id]/media/route.js:51-57`, `app/sitemap.js:4-8`, `app/page.js:290,313`
- Test: `tests/voice.test.mjs`, `tests/media-viewer.test.mjs`, `tests/ui-state.test.mjs`

**Interfaces:**
- Consumes: `MAX_AUDIO_BYTES`, `CONFIG.MAX_DOCUMENT_CHARS`
- Produces: Size error names size. Immutable originals cache for a year. Sitemap has no hash URLs. Page uses the shared char cap.

- [ ] **Step 1: Write the failing test**

```js
test('transcribe size error names size', async () => {
  const res = await POST(oversizeShortClip);
  assert.match((await res.json()).error, /32MB|size/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/voice.test.mjs`
Expected: FAIL with "too long" wording.

- [ ] **Step 3: Implement in the four files**

Fix the message. Set `cache-control: public, max-age=31536000, immutable`. Drop hash URLs. Import the shared cap.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/voice.test.mjs tests/media-viewer.test.mjs tests/ui-state.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/transcribe/route.js "app/api/documents/[id]/media/route.js" app/sitemap.js app/page.js tests/voice.test.mjs
git commit -m "fix: correct messages, cache, sitemap, caps"
```

### Task 10: Eval gate works off the happy path

**Files:**
- Modify: `eval/run.mjs:4-24`, `eval/live-arc.mjs:4-9`, `lib/eval-harness.mjs:21-25`
- Test: `tests/eval-harness.test.mjs`

**Interfaces:**
- Consumes: `.env.local` text, `process.argv`, `eval/claims.json`
- Produces: New `parseEnvLine(line)` in `lib/eval-harness.mjs` returns `[key, value]` trimmed with quotes and CR stripped, or null. Both eval scripts use it and anchor paths with `new URL`. Eval exits nonzero on misses. `2.7` trials becomes 3.

- [ ] **Step 1: Write the failing test**

```js
test('parseEnvLine trims spaces and quotes', () => {
  assert.deepEqual(parseEnvLine('KEY ="abc"\r'), ['KEY', 'abc']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/eval-harness.test.mjs`
Expected: FAIL because raw split keeps spaces and quotes.

- [ ] **Step 3: Implement in `eval/` and `lib/eval-harness.mjs`**

Add `parseEnvLine` to `lib/eval-harness.mjs` and use it in both scripts. Use `new URL` anchored reads. Add `process.exit(failed ? 1 : 0)`. Floor trials with `Math.floor`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/eval-harness.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add eval/run.mjs eval/live-arc.mjs lib/eval-harness.mjs tests/eval-harness.test.mjs
git commit -m "fix: make eval loader, paths, and exit code strict"
```


