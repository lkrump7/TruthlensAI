# Loop — Frontend Audit Remediation

Comprehensive fix pass for the full frontend audit. All changes are TDD with
maintained regression coverage in `tests/loop-fixes.test.mjs`.

## Scope

Repo: Next 14.2.5 + React 18.3.1 App Router at repo root.
Audit covered `app/`, `lib/ui-state.mjs`, API validation, styling/a11y,
perf/security, tests/CI. This pass closes every actionable gap except
live-browser measurement.

## Test list

- [x] txt/md client size cap
- [x] viewer iframe sandbox
- [x] App Router error/loading/not-found boundaries
- [x] vault card button semantics
- [x] images lazy + dimensions
- [x] layout head links + SEO/OG/manifest
- [x] modal described content
- [x] theme toggle no wrong-label flash
- [x] verdict en-US date pin
- [x] client 429 messaging
- [x] contra/auth retry errors, no silent `.catch(()=>{})` in page
- [x] security headers config
- [x] robots + manifest files
- [x] verify/batch server rate limits
- [x] challenge suggestion error UI

## Red → Green evidence

Red: `node --test tests/loop-fixes.test.mjs` failed first on
`uploadSizeError({name:'notes.txt'})` returning `null` instead of the
new 15 MB cap, plus missing sandbox, boundaries, roles, lazy, head,
describedby, locale, 429, headers, robots/manifest.

Green after fixes: focused file passes 13/13.
Full suite: 677/677 pass.
`npm run lint` exit 0. `npm run typecheck` exit 0.
`npm run build` exit 0: `/` 44.2 kB / First Load 131 kB, shared 87.2 kB.

## Changes

### Upload limits — `lib/ui-state.mjs`, `tests/ui-state.test.mjs`

Added txt/md/markdown to `UPLOAD_LIMITS` at 15 MB. This matches the UI copy
that already advertises TXT/MD and closes the null-cap gap where a 500 MB
text file passed client validation.

Updated the old expectation that text files have no client cap. Server char
limits still enforce pasted text via `CONFIG.MAX_DOCUMENT_CHARS`.

### Iframes — `app/page.js`

PDF viewer: `sandbox="allow-same-origin"`, lazy, no-referrer.
Website viewer: `sandbox="allow-same-origin allow-scripts allow-popups"`.
Keeps same-origin PDF rendering and cross-origin site display while blocking
top navigation, forms, and plugins by default.

### Images — `app/page.js`

Brand logo: `decoding="async"` + explicit 40x40 to cut CLS.
Persona + viewer images: `loading="lazy"` + `decoding="async"` + dimensions.
First paint no longer waits on below-fold mockups.

### Vault semantics — `app/page.js`

Vault card `article` now has `role="button"`. Keyboard Enter/Space already
worked. Inner inspect/view/remove buttons keep `stopPropagation`.

### Silent failures — `app/page.js`, `app/components/challenge.js`

- Contradictions fetch now sets `contraErr` with a Retry button.
- Auth status failure surfaces `setErr` with reload guidance.
- Polling/EventSource keep last-good-list behavior but no longer use bare
  empty catches in page scope.
- `SuggestedNext` tracks `error` and renders retry guidance instead of
  silently resetting to empty.

### Rate limits — client + server

Client: auth, single verify, and batch verify now check `r.status === 429`
and show "Too many ..." retry copy instead of generic failure.

Server: `app/api/verify/route.js` allows 30/min per IP.
`app/api/verify/batch/route.js` allows 20/min per IP.
Auth keeps its existing 10/15min gate. All return 429 JSON.

### Layout/SEO — `app/layout.js`

Moved font `<link>` tags from `<body>` to `<head>`. Added `openGraph`,
`twitter`, `manifest`, `robots`, viewport width/scale. Keeps static
`dangerouslySetInnerHTML` theme boot script. No new client JS.

### A11y details

- `app/components/modal.js`: new optional `describedBy` prop maps to
  `aria-describedby` without changing existing call sites.
- `app/components/theme-toggle.js`: pre-ready label is neutral "Theme" with
  `aria-pressed={false}`. No wrong dark/light flash before mount.
- `app/components/verdict.js`: history date pins `en-US` short format to
  match `lib/ui-state.mjs` and `book-dossier.js`.

### Route resilience — `app/error.js`, `app/loading.js`, `app/not-found.js`

New App Router boundaries. Thrown render errors now show Try again instead
of a blank page. Loading shows an aria-live status. Unknown routes show a
Library redirect hint.

