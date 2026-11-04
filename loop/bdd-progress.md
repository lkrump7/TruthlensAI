# SDD ledger — plan: inline BDD acceptance plan (node:test + Playwright, pytest only on demand)

## Setup
- Working in place at repo root; no worktree/branch/commit. Ruling: user directed
  implementation in `loop/` with no commit request, so all changes stay uncommitted
  for review — no main-branch history is rewritten and nothing is pushed.
- Workspace record lives here (`loop/bdd-progress.md`) instead of
  `.superpowers/sdd/` so the full loop stays in the user-named directory.
- Spec authority: inline plan from this session (Goal/Success Criteria/Steps/
  Validation). No separate spec file exists — rulings without a spec are provisional.

## Pre-flight interface scan
- Producer `tests/bdd-helper.mjs` (`givenWhenThen` + `jsonReq`; failures are
  re-thrown with the Given/When/Then steps attached) → consumers: every
  `tests/bdd-*.test.mjs` scenario file. Contract: helper exports exactly
  `givenWhenThen` and `jsonReq`; consumers import only those names. Store
  isolation lives in each scenario file (`mkdtempSync` + `TRUTHLENS_STORE_FILE`),
  not in the helper.
- Producer route handlers under `app/api/**` → consumers: scenario files import
  `POST`/`GET` directly (pattern from `tests/integration.test.mjs`). No server
  boot required; demo mode (no Meta key) keeps live costs at zero.
- Playwright `e2e/*.spec.js` consumes the same HTTP routes via a running
  `npm run dev` server in demo mode. No shared code with `tests/` to keep
  `npm test` glob (`tests/*.test.mjs`) clean.
- Ruling: no conflicts found — helper API is new, route contracts are unchanged.
  Pre-flight: interfaces checked, one producer (helper) with named consumers.

## Progress
- [x] Task 1: BDD helper + spec index
- [x] Task 2: Phase A scenarios (7/7 green)
- [x] Task 3: Phase B scenarios (11/11 green after one test-expectation fix)
- [x] Task 4: Playwright setup + browser specs (4/4 green)
- [x] Task 5: full validation + review

## Evidence (final)
- `npm test`: 718/718 pass (includes 18 new BDD scenarios).
- `npx playwright test`: 4/4 pass (demo mode, Meta keys blanked).
- `npm run lint`, `npm run typecheck`, `npm run build`: all exit 0.
- No production code changed by this pass: additive tests/config only
  (`tests/bdd-*.test.mjs`, `tests/bdd-helper.mjs`, `e2e/`,
  `playwright.config.mjs`, `test:e2e` + lint coverage in `package.json`).
  Pre-existing working-tree modifications were left untouched.

## Final review (self-review — no fresh reviewer dispatched)
- Scope check: every scenario maps to a plan journey; no unrelated edits.
- Risk check: new files only; the one config change (lint script) was itself
  verified by `npm run lint` exit 0.
- Deferred minors: pytest never triggered (no sidecar-internal defect);
  Playwright runs Chromium only (single-browser gate, documented in config).

## Phase C (most-used paths) + suite-stability fix
- Added `tests/bdd-phase-c.test.mjs` (6 scenarios): website ingest validation,
  ask-a-theory, recheck history growth, delete, history filters, enabled-accounts
  journey. 6/6 green; assess "judged claim" wording verified by probe
  (demo verdict `Unverifiable`) and asserted strictly.
- Found real flake: full suite intermittently failed in pre-existing
  `store.test.mjs` (file-lock timeout) and `document-manage.test.mjs`
  (cross-talk assertion) — both share `data/documents.json` across parallel
  processes while every other file isolates. Evidence: base-only 700/700 twice;
  with BDD files 1–2 fails across runs.
- Fixed at root cause: per-file tmp-store isolation headers in both files
  (repo precedent: `integration.test.mjs`), plus Playwright global setup with
  an isolated e2e store so browser runs stop polluting dev data. Full suite
  724/724 twice after (~20s, down from ~32s of lock waiting).
