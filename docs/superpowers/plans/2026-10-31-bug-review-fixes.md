# Bug Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Fix every confirmed bug-hunt finding — PDF hex text, empty-citation verdicts, sidecar hardening, stance honesty, and the grouped minor issues — without weakening any existing truthfulness gate.

**Architecture:** Each phase is independently testable and lands in finding order. Pure-logic fixes stay in the modules that own them (`lib/pdf.mjs`, `lib/pipeline.mjs`, `lib/verdict.mjs`, `lib/evidence.mjs`, `lib/screen.mjs`); the Python sidecar is hardened at its request boundary. Existing public surfaces (`engine.mjs`, `research.mjs` barrels, API routes) do not change shape except for one additive field (`unclassified` on verdict results).

**Tech Stack:** Node 22 ESM, `node --test`, Next 14, Python 3.13 + FAISS sidecar, TypeScript `checkJs` gate.

**Spec:** The bug-hunt review delivered in-session (hypotheses table and severity-ranked findings), against the TruthLens product spec in the conversation.

## Global Constraints

- No verdict may be emitted with zero validated citations unless it is `Unverifiable` or `Not fact-checkable`.
- Judge-supplied stances are the only source of supporting/contradicting partitioning; unknown stance is never inferred from the verdict.
- All 62 existing tests keep passing; new behaviour is pinned by a failing test written first.
- `npm run typecheck` and `npm run build` stay green.
- No new runtime dependencies.
- The dev API key stays in `.env.local` only; nothing in this plan prints it.

## Review Focus

- A mainstream PDF whose text is hex-encoded inside TJ arrays — expected: claims extract without OCR.
- A judge returning a decisive verdict with `citedIds: []` — expected: `Unverifiable`, nothing cited.
- A judge omitting `stances` — expected: passages land in `unclassified`, never in supporting.
- A hostile sidecar namespace (`../`, separators, overlong) — expected: 400 JSON, no file written outside `data/faiss/`.
- A passage that legitimately discusses system prompts — expected: allowed, not quarantined.

---

### Phase 1: PDF hex-string decoding

**Files:**
- Modify: `lib/pdf.mjs` (`textFromContent`)
- Test: `tests/pdf.test.mjs`

**Interfaces:**
- Consumes: existing `extractPdfPages(buffer) -> [{page, text}]`.
- Produces: same signature; hex `<...>` strings inside `Tj`/`TJ` are decoded (latin1 bytes; UTF-16BE when the string starts with the FE FF BOM).

- [x] **Step 1: Write the failing test** — a content stream `BT /F1 12 Tf [<576174657220626f696c73>]TJ ET` yields a page whose text contains `Water boils`; a lone `<...>` `Tj` also decodes.
- [x] **Step 2: Run it** — `node --test tests/pdf.test.mjs` → FAIL (page count 0).
- [x] **Step 3: Implement** hex-token extraction beside the existing parenthesised-string extraction in `textFromContent`; ignore `<` `>` that belong to dictionaries by only scanning inside text-showing operators.
- [x] **Step 4: Run** `npm test` → PASS, including the PyMuPDF-generated fixture shape from the review.
- [x] **Step 5: Verify live** — regenerate the PyMuPDF PDF, run `extractPdfPages` on it, expect both sentences.

### Phase 2: Non-empty citation rule

**Files:**
- Modify: `lib/pipeline.mjs` (`verifyResearchedClaim`), `lib/verdict.mjs` (policy)
- Test: `tests/research.test.mjs`

**Interfaces:**
- Produces: `applyCitationGate(ctx)` in `lib/verdict.mjs` — if `ctx.cited` is empty and the verdict is not `Unverifiable`/`Not fact-checkable`, verdict becomes `Unverifiable` and a limitation records that the judge cited no evidence.

- [x] **Step 1: Write the failing test** — fake judge returns `Supported` with `citedIds: []`; expect final verdict `Unverifiable`, supporting/contradicting empty.
- [x] **Step 2: Run it** → FAIL (currently Partially supported with 0 citations).
- [x] **Step 3: Implement** `applyCitationGate`, applied in the pipeline before `applyGates`.
- [x] **Step 4: Run** `npm test` → PASS; demo-engine path untouched (it cites by construction).

### Phase 3: Sidecar hardening + duplicate vectors

