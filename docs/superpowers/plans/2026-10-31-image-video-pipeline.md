# Image/Video Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Image uploads become captioned documents and video uploads become transcribed documents, both feeding the existing claim-verification pipeline.

**Architecture:** `MetaClient.vision()` adds multimodal chat completions next to the text path. `lib/caption.mjs` captions one image with Muse Spark. `lib/video.mjs` uses ffmpeg to split audio (≤50 s WAV chunks → `transcribeAudio` from `lib/voice.mjs`, timestamps offset per chunk) and sample frames (→ `captionImage`), then assembles one page per time window. Two new routes mirror `app/api/documents/pdf/route.js`; `createDocument` learns `kind: 'image'|'video'` plus a stored `media` summary.

**Tech Stack:** Next 14 routes, Node `node:test`, ffmpeg/ffprobe (system binary), Meta Model API (`muse-spark-1.3`, `muse-voice-transcribe-1.0`).

**Spec:** [2026-10-31-image-video-pipeline-design.md](/home/magwaza/TruthlensAI/docs/superpowers/specs/2026-10-31-image-video-pipeline-design.md)

## Global Constraints

- No Meta key → 503, no invented caption/transcript (matches `lib/voice.mjs`).
- Model failure → 502 at the route; empty extraction → 422.
- Image: ≤10 MB, png/jpeg/webp/gif. Video: ≤100 MB, ≤600 s.
- Audio chunk 50 s; frames ≤12 at 1 per 10 s, width ≤1024 px.
- Every task is TDD: failing test, red, minimal green, suite green.

## Review Focus

- Silent video (no audio stream): expect frames-only pages, not an error — test in Task 3.
- Oversize / wrong-type upload: expect 413 / 400 before any model call — test in Task 5.
- Caption with no text (model returns blank): expect 422, no document stored — test in Task 5.
- Long video chunk timestamps drift: turn `startMs` must be offset by chunk start — test in Task 3.
- Prompt-injection text inside an image caption: downstream `screenContent` quarantine already handles it; no new code, noted only.

---

### Task 1: Spark vision in MetaClient + caption prompts

**Files:**
- Modify: `lib/meta.mjs` (add `vision()`), `lib/prompts.mjs` (add `CAPTION_SYSTEM`, `CAPTION_INSTRUCTION`, `frameCaptionInstruction(atSec)`)
- Test: `tests/caption.test.mjs` (vision request shape), extend `tests/prompts.test.mjs` only if it enumerates exports

**Interfaces:**
- Produces: `MetaClient.vision({ imageBase64, mime?, system, instruction, model? }) -> Promise<string>` posting `image_url: data:<mime>;base64,...` via the existing `#complete`-style breaker/limiter/retry path; throws `MetaApiError` when unconfigured or on non-OK.

- [ ] Write failing test: fake `fetchImpl` captures body; assert model defaults to spark, message content is `[text, image_url]`, returned content string passes through.
- [ ] Run `node --test tests/caption.test.mjs` — RED (no `vision`).
- [ ] Implement prompts + `vision()` (generalize `#complete` to accept full `messages` — it already does).
- [ ] GREEN; run `node --test tests/meta.test.mjs tests/prompts.test.mjs`.

### Task 2: `lib/caption.mjs`

**Files:**
- Create: `lib/caption.mjs`
- Test: `tests/caption.test.mjs`

**Interfaces:**
- Consumes: `MetaClient.vision` (Task 1).
- Produces: `captionImage(bytes, { mime, env, fetchImpl, visionImpl }) -> Promise<string>`; `IMAGE_MIME_BY_EXT`, `MAX_IMAGE_BYTES = 10 MB`; rejects empty/oversize/unsupported with clear errors.

- [ ] Failing tests: base64 + mime forwarded, blank caption rejected, oversize rejected before any fetch, unconfigured rejects `/not configured/`.
- [ ] RED, implement, GREEN.

### Task 3: `lib/video.mjs`