- Ruling: did not delete the bloated dev `data/documents.json` (gitignored,
  not mine to purge); isolation makes its size irrelevant to the suite.

## Phase D + shared-store flake hunt
- Phase D (`tests/bdd-phase-d.test.mjs`, 5/5): standard-user pipeline paths —
  demo trio, Misleading/Outdated, journalist export, repeat-check grouping,
  compound input. Demo verdicts probed before locking (Great Wall Misleading,
  Pluto Outdated, Apollo Supported, compound Partially supported).
- Flake hunt: full suite intermittently failed in pre-existing tests sharing
  `data/documents.json` (lock timeouts, cross-talk). Base-only runs green;
  failures appeared only under full parallel load. Fixed by isolating the
  remaining writers (`store`, `document-manage`, `guard`, `impact`,
  `website` test files) with per-file tmp stores — repo precedent, no product
  code touched. Full suite 729/729 twice after (~19s, down from ~32s).
- Ruling: `patterns.test.mjs` only imports (never calls) `createDocument`,
  so it needed no header; verified by grep before skipping it.

## Deferred minors cleared (independent reviewer items 7–10)
- Helper failures now re-throw with the Given/When/Then steps attached.
- Ledger pre-flight contract corrected (helper exports exactly
  `givenWhenThen` + `jsonReq`; isolation lives in scenario files).
- Playwright webServer uses `npx next dev -p 3300` (single `-p`); boot
  verified by passing specs.
- Stream test asserts replayed `historyClaimId`/`historyDocId` equal the
  first run's — proving no second investigation. 18/18 + 729/729 green.

## Fix pass (independent reviewer, 6 Important findings)
- Fixed: persistence assertion was vacuous (`[]` is truthy) — now verifies the
  doc's own claim through its route, asserts the verdict survives reload, and
  asserts `entries.length >= 1` strictly. 7/7 green after.
- Fixed: upload-validation scenario now asserts document count unchanged.
- Fixed: browser verify scenario now asserts a rendered `[data-evidence-card]`,
  matching its "with cited evidence" Then.
- Fixed: spec/file drift in `loop/bdd-spec.md` (8 bullets, 7 scenarios) —
  verification + citations merged into one bullet.
- Fixed: CI gap — new `e2e` job in `.github/workflows/ci.yml` installs
  Chromium and runs `npm run test:e2e` (YAML validated).
- Red-green record: genuine product bugs were not found (every challenged
  behavior proved correct on investigation). Documented red→green instances:
  missing helper import error → helper created; triage assertion failure →
  root-caused to classifier contract, scenario corrected with ruling; 4/4
  browser failures → foreign server on 3100 (port 3300 + no-reuse fix),
  tab-gated ingest (Check-a-excerpt first), history-vs-dossier table confusion
  (dossier path). Each fix re-ran green.
- Final: Ruling: reviewer minors 7–10 (helper step context, stale contract
  line, duplicate `-p` flag reliance, stream-test naming) deferred as polish;
  none affects scenario honesty or gates.

## Rulings
- Ruling: triage scenario used a sentence outside the product OPINION contract
  ("best ..." without "ever"); fixed the scenario to an in-contract opinion
  ("I think ... best ever ...") instead of widening `classifyClaim` — widening
  the regex would risk misclassifying factual comparatives. Cost if wrong: an
  opinion phrasing the classifier misses still gets researched rather than
  short-circuited; the verify pipeline then judges it on evidence.
- Ruling: pytest not added — no sidecar-internal defect surfaced, so the
  on-demand gate never triggered. Sidecar contract stays covered from Node.
  Cost if wrong: a future Python-internal bug needs a new `services/test_*.py`
  file at that time.
- Ruling: Playwright `webServer` blanks `META_MODEL_API_URL/KEY` so browser
  runs stay in demo mode (zero live credits) even though `.env.local` holds keys.