**Files:**
- Modify: `services/sidecar.py` (`do_POST`, `load_index`, `save_index`), `lib/evidence.mjs` (namespace reset), `lib/faiss.mjs` (`add` gains options)
- Test: `tests/sidecar.test.mjs` (spawns `.venv/bin/python services/sidecar.py` on a test port; skipped if the venv is missing)

**Interfaces:**
- Sidecar `POST /faiss/add` accepts `{namespace, items, reset?: boolean}`; namespace must match `^[A-Za-z0-9_-]{1,64}$` else 400 JSON. All handler errors return JSON with a status code, never a dropped connection. Vector dimension mismatches return 400.
- `FaissClient.add(namespace, items, { reset })` forwards `reset`. Evidence ranking passes `reset: true` so a re-researched claim replaces, never duplicates, its vectors.

- [x] **Step 1: Write failing tests** — traversal namespace → 400 and no escaped file; dimension mismatch → 400 JSON; add-same-id-twice with the evidence reset flow → search returns the id once.
- [x] **Step 2: Run** `node --test tests/sidecar.test.mjs` → FAIL on all three.
- [x] **Step 3: Implement** namespace validation, try/except around `do_POST` returning JSON errors, dimension checks, `reset` handling; wire `reset: true` from evidence ranking.
- [x] **Step 4: Run** `npm test` → PASS. Probe artifacts from the review stay deleted.

### Phase 4: Stance honesty

**Files:**
- Modify: `lib/pipeline.mjs` (partitioning), `lib/verdict.mjs` typedefs, `app/page.js` (unclassified display)
- Test: `tests/research.test.mjs`

**Interfaces:**
- Verdict results gain `unclassified: Evidence[]` — cited passages whose stance the judge did not supply (or supplied as an unrecognised value). `supporting` = stance `supports` only; `contradicting` = `contradicts`/`misleading` only. The verdict-derived fallback in `stanceOf` is deleted.

- [x] **Step 1: Write the failing test** — judge cites a contradicting passage but omits `stances`; expect it in `unclassified`, not `supporting`.
- [x] **Step 2: Run it** → FAIL (currently partitioned by verdict).
- [x] **Step 3: Implement** strict partitioning, add `unclassified` through `makeVerdict` defaults, render it in `VerdictView` only when non-empty.
- [x] **Step 4: Run** `npm test` + `npm run build` → PASS.

### Phase 5: Minor issues as one grouped phase

**Files:**
- Modify: `lib/screen.mjs`, `lib/config.mjs`, `lib/evidence.mjs` (cache TTL), `app/api/verify/route.js`, `app/api/documents/route.js`
- Test: `tests/engine.test.mjs` (screener), `tests/research.test.mjs` (cache expiry)

**Interfaces:**
- Screener: the bare `/system prompt/i` rule is removed; `reveal (your)? system prompt` and the instruction-override rules remain.
- `CONFIG` gains `MAX_CLAIM_CHARS: 2000`, `MAX_DOCUMENT_CHARS: 200000`, `RESEARCH_CACHE_TTL_MS: 600000`. Verify route rejects claims over the cap with 413; documents route rejects pasted text over the cap with 413.
- Research cache entries carry a timestamp and expire after the TTL.
- DNS-rebinding TOCTOU: no code change accepted — the fetcher already validates resolved addresses; the residual risk stays documented in the README limitations. (Recorded decision, not a gap.)

- [x] **Step 1: Write failing tests** — a passage discussing system-prompt design is allowed; a cached research result older than the TTL is re-fetched (injectable clock via cache entry timestamp manipulation in test, or a short TTL override parameter).
- [x] **Step 2: Run** → FAIL.
- [x] **Step 3: Implement** screener rule change, caps in both routes, cache timestamps.
- [x] **Step 4: Run** `npm test` → PASS. The seeded injection page must still be quarantined (existing store tests pin this).

### Phase 6: Whole-branch verification

**Files:** none (verification only).

- [x] **Step 1:** `npm test` (expect all suites green), `npm run typecheck`, `npm run build`.
- [x] **Step 2:** Rebuild, restart the app with the sidecar, re-run the original review probes: PyMuPDF PDF upload, empty-citation claim path via evaluation harness, traversal attempt against the sidecar.
- [x] **Step 3:** `npm run eval` agreement must not regress below the previous 8/8 acceptable-set result; report the number actually observed.