### Security headers — `next.config.mjs`

New config adds `X-Content-Type-Options: nosniff`,
`Referrer-Policy: no-referrer`, `X-Frame-Options: SAMEORIGIN`,
`Permissions-Policy: microphone=(self), camera=(), geolocation=()`.
Viewer iframes inherit sandbox on top of this.

### Discoverability — `public/robots.txt`, `public/manifest.webmanifest`

Robots allows all with sitemap placeholder. Manifest wires name, icons,
start URL, theme color to the layout `manifest` field.

### CI — `.github/workflows/ci.yml`

Added `npm run build` after test/typecheck/lint so route boundary or
config regressions fail CI.

## Verification

Focused: `node --test tests/loop-fixes.test.mjs tests/ui-state.test.mjs`
→ 25/25 pass.

Full: `npm test` → 677/677 pass.
Lint: `npm run lint` → exit 0.
Typecheck: `npm run typecheck` → exit 0.
Build: `npm run build` → exit 0, `/` 44.2 kB / 131 kB First Load.

## Follow-up pass

- `verifyRateLimited` / `batchRateLimited` are now exported so the
  loop tests assert real limiter behavior (30 and 20 hit thresholds),
  not just header text. Review found the old test only grepped source.
- `public/mockup/img4.webp` added (19 KB vs 42 KB JPG) with the same
  `picture` pattern as the other personas.
- Static personas section extracted from `app/page.js` into
  `app/components/personas.js`, rendered as `<Personas />`.
  `tests/ui.test.mjs` aggregates the new file; output is unchanged.
- Two gate errors from the landed idempotency work fixed without
  behavior change: unused destructure renamed to `_h` in both verify
  routes, `Error & { code?: string }` cast in `lib/history.mjs`.
- Current gates: `tests/loop-fixes.test.mjs` 19/19, full suite 686/686,
  lint 0, typecheck 0, build 0.

## Beyond audit — still open

- Lighthouse scores need Chrome tooling, absent here. Run locally with
  `npx lighthouse http://localhost:3000 --view` after `npm run build`.
- The two ~1.5 MB mockup JPEGs still ship at full weight. Lazy helps, but
  compress to WebP/AVIF and add `next/image` with `sizes` for the real win.
- `app/page.js` is still a ~1440-line client monolith. Next split: extract
  vault, check, and viewer sections into components with `useMemo` filters.
- Python sidecar `services/` and live `eval/run.mjs` were out of scope for
  this frontend pass and remain unaudited for browser impact.
- In-memory verify/batch throttles reset on redeploy. Use Redis or headers
  `Retry-After` when abuse becomes real.

## How to re-run

`node --test tests/loop-fixes.test.mjs`
`npm test && npm run lint && npm run typecheck && npm run build`

## Continuation — sitemap, Retry-After, images, memo

New red: 4 tests failed (sitemap, Retry-After, webp, useMemo).
Green after fix: `tests/loop-fixes.test.mjs` 17/17 pass.

- `app/sitemap.js` added. `npm run build` now emits `/sitemap.xml`.
  Closes the dangling `Sitemap: /sitemap.xml` reference in robots.txt.
- 429s now send `Retry-After`: verify/batch `60`, auth `900`.
  Files: `app/api/verify/route.js`, `app/api/verify/batch/route.js`,
  `app/api/auth/route.js`. Client already shows "Too many ..." copy.
- Hero images: `ffmpeg -qscale:v 75` generated
  `public/mockup/researchers.webp` (1,493,847 → 66,716 bytes) and
  `public/mockup/students.webp` (1,509,991 → 64,764 bytes), ~95% smaller.
  `app/page.js` serves webp via `<picture>` with JPEG fallback, lazy,
  async decoding, fixed dimensions retained.
- `app/page.js` memoizes `realDocs`, `sortedVaultDocs`, `visibleClaims`,
  and website `scrutiny` with `useMemo`. No behavior change, fewer
  recomputes per keystroke/render.

Verification: focused 17/17 pass. Full `npm test` flaked once on
`tests/sidecar.test.mjs` namespace-reset tests under load (2 fails),
then passed 681/681 on rerun. Sidecar suite passes 6/6 alone.
`npm run lint` exit 0. `npm run typecheck` exit 0.
`npm run build` exit 0 with `/sitemap.xml` present.

Note: workspace tree was already dirty before this session (many
`M lib/*`, docs, env changes not made here). Sidecar flake tracks that
pre-existing load, not these frontend edits.

