#!/usr/bin/env bash
# Starts the mock LLM server + a production-mode app instance for the #919
# stress harness, both bound to loopback only. Run `npm run loadtest:setup`
# first. Ctrl-C stops both.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

ENV_FILE="../.env.loadtest"
if [ ! -f "$ENV_FILE" ]; then
  echo "Missing apps/core/.env.loadtest — run 'npm run loadtest:setup' first." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [ ! -d "../build" ]; then
  echo "==> No production build found, building once (npm run build)..."
  (cd .. && npm run build)
fi

MOCK_PID=""
APP_PID=""
cleanup() {
  echo "==> Stopping loadtest instance..."
  [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null || true
  [ -n "$APP_PID" ] && kill "$APP_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "==> Starting mock LLM/embedding server on port 8801..."
node mock-llm/server.mjs &
MOCK_PID=$!

sleep 1

echo "==> Starting app instance on port $PORT (production build)..."
(cd .. && npx react-router-serve ./build/server/index.js) &
APP_PID=$!

echo "==> Ready: app on http://localhost:${PORT}, mock LLM on http://localhost:8801"
echo "==> Press Ctrl-C to stop."
wait
