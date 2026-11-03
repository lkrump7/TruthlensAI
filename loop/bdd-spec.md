# BDD Spec Index — TruthLensAI critical user journeys

Harness: `node:test` (`tests/bdd-helper.mjs` Given–When–Then wrapper over the
existing route-import pattern) + Playwright (`e2e/`) for browser-only flows.
No BDD framework dependency. pytest: none required — no sidecar-internal
defect surfaced; the sidecar contract (FAISS rank, `/guard` honest abstention)
is covered from Node in `tests/bdd-phase-b.test.mjs`.

## Phase A — `tests/bdd-phase-a.test.mjs` (7 scenarios)

- Book upload: pasted text creates a document with preserved claims.
- Book upload validation: empty/oversized text rejected, nothing created.
- Claim extraction: injection quarantined, never becomes a claim
  (`bookPassagesFor` offers no quarantined passage).
- Verification + citations: a known claim returns a decisive demo verdict
  whose cited passages are fetched and non-empty.
- Agent failure: research-backend failure stays `Unverifiable` / `live-failed`,
  never a demo verdict labelled live.
- Persistence: document + claims reload; history records the investigation.
- Report: `buildReport` partitions investigated/pending with no single score.

## Phase B — `tests/bdd-phase-b.test.mjs` (11 scenarios)

- Compound roll-up blocks decisive verdicts on any `Unverifiable` element.
- Triage short-circuits opinion to `Not fact-checkable` with zero research.
- Batch dedupes lines and caps at ten with the remainder in `dropped`.
- Stream + idempotency key replays the identical verdict.
- Contradictions surface opposing positions as unverified disagreement.
- Export downloads a markdown dossier naming claim + verdict.
- Transcribe without a Meta key is an explanatory 503, not silence.
- Per-claim verify/challenge routes: 200 / 400 on bad kind / 404 on unknown.
- Suggest returns local follow-ups in demo mode; 400 without a verdict.
- Guard without sidecar: regex still quarantines; sidecar layer abstains.
- Breaker fails fast when open; a probe after cooldown closes it.

## Phase C — `tests/bdd-phase-c.test.mjs` (6 scenarios, most-used paths)

- Website ingest: missing/unreachable addresses fail with guidance, no document.
- Ask-a-theory: empty/oversized/unknown rejected; a real question returns a
  judged claim.
- Recheck: a new evidence run appends one entry to claim history.
- Delete: removed documents leave reads and lists.
- History filters: verdict and text narrow past checks.
- Accounts: when enabled, registration gates libraries per owner.

## Phase D — `tests/bdd-phase-d.test.mjs` (5 scenarios, standard pipeline journey)

- Demo trio: Supported (Spark, cited passage, forensics+uncertainty),
  Contradicted (Wonder, two contradicting passages), Unverifiable Snelgrove
  (zero citations, honest explanation).
- Other verdicts: Misleading (Great Wall) and Outdated (Pluto, both eras named).
- Journalist export: checked claim downloads with verdict, passage, source address.
- Repeat checks: same claim twice folds into one history row, both runs counted.
- Compound input: two-part claim judged Partially supported with both-side citations.

## Browser — `e2e/bdd-journeys.spec.js` (4 scenarios, demo mode)

- Workspace loads with check tools usable.
- Verifying a known claim renders Contradicted with cited evidence.
- Pasted upload appears and survives reload.
- Export dossier downloads `truthlens-investigation.md`.

## Regression rule

Reproduce every critical bug as a failing scenario first (red), fix at the
root cause (green), keep the scenario. After each fix run the affected file
plus `tests/integration.test.mjs`; full `npm test` before closing.
