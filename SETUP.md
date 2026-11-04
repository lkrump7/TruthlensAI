# Setup

The short path works on a fresh clone. I use it myself after wiping node_modules.

## What you need

You need Node 22 and npm. Docker and Python are optional, only for the full stack pieces further down.

Check yours with:

```bash
node -v
npm -v
```

## Quick start

Run this from the repo root:

```bash
./setup.sh
npm run dev
```

Open http://localhost:3000 in your browser. You get the demo engine right away, no keys needed. It labels demo mode on screen so you never mistake it for a live check.

What the script does:

- Installs JS deps with `npm ci`, falls back to `npm install` when the lockfile is missing.
- Copies `.env.example` to `.env.local` when you do not have one yet. It never overwrites yours.
- Creates `./data/faiss`, `./data/media`, and `./data/sources` so file storage works.
- Skips the Python sidecar by default. The app uses its built-in rank fallback until you ask for more.

## Live checks with a Meta key

Demo mode is fine for clicks. For real verdicts you need a key.

1. Open `.env.local`.
2. Set `META_MODEL_API_URL` and `META_MODEL_API_KEY`.
3. Restart `npm run dev`.

Verify it with one cheap claim first. Water boils is a good pick, it stays on Spark and skips Wonder. Keep `stabilityRuns: 1` and a single sentence while you test so you spend almost nothing. The repo memory file has the full credit-saving order if you want it.

Without keys the app stays in demo mode. Live research that fails leaves the claim `Unverifiable` with mode `live-failed`. It never passes off a demo verdict as live.

## Checks that prove it works

```bash
npm test
npm run typecheck
npm run lint
npm run eval
```

`npm test` runs the offline suite with `node --test` and needs no key. `npm run eval` and `node eval/live-arc.mjs` need the Meta key and spend credits, so save them for last.

## Full stack with Docker

You want this when you need Postgres plus the sidecar without local installs.

```bash
# set these first, compose requires them
export POSTGRES_PASSWORD="a-local-password"
export AUTH_SECRET="a-long-random-string"
export META_MODEL_API_KEY="your-key-or-empty-for-demo"
docker compose up --build
```

Then open http://localhost:3000. Postgres stores documents, the sidecar serves FAISS at port 8100.

## Local sidecar without Docker

You want this when you need semantic rank or OCR locally and do not want Docker.

```bash
./setup.sh --with-sidecar
source .venv/bin/activate
python services/sidecar.py 8100
```

In another shell, set `FAISS_SERVICE_URL=http://127.0.0.1:8100` in `.env.local` and restart `npm run dev`. Without the sidecar or model weights the guard endpoint answers 503 and the regex screen stands alone, which is expected.

## Accounts and storage

Accounts stay off by default. Everyone shares the open workspace. To turn them on, set `AUTH_ENABLED=true` and `AUTH_SECRET` in `.env.local`.

Storage stays in `data/documents.json` unless you set `DATABASE_URL`. The schema creates itself on first connect.

## When it breaks

- Node version error. Install Node 22, then rerun `./setup.sh`.
- `.env.local` confusion. Plain `node` does not load it, only the Next server does. A `liveStatus().configured === false` from plain node is normal.
- Sidecar install is slow. That is torch and sentence-transformers. Let it finish, or skip it and use the default path.
- Port 3000 busy. Stop the other dev server or run `npm run dev -- -p 3001`.
