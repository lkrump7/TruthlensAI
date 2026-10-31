# TruthLens AI

Don't just read information. Investigate it, challenge it, and discover the evidence behind it.

An evidence-verification app for the Meta Global AI Developer Hackathon 2026. Paste or dictate a claim, upload a book, or give it a website, and TruthLens extracts and preserves every claim, automatically verifies the 20 most significant in the background, and lets you investigate the rest yourself: verify any claim on demand, submit your own claims and theories in your own words (checked against the book's passages and against independent evidence), and challenge any verdict with a recorded follow-up investigation. Every verdict cites only fetched passages — or is an honest `Unverifiable`.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000 in your browser.

Production: `npm run build && npm start`. Tests: `npm test` (328 tests, `node --test`), `npm run typecheck`, `npm run lint`, `npm run coverage`, `npm run eval` (live evaluation, needs the Meta key).
Release check: `node eval/live-arc.mjs` runs the three demo claims live and passes only when each verdict matches the demo arc (needs the Meta key, exits 1 without one). Run it before a release. It is not part of `npm test`.

Full stack with Postgres + FAISS + OCR sidecar: `docker compose up --build`, then open http://localhost:3000.
Local sidecar without Docker: `.venv/bin/python services/sidecar.py 8100` and set `FAISS_SERVICE_URL=http://127.0.0.1:8100`.
Postgres instead of the file store: set `DATABASE_URL` (schema is created automatically; verified against a real Postgres in this session).
Accounts are off by default: no sign-in is shown, and everyone uses the shared workspace with full capability — nothing is gated behind an account. To enable accounts, set `AUTH_ENABLED=true` and `AUTH_SECRET` (scrypt-hashed passwords, signed session cookie, owner-scoped documents).

## Demo script (2 minutes)

TruthLens is built first for researchers and journalists who need to check a claim before they publish or build on it. Truth seekers, lifelong learners, students, and nonfiction readers use the same workspace.

1. Open the seeded book, *The Mind, Examined*. It reads as a draft under fact-check. Its claims carry verdict stamps, and page 3 holds a planted prompt injection that never becomes a claim. The document card reports the quarantine.
2. Check `Water boils at 100 degrees Celsius at sea level.` Watch the stages run in order. The verdict is **Supported**, with the fetched passage cited.
3. Check `Humans only use 10% of their brains.` The verdict is **Contradicted**. Two independent sources push back, the challenge round is on record, and the verdict view shows how many times the claim was judged on the same evidence and whether the runs agreed.
4. Check `The village of Upper Snelgrove brewed exactly 41 barrels of ale in March 1731.` The verdict is **Unverifiable**. Nothing fetched could test it, and the app says so instead of guessing.
5. Download the report for the Contradicted claim. It carries the claim, the verdict, the passages with their addresses, the run count, and the limits. A journalist can attach it to a story file. A researcher can cite it in working notes.

One run of a language model is a sample, not a measurement. TruthLens does not promise the same verdict on every run. It promises the evidence, the citations, the disagreement, and the abstention are inspectable every time.

## How a claim gets checked

When you submit a claim, TruthLens works through five steps. The labels below are the technical names; you don't need them to use the app.

1. **Pull out the claims** (`Spark extracts`). The claim you typed — or every claim in a document you uploaded — is pulled out and kept as-is, so nothing is quietly reworded before checking.
2. **Find the evidence** (`Vector index retrieves`). TruthLens searches for sources on both sides, fetches the pages itself, and keeps only passages it actually read. Search results alone are never cited.
3. **Screen out hidden instructions** (`Prompt Guard screens`). Books and web pages sometimes contain text written as instructions for an AI rather than as content. That text is set aside before any judging happens, and the document card tells you when pages were cleaned this way.
4. **Argue both sides** (`Advocate vs Skeptic`). Before a verdict, the evidence is tested from two angles: the strongest case for the claim, and the strongest case against it. If the two judges disagree, the disagreement is shown on the verdict instead of being hidden.
5. **Decide** (`Wonder judges`). A final judge weighs only the fetched passages and returns a verdict — Supported, Contradicted, Partially supported, Misleading, Outdated, or Unverifiable — with the passages listed so you can read them yourself.

## Meta AI tool usage

Meta models do the judging in this app, not just the coding. Every Meta touchpoint:

| Meta tool | Where it runs | What it does |
|---|---|---|
| Muse Voice Transcribe (`muse-voice-transcribe-1.0`) | [lib/voice.mjs](lib/voice.mjs), [app/api/transcribe/route.js](app/api/transcribe/route.js) | Voice dictation for claims and theories. The browser records a short clip and encodes mono WAV at 24 kHz; the server calls the transcribe endpoint with the key kept server side. No transcript is produced when Meta is not configured |
| Muse Spark 1.3 (`muse-spark-1.3`) | [lib/meta.mjs](lib/meta.mjs), [lib/search.mjs](lib/search.mjs), [lib/ocr.mjs](lib/ocr.mjs) | Claim research queries, routine Evidence Judge, Adversarial Self-Correction challenger, scanned-page transcription |
| Muse Spark 1.3 vision (`muse-spark-1.3`) | [lib/caption.mjs](lib/caption.mjs), [lib/video.mjs](lib/video.mjs), [app/api/documents/image/route.js](app/api/documents/image/route.js) | Image captions and video frame captions. The caption becomes the document text, so its claims are extracted and checked like a book's |
| Muse Voice Transcribe (`muse-voice-transcribe-1.0`) + ffmpeg | [lib/video.mjs](lib/video.mjs), [app/api/documents/video/route.js](app/api/documents/video/route.js) | Video transcripts. ffmpeg splits speech into 50-second WAV chunks for transcription and samples one frame every 10 seconds for Spark captions; both merge into timestamped pages |
| Muse Wonder (`muse-wonder-1.0`) | [lib/pipeline.mjs](lib/pipeline.mjs) | Escalated final judge for Contradicted / Partially supported / Misleading / Outdated verdicts and challenged revisions |
| Meta Model API | [lib/meta.mjs](lib/meta.mjs) | Single transport for both models: chat completions for judging, Responses API with `web_search` for search grounding |
| Meta search grounding | [lib/search.mjs](lib/search.mjs) | Finds supporting, contradicting, and primary sources per claim. Results are leads only — TruthLens fetches every page itself and cites only fetched passages |
| FAISS (Meta AI) | [services/sidecar.py](services/sidecar.py), [lib/rank.mjs](lib/rank.mjs) | Python `faiss.IndexFlatIP` sidecar ranks evidence semantically; in-process exact-cosine backend behind the same contract when no sidecar runs |
| Prompt Guard-style screening | [lib/screen.mjs](lib/screen.mjs) | Local injection screening quarantines prompt-injection text in books and fetched pages before it reaches a model. Honest note: this is a local Meta-pattern implementation, not hosted Prompt Guard 2 |
| Prompt design | [lib/prompts.mjs](lib/prompts.mjs) | Every model prompt in one place: judge, challenger, author-stance, and OCR. Plain English, silent step-by-step working, verdict definitions, a passage-injection guard, and one worked example per prompt. Output stays structured JSON, never free-form reasoning text |
| Muse Code (`muse-wonder-1.0`) | Development | This codebase was built, tested, reviewed, and bug-hunted with Muse Code. See [docs/PROVENANCE.md](docs/PROVENANCE.md) |

Model names are configurable: `META_SPARK_MODEL`, `META_WONDER_MODEL`. Without a Meta key the app runs a clearly labelled demo engine — it never presents demo verdicts as live.

## Agentic workflow (LangGraph)

Investigations run as a LangGraph JS workflow in [graph.mjs](lib/graph.mjs): `triage → research → judge → gates → challenge → assemble`, orchestrating the stage functions in [stages.mjs](lib/stages.mjs). The graph adds in-process checkpointed state (per-thread, via LangGraph's `MemorySaver` — checkpoints do not survive a server restart and no resume endpoint is exposed yet), conditional short-circuits (opinions stop at triage, empty research abstains), and a recorded `trajectory` on every verdict showing which nodes ran. Decomposition, compound roll-up, and all verdict logic are unchanged — LangGraph manages the workflow; Meta models do the research and judging. No Python rewrite, no Jev, no additional providers.

## Proof of work

Development timeline, verification log, and how to reproduce the checks: [docs/PROVENANCE.md](docs/PROVENANCE.md). Core principles: [docs/PRINCIPLES.md](docs/PRINCIPLES.md).

## Live Meta mode

Set `META_MODEL_API_URL` and `META_MODEL_API_KEY` in `.env.local` (copy `.env.example`). The verify route then researches and judges live and marks responses `live`. If live research fails, the claim is left `Unverifiable` with mode `live-failed` — there is no canned fallback and no state where a demo verdict is labelled live. Without keys the app labels demo mode on screen.

## Known limits of this build

- Website sources take one public URL at a time (`POST /api/documents/url`). The page is fetched with the same guarded fetcher used for evidence, stripped to readable text locally, and stored as a website document with its address on the card. Meta search grounding finds pages; it does not supply the document text, because snippets are leads and only fetched passages count. Pages with too little readable text are rejected with 422.
- Voice dictation needs a Meta key. Without one the transcribe route returns 503 and the page tells the reader to type instead.
- Document upload takes pasted text (pages separated by `--- page ---`) or a file: PDF with a text layer (extracted by `lib/pdf.mjs`, 15 MB cap). Scanned PDFs use OCR when the sidecar and Meta vision are configured; otherwise the upload is honestly rejected with 422.
- Image upload (PNG/JPEG/WebP/GIF, 10 MB cap) needs a Meta key: Muse Spark writes the caption and the caption is checked as a one-page document. Without a key the route returns 503 and no caption is invented.
- Video upload (MP4/MOV/WebM/MKV, 100 MB and 10 minutes cap) needs a Meta key and ffmpeg on the server. Speech and frame captions merge into timestamped pages. A silent video still becomes a document from its frames alone; a video with neither speech nor readable frames is rejected with 422.
- Documents persist to `data/documents.json`, or to Postgres when `DATABASE_URL` is set. Accounts and owner-scoping are in; no jobs queue and no single 0–100 truth score — deliberate: the Evidence Intelligence Report shows coverage and high-impact disputed claims instead.
- In live mode the judge sees only passages fetched from the live web for that claim; if none survive fetching, relevance, and screening, the result is `Unverifiable`. The curated corpus is used only in demo mode.