**Files:**
- Create: `lib/video.mjs`
- Test: `tests/video.test.mjs`

**Interfaces:**
- Produces (pure): `planChunks(durationSec, chunkSec=50) -> [{startSec,endSec}]`, `planFrameTimes(durationSec, intervalSec=10, maxFrames=12) -> number[]`, `formatTimestamp(sec) -> "mm:ss"`, `assembleVideoPages({ chunks:[{startSec,endSec,transcript}], frames:[{atSec,caption}] }) -> [{page,text}]` (one page per chunk window; frames with no chunk still form a page; empty everything → `[]`).
- Produces (IO): `videoToPages(buffer, { transcribeChunk, captionFrame, probe, extractAudio, extractFrames, tmpDir })` — all collaborators injectable; defaults use `execFile` ffmpeg/ffprobe in a temp dir that is always removed. Turn timestamps offset by chunk start.

- [ ] Failing tests for pure helpers (chunk plan edges: 0 s, exact 50 s, 121 s; frame cap; timestamp format; assembly merges speech+visual, frames-only page).
- [ ] RED, implement pure helpers, GREEN.
- [ ] Failing test: `videoToPages` with injected fakes — asserts chunk order, timestamp offset, temp cleanup not required (fakes), frames captioned once each.
- [ ] Implement ffmpeg defaults; smoke with a generated 3 s test video in verification (not a unit test).

### Task 4: `createDocument` kinds

**Files:**
- Modify: `lib/documents.mjs` (`createDocument`)
- Test: `tests/media-documents.test.mjs`

**Interfaces:**
- `createDocument({ ..., kind: 'excerpt'|'website'|'image'|'video', sourceUrl?, media? })` stores `kind` verbatim for the four known kinds (unknown → `excerpt`), stores `media` when given. Existing website behavior unchanged.

- [ ] Failing test: image doc keeps `kind:'image'` and `media.caption`; video doc keeps `kind:'video'`; default stays `excerpt`.
- [ ] RED, implement (replace the website ternary with a known-kinds set), GREEN with `tests/reader.test.mjs tests/integration.test.mjs`.

### Task 5: Routes

**Files:**
- Create: `app/api/documents/image/route.js`, `app/api/documents/video/route.js`
- Test: `tests/media-documents.test.mjs` (route-level, Meta unconfigured)

**Interfaces:**
- `POST /api/documents/image`: multipart `file` → 400 missing, 413 oversize, 400 bad type, 503 unconfigured, 502 model failure, 422 blank caption; success → `createDocument(kind:'image', media:{caption, model})`, same response shape as the PDF route.
- `POST /api/documents/video`: same contract; 422 when no speech and no frames; success stores `media:{durationSec, model, voiceModel}`.

- [ ] Failing route tests (no file → 400; with file but no Meta env → 503 and no document created).
- [ ] RED, implement mirroring `app/api/documents/pdf/route.js`, GREEN.

### Task 6: UI + docs

**Files:**
- Modify: `app/page.js` (upload routes image/video by extension, accept list, kind labels on cards and detail, caption/transcript note from `doc.media`), `README.md` (Meta table rows + limits), `.env.example` (comment only — no new vars)
- Test: `tests/ui.test.mjs` patterns if it asserts upload copy — check before editing.

- [ ] Extend `uploadFile`: image exts → `/api/documents/image`, video exts → `/api/documents/video`.
- [ ] Kind labels: `Image · caption by Muse Spark` / `Video · transcript by Muse Voice Transcribe` instead of "Excerpt or pasted document".
- [ ] Run UI tests.

### Task 7: Verification

- [ ] `npm test`, `npm run typecheck`, `npm run lint` — all green.
- [ ] ffmpeg smoke: generate 3 s `testsrc` + sine video in `/tmp`, run `videoToPages` with stubbed Meta — pages come back timestamped.
- [ ] If a Meta key is configured: live caption one generated PNG and report the real caption; otherwise state live mode is unverified.
