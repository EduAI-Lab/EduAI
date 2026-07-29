#!/usr/bin/env bash
# Move LiteLLM to :18091, put nginx on public :8001 with protected /energy and /ollama.
# Run on cmps01 from this directory. ~30s vLLM blip while LiteLLM restarts.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

# shellcheck source=lib/check-example-secrets.sh
source "${DIR}/lib/check-example-secrets.sh"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# Reject unset/empty/example secrets before any docker compose / service start (#1115).
check_cmps01_internal_key || exit 1

: "${CMPS01_INTERNAL_ALLOW_IPS:?Set CMPS01_INTERNAL_ALLOW_IPS to s378 only (e.g. 206.87.25.229) — do not add laptops}"

echo "=== render nginx configs ==="
{
  echo "allow 127.0.0.1;"
  echo "allow ::1;"
  for ip in ${CMPS01_INTERNAL_ALLOW_IPS:-}; do
    [ -n "$ip" ] || continue
    echo "allow ${ip};"
  done
  echo "deny all;"
} > internal-allow.conf

export CMPS01_INTERNAL_KEY
envsubst '${CMPS01_INTERNAL_KEY}' < nginx.conf.template > nginx.conf

# LiteLLM master_key must match CMPS01_INTERNAL_KEY (and s378 VLLM_API_KEY) — no vllm-local fallback.
envsubst '${CMPS01_INTERNAL_KEY}' < litellm-config.yaml.template > litellm-config.runtime.yaml

AUTH_HEADER=(-H "X-EduAI-Internal-Key: ${CMPS01_INTERNAL_KEY}")
VLLM_AUTH_HEADER=(-H "Authorization: Bearer ${CMPS01_INTERNAL_KEY}")

echo "=== ensure energy sidecar on :9100 ==="
if ! curl -sf http://127.0.0.1:9100/health | grep -q canMeasure; then
  echo "WARN: energy sidecar not healthy on :9100 — run ~/eduai-energy-meter/deploy-cmps01.sh first"
fi

echo "=== restart LiteLLM on 127.0.0.1:18091 ==="
docker compose up -d eduai-vllm-proxy --force-recreate
for i in 1 2 3 4 5 6 7 8 9 10; do
  if curl -sf http://127.0.0.1:18091/v1/models "${VLLM_AUTH_HEADER[@]}" >/dev/null; then
    break
  fi
  sleep 3
done
curl -sf http://127.0.0.1:18091/v1/models "${VLLM_AUTH_HEADER[@]}" | head -c 200
echo ""

echo "=== start nginx edge on :8001 ==="
docker compose up -d eduai-edge-proxy --force-recreate
sleep 2

echo "=== verify vLLM via edge ==="
curl -sf http://127.0.0.1:8001/v1/models "${VLLM_AUTH_HEADER[@]}" | head -c 200
echo ""

echo "=== verify energy via edge (auth required) ==="
curl -sf "${AUTH_HEADER[@]}" http://127.0.0.1:8001/energy/health
echo ""

TAG="edge-probe-$(date +%s)"
curl -sf -X POST http://127.0.0.1:8001/energy/measure-start \
  "${AUTH_HEADER[@]}" \
  -H 'Content-Type: application/json' -d "{\"tag\":\"$TAG\"}"
sleep 2
curl -sf -X POST http://127.0.0.1:8001/energy/measure-stop \
  "${AUTH_HEADER[@]}" \
  -H 'Content-Type: application/json' -d "{\"tag\":\"$TAG\"}"
echo ""

echo "=== verify internal paths reject missing key ==="
bash ./verify-edge-security.sh

echo "=== done ==="
echo "s378 apps/core/.env (dev server only — do not copy key to laptops):"
echo "  ENERGY_SIDECAR_URL=http://cmps01.ok.ubc.ca:8001/energy"
echo "  OLLAMA_BASE_URL=http://cmps01.ok.ubc.ca:8001/ollama"
echo "  CMPS01_INTERNAL_KEY=<same secret as cmps01 .env>"
echo "  VLLM_API_KEY=<same secret as CMPS01_INTERNAL_KEY — LiteLLM master_key>"
