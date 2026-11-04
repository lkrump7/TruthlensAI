#!/usr/bin/env bash
set -euo pipefail

WITH_SIDECAR=0
for arg in "$@"; do
  case "$arg" in
    --with-sidecar) WITH_SIDECAR=1 ;;
    -h|--help)
      echo "Usage: ./setup.sh [--with-sidecar]"
      echo "Default sets up Node, env file, and data dirs. Add --with-sidecar to install the Python FAISS sidecar into .venv."
      exit 0
      ;;
    *) echo "Unknown option: $arg (try --help)" >&2; exit 1 ;;
  esac
done

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing $1. Install it first, then rerun ./setup.sh." >&2; exit 1; }
}

need node
need npm

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node 22 or newer is required. Found $(node -v)." >&2
  exit 1
fi

echo "Installing JS deps..."
if [ -f package-lock.json ]; then
  npm ci || npm install
else
  npm install
fi

if [ ! -f .env.local ]; then
  cp .env.example .env.local
  echo "Created .env.local from .env.example. Demo mode works as is."
else
  echo ".env.local already exists, leaving it alone."
fi

mkdir -p data/faiss data/media data/sources
touch data/documents.json 2>/dev/null || true
echo "Data dirs ready under ./data."

if [ "$WITH_SIDECAR" -eq 1 ]; then
  need python3
  if [ ! -d .venv ]; then
    echo "Creating project env in ./.venv..."
    python3 -m venv .venv
  fi
  echo "Installing sidecar deps into ./.venv (this takes a while)..."
  ./.venv/bin/python -m pip install --upgrade pip
  ./.venv/bin/python -m pip install -r services-requirements.txt
  echo "Sidecar ready. Start it with: source .venv/bin/activate && python services/sidecar.py 8100"
else
  echo "Skipping Python sidecar. The app uses the built-in fallback until you need it."
fi

echo ""
echo "Done. Next steps:"
echo "  1. npm run dev  (open http://localhost:3000)"
echo "  2. For live checks, put your Meta key in .env.local, then npm test"
echo "  3. Full guide: see SETUP.md"
