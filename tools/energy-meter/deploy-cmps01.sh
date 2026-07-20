#!/usr/bin/env bash
# Deploy energy sidecar on cmps01 via Docker (no host node/pip install).
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=== stop old sidecar ==="
docker compose down 2>/dev/null || true
pkill -f 'energy-meter/server.mjs' 2>/dev/null || true

echo "=== build + start ==="
docker compose up -d --build

sleep 3
echo "=== health ==="
curl -sf "http://127.0.0.1:${ENERGY_METER_PORT:-9100}/health" | head -c 500
echo ""

echo "=== probe measure ==="
TAG="deploy-probe-$(date +%s)"
curl -sf -X POST "http://127.0.0.1:${ENERGY_METER_PORT:-9100}/measure-start" \
  -H 'Content-Type: application/json' -d "{\"tag\":\"$TAG\"}"
sleep 2
curl -sf -X POST "http://127.0.0.1:${ENERGY_METER_PORT:-9100}/measure-stop" \
  -H 'Content-Type: application/json' -d "{\"tag\":\"$TAG\"}"
echo ""
echo "=== done ==="
