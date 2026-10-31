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
