# Hackathon win: investigation theatre, stability, export. Implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing gated pipeline visible and trustworthy in a two-minute demo for researchers and journalists. Stream the investigation, prove decisive verdicts are stable across repeated judging, export the report, and pin a three-claim demo arc.

**Architecture:** No new verdict logic and no new services. The LangGraph nodes gain a progress callback and a stability record. One new SSE route streams the single-claim check. One pure module builds the export text. The UI renders what the record already holds.

**Tech Stack:** Next 14 routes, LangGraph JS in `lib/graph.mjs`, `node --test`, existing `lib/stages.mjs` stage functions.

**Spec:** [2026-10-31-hackathon-win-design.md](/home/magwaza/TruthlensAI/docs/superpowers/specs/2026-10-31-hackathon-win-design.md:1)

## Global constraints

- No new dependencies. Single process stays.
- Every task runs test-first. Red, green, refactor, in that order.
- No verdict without fetched evidence. No single 0 to 100 truth score. Demo output is never labelled live.
- Copy stays plain. No em dashes in new UI or README text.
- Baseline before this plan: `npm test` passes 302 tests.

## Review focus

- A streamed stage that never ran must not appear as run. The final streamed event carries the same record the blocking route returns.
- An unstable decisive verdict must move toward Partially supported or Unverifiable. It must never move toward decisiveness.
- Export must not invent confidence, source quality, or a prompt claim the record does not hold.
- Streaming failure must fall back to the blocking result and say so in the UI.
- Repeated judging multiplies live cost. The run count is a named constant, shown on the verdict, and settable to 1 in tests and eval.

---

### Task 1: Stability check for decisive verdicts

**Files:**
- Create: `lib/stability.mjs`, `tests/stability.test.mjs`
- Modify: `lib/config.mjs`, `lib/stages.mjs`, `lib/graph.mjs`, `lib/verdict.mjs`
- Test: `tests/stability.test.mjs`, `tests/graph.test.mjs`, `tests/verdict.test.mjs`

**Interfaces:**
- Consumes: `judgeStage(text, judgeEvidence, deps)` and `gateStage(result, judgeEvidence)` in `lib/stages.mjs`.
- Produces: `summariseStability(verdicts)` returning `{ runs, verdicts, agreed, majority }`. Verdict records gain `stability` with that shape. `CONFIG.STABILITY_RUNS` defaults to 3. `deps.stabilityRuns` overrides it.

- [ ] **Step 1: Write the failing tests**

In `tests/stability.test.mjs`, assert `summariseStability(['Supported', 'Supported', 'Supported'])` gives `agreed: true` and `runs: 3`. Assert a split list gives `agreed: false`. In `tests/verdict.test.mjs`, assert a gate context with split stability and verdict Supported comes out Partially supported. In `tests/graph.test.mjs`, add a judge that flips verdicts across calls and assert the graph result is not decisive and carries `stability.agreed: false`.

- [ ] **Step 2: Run the focused tests and watch them fail**

Run: `node --test tests/stability.test.mjs tests/verdict.test.mjs tests/graph.test.mjs`
Expected: fail on missing `lib/stability.mjs` and missing stability gate.

- [ ] **Step 3: Implement the minimum**

Add `summariseStability` in `lib/stability.mjs`. Add `STABILITY_RUNS: 3` to `CONFIG`. In `judgeStage`, after the final model and result are chosen, call the judge on the same evidence until the run count is met and collect every verdict. Keep the first final result as the record. Return `stability` beside `result`. Add a stability gate in `lib/verdict.mjs` that downgrades Supported or Contradicted to Partially supported when stability disagrees, with a limitation that names the run verdicts. Thread `stability` through `lib/graph.mjs` state, `gateStage`, and `assembleStage`.

- [ ] **Step 4: Run the focused tests and the full suite**

Run: `node --test tests/stability.test.mjs tests/verdict.test.mjs tests/graph.test.mjs` then `npm test`
Expected: focused tests pass. Full suite stays green, including judge call-count sensitive research tests. If a research test breaks only on call count, pass `stabilityRuns: 1` in that test setup rather than weakening its assertions.

- [ ] **Step 5: Commit**

```bash
git add lib/stability.mjs lib/config.mjs lib/stages.mjs lib/graph.mjs lib/verdict.mjs tests/stability.test.mjs tests/verdict.test.mjs tests/graph.test.mjs
git commit -m "feat: stability check downgrades unstable decisive verdicts"
```

### Task 2: Live investigation stream

