#!/usr/bin/env bash
# バックエンド（Python・FastAPI）とフロントエンド（Vite）をまとめて起動する
#   ./dev.sh  → http://localhost:5173 を開く（Ctrl+C で両方とも止まる）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"

cd "$ROOT/backend"
[ -d .venv ] || python3 -m venv .venv
.venv/bin/pip install -q -r requirements.txt
ENV_ARGS=()
[ -f .env ] && ENV_ARGS=(--env-file .env)
.venv/bin/uvicorn app.main:app --port 8000 ${ENV_ARGS[@]+"${ENV_ARGS[@]}"} &
BACK=$!
trap 'kill $BACK 2>/dev/null || true' EXIT

cd "$ROOT/frontend"
[ -d node_modules ] || npm install
npm run dev