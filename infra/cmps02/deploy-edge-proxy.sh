#!/usr/bin/env bash
# nginx on public :8001 → LiteLLM :18091, /energy → :9100 sidecar (same as cmps01).
# Run on cmps02 from this directory. ~30s vLLM blip while LiteLLM restarts.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=== ensure energy sidecar on :9100 ==="
if ! curl -sf http://127.0.0.1:9100/health | grep -q canMeasure; then
  echo "WARN: energy sidecar not healthy on :9100 — run ~/eduai-energy-meter/deploy-cmps02.sh first"
fi

echo "=== restart LiteLLM on 127.0.0.1:18091 ==="
docker compose up -d eduai-vllm-proxy --force-recreate
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf http://127.0.0.1:18091/v1/models -H "Authorization: Bearer vllm-local" >/dev/null; then
    break
  fi
  sleep 3
done
curl -sf http://127.0.0.1:18091/v1/models -H "Authorization: Bearer vllm-local" | head -c 200
echo ""

echo "=== start nginx edge on :8001 ==="
docker compose up -d eduai-edge-proxy --force-recreate
sleep 2

echo "=== verify vLLM via edge ==="
curl -sf http://127.0.0.1:8001/v1/models -H "Authorization: Bearer vllm-local" | head -c 200
echo ""

if curl -sf http://127.0.0.1:9100/health >/dev/null 2>&1; then
  echo "=== verify energy via edge ==="
  curl -sf http://127.0.0.1:8001/energy/health
  echo ""
  TAG="edge-probe-$(date +%s)"
  curl -sf -X POST http://127.0.0.1:8001/energy/measure-start \
    -H 'Content-Type: application/json' -d "{\"tag\":\"$TAG\"}"
  sleep 2
  curl -sf -X POST http://127.0.0.1:8001/energy/measure-stop \
    -H 'Content-Type: application/json' -d "{\"tag\":\"$TAG\"}"
  echo ""
fi

echo "=== done — s378: VLLM_BASE_URL=http://cmps02.ok.ubc.ca:8001 ==="
echo "=== done — s378: ENERGY_SIDECAR_URL=http://cmps02.ok.ubc.ca:8001/energy ==="