**Files:**
- Create: `app/api/verify/stream/route.js`
- Modify: `lib/graph.mjs`
- Test: `tests/graph.test.mjs`, `tests/ui.test.mjs`

**Interfaces:**
- Consumes: `runInvestigationGraph(text, deps)` in `lib/graph.mjs`.
- Produces: `deps.onProgress(stage, detail)` called once per finished node, in trajectory order. The SSE route emits `progress` events with stage, model label, and research counts, then one `verdict` event with the full record, then closes. Demo mode emits the same stage names with the demo record and mode demo.

- [ ] **Step 1: Write the failing tests**

In `tests/graph.test.mjs`, pass an `onProgress` recorder and assert the stages arrive in trajectory order. In `tests/ui.test.mjs`, assert `app/page.js` reads the stream route and keeps a blocking fallback message.

- [ ] **Step 2: Run the focused tests and watch them fail**

Run: `node --test tests/graph.test.mjs tests/ui.test.mjs`
Expected: fail because `onProgress` is never called and the page has no stream code.

- [ ] **Step 3: Implement the minimum**

Call `deps.onProgress` at the end of each graph node with the stage name and, for research, the stats object. Add the SSE route mirroring `app/api/documents/[id]/events/route.js`. In live mode it runs the graph with an `onProgress` that enqueues progress events. In demo mode it runs the demo engine and emits the six stage names before the verdict event. Errors emit one `error` event and close.

- [ ] **Step 4: Run the focused tests**

Run: `node --test tests/graph.test.mjs tests/ui.test.mjs`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add lib/graph.mjs app/api/verify/stream/route.js tests/graph.test.mjs tests/ui.test.mjs
git commit -m "feat: stream investigation stages for the single-claim check"
```

### Task 3: Exportable investigation report

**Files:**
- Create: `lib/export.mjs`, `tests/export.test.mjs`
- Modify: `lib/prompts.mjs`

**Interfaces:**
- Consumes: a verdict record as returned by the pipeline or demo engine.
- Produces: `buildInvestigationReport(record, { now })` returning Markdown text. Sections: claim, verdict, judged by, mode, run date, prompt version, stability when present, supporting passages with URLs, contradicting passages with URLs, judge disagreement when present, challenge when present, unresolved limits. `PROMPT_VERSION` in `lib/prompts.mjs` is the string `2026-10-31`.

- [ ] **Step 1: Write the failing tests**

Assert the report names the claim and verdict, lists a supporting passage with its URL, states the limits, and contains no confidence percentage the record did not carry. Assert an Unverifiable record exports with no passages and still states its limits.

- [ ] **Step 2: Run the test and watch it fail**

Run: `node --test tests/export.test.mjs`
Expected: fail on missing `lib/export.mjs`.

- [ ] **Step 3: Implement the minimum**

Write `buildInvestigationReport` as a pure function over the record. Add `PROMPT_VERSION` to `lib/prompts.mjs` and use it in the report. Read only fields the record holds.

- [ ] **Step 4: Run the test**

Run: `node --test tests/export.test.mjs`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add lib/export.mjs lib/prompts.mjs tests/export.test.mjs
git commit -m "feat: exportable investigation report with provenance"
```

### Task 4: Verdict view shows the investigation

**Files:**
- Modify: `app/page.js`, `app/globals.css`
- Test: `tests/ui.test.mjs`

**Interfaces:**
- Consumes: `trajectory`, `stability`, `judges`, `challenge`, and `buildInvestigationReport` from Tasks 1 to 3.
- Produces: a stage list in the verdict view with plain stage names and the model per stage, a stability line when present, and a Download report button that saves the Markdown from Task 3. The claim form reads the Task 2 stream and falls back to the blocking route with a plain message when the stream fails.

- [ ] **Step 1: Write the failing tests**

In `tests/ui.test.mjs`, assert the page renders trajectory stages, shows a stability line, offers Download report, and calls the stream route before any fallback.

- [ ] **Step 2: Run the test and watch it fail**

Run: `node --test tests/ui.test.mjs`
Expected: fail on the missing markers.

- [ ] **Step 3: Implement the minimum**

Add a stage label map in `app/page.js` covering triage, research, judge, gates, challenge, and assemble. Render the recorded trajectory only. Render stability as runs and agreement in plain words. Wire the download button to a Blob built from `buildInvestigationReport`. Change `verify()` to read SSE progress into a live stage list, then set the final record on the verdict event. On stream error, run the existing blocking request and note the fallback. Add the small CSS the stage list needs.

- [ ] **Step 4: Run the test and the suite**

