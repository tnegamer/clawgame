#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

npm run build:shared >/tmp/clawgame-build-shared.log 2>&1
npm run build:server >/tmp/clawgame-build-server.log 2>&1

npm run dev:server >/tmp/clawgame-server.log 2>&1 &
SERVER_PID=$!
trap 'kill $SERVER_PID >/dev/null 2>&1 || true' EXIT

for _ in $(seq 1 30); do
  if curl -sf http://localhost:8787/health >/dev/null; then
    break
  fi
  sleep 0.3
done

npm run ai:duel:auto
