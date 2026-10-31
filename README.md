# TruthLens AI

Don't just read information. Investigate it, challenge it, and discover the evidence behind it.

An evidence-verification app for the Meta Global AI Developer Hackathon 2026. Paste a claim, or upload a book, and TruthLens extracts and preserves every claim, automatically verifies the 20 most significant in the background, and lets you investigate the rest yourself: verify any claim on demand, submit your own claims and theories in your own words (checked against the book's passages and against independent evidence), and challenge any verdict with a recorded follow-up investigation. Every verdict cites only fetched passages — or is an honest `Unverifiable`.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:3000 in your browser.

Production: `npm run build && npm start`. Tests: `npm test` (234 tests, `node --test`), `npm run typecheck`, `npm run lint`, `npm run coverage`, `npm run eval` (live evaluation, needs the Meta key).

Full stack with Postgres + FAISS + OCR sidecar: `docker compose up --build`, then open http://localhost:3000.
Local sidecar without Docker: `.venv/bin/python services/sidecar.py 8100` and set `FAISS_SERVICE_URL=http://127.0.0.1:8100`.
Postgres instead of the file store: set `DATABASE_URL` (schema is created automatically; verified against a real Postgres in this session).
Accounts: register/sign-in in the header (scrypt-hashed passwords, signed session cookie, owner-scoped documents). Set `AUTH_SECRET` in production.

## Demo script (2 minutes)

1. The seeded book, *The Mind, Examined*, is already loaded. Its claims show verdict stamps and evidence coverage.
2. Open “Humans only use 10% of their brains.” The verdict is **Contradicted**, judged by Muse Wonder, with the fetched passages on the right.
3. Page 3 of the demo book contains a planted prompt injection. It never becomes a claim; the document card reports the quarantine.
4. Type a fresh claim in “Verify a claim” — for example `Water boils at 100 degrees Celsius at sea level.` — and run it through the same engine.

## Meta AI tool usage

Meta models do the judging in this app, not just the coding. Every Meta touchpoint:

| Meta tool | Where it runs | What it does |
|---|---|---|
| Muse Spark 1.3 (`muse-spark-1.3`) | [lib/meta.mjs](lib/meta.mjs), [lib/search.mjs](lib/search.mjs), [lib/ocr.mjs](lib/ocr.mjs) | Claim research queries, routine Evidence Judge, Adversarial Self-Correction challenger, scanned-page transcription |
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

- Document upload takes pasted text (pages separated by `--- page ---`) or a file: PDF with a text layer (extracted by `lib/pdf.mjs`, 15 MB cap). Scanned PDFs use OCR when the sidecar and Meta vision are configured; otherwise the upload is honestly rejected with 422.
- Documents persist to `data/documents.json`, or to Postgres when `DATABASE_URL` is set. Accounts and owner-scoping are in; no jobs queue and no single 0–100 truth score — deliberate: the Evidence Intelligence Report shows coverage and high-impact disputed claims instead.
- In live mode the judge sees only passages fetched from the live web for that claim; if none survive fetching, relevance, and screening, the result is `Unverifiable`. The curated corpus is used only in demo mode.