Run: `node --test tests/ui.test.mjs` then `npm test`
Expected: pass, suite green.

- [ ] **Step 5: Commit**

```bash
git add app/page.js app/globals.css tests/ui.test.mjs
git commit -m "feat: verdict view streams stages and downloads the report"
```

### Task 5: Demo arc pinned by test

**Files:**
- Create: `tests/demo-arc.test.mjs`
- Modify: `README.md`
- Test: `tests/demo-arc.test.mjs`, `tests/ui.test.mjs`

**Interfaces:**
- Consumes: `verifyClaim` and `DEMO_EVIDENCE` in `lib/demo.mjs`, `seedDemo` in `lib/documents.mjs`.
- Produces: three pinned demo investigations. Supported: Water boils at 100 degrees Celsius at sea level. Contradicted: Humans only use 10% of their brains. Unverifiable: The village of Upper Snelgrove brewed exactly 41 barrels of ale in March 1731.

- [ ] **Step 1: Write the failing test**

Assert each pinned claim returns its pinned verdict from the demo engine, and that the Contradicted case carries at least two contradicting passages from two sources.

- [ ] **Step 2: Run the test and watch the result**

Run: `node --test tests/demo-arc.test.mjs`
Expected: pass or fail on evidence keywords. A first-run pass here is a pin on existing behaviour, not a new feature. Note that in the report instead of forcing red.

- [ ] **Step 3: Fix only what the pin exposes**

If a pinned claim misses, adjust demo evidence keywords or passages in `lib/demo.mjs` until the pin passes. Do not change verdict logic to fit the demo.

- [ ] **Step 4: Rewrite the README demo script**

Replace the demo script with the three-claim arc in order. Name the audience as researchers and journalists first. End on the exported report. Keep the honesty line: the demo promises inspectable evidence, not identical repeat verdicts.

- [ ] **Step 5: Run tests and commit**

Run: `node --test tests/demo-arc.test.mjs tests/ui.test.mjs` then `npm test`
Expected: green.

```bash
git add tests/demo-arc.test.mjs README.md lib/demo.mjs
git commit -m "feat: pin the three-claim demo arc and rewrite the demo script"
```

### Task 6: Eval reports repeated trials

**Files:**
- Create: `lib/evalstats.mjs`, `tests/evalstats.test.mjs`
- Modify: `eval/run.mjs`

**Interfaces:**
- Consumes: per-claim trial verdicts from repeated `verifyResearchedClaim` calls.
- Produces: `summariseTrials(trials)` returning `{ runs, verdicts, majority, flipRate, agreed }` where `flipRate` is the share of trials that differ from the majority. `eval/run.mjs` accepts `--trials N` with default 3 and prints per-claim distributions plus an overall flip rate.

- [ ] **Step 1: Write the failing tests**

Assert three identical verdicts give `flipRate: 0` and `agreed: true`. Assert two Supported and one Contradicted gives majority Supported and a flip rate of one third.

- [ ] **Step 2: Run the test and watch it fail**

Run: `node --test tests/evalstats.test.mjs`
Expected: fail on missing `lib/evalstats.mjs`.

- [ ] **Step 3: Implement the minimum**

Add `summariseTrials` in `lib/evalstats.mjs`. Wire `--trials` into `eval/run.mjs` so each claim runs that many times with `stabilityRuns: 1`, since the trials themselves are the stability measure. Print the distribution and flip rate per claim and overall. Keep the conformal warning text as is.

- [ ] **Step 4: Run tests**

Run: `node --test tests/evalstats.test.mjs` then `npm test`
Expected: pass. Live eval itself needs a Meta key and is not part of the unit run.

- [ ] **Step 5: Commit**

```bash
git add lib/evalstats.mjs eval/run.mjs tests/evalstats.test.mjs
git commit -m "feat: eval reports verdict distributions and flip rate"
```

## Verification

- Per task: its focused test files green.
- Final: `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` all green.
- Manual once: `npm run dev`, run the three demo claims, watch stages stream, download one report, read it.

## Decisions made in this plan

- Stability runs default to 3. The research figure near 11 runs for 95% stability is recorded in the design as the benchmark. Three is the stated trade against live cost, and the verdict shows the count.
- Export is Markdown. It prints cleanly, pastes into a story file or lab notes, and needs no new dependency.
- Prompt provenance is a date string, `2026-10-31`, bumped by hand when prompts change. No prompt hashing in this pass.
- The demo arc uses claims already covered by the demo corpus and the eval set. No new seeded claims enter the demo book in this pass.
