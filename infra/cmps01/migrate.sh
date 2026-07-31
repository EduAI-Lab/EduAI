#!/usr/bin/env bash
# Replace cmps01's Qwen2.5 pair with the pinned Qwen3.5 fleet candidate pair.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${VLLM_API_KEY:?Copy .env.example to .env and set a random VLLM_API_KEY}"
: "${EDUAI_INTERNAL_KEY:?Set EDUAI_INTERNAL_KEY in .env}"
: "${INTERNAL_ALLOW_IPS:?Set INTERNAL_ALLOW_IPS to the s378 address only}"

case "$VLLM_API_KEY $EDUAI_INTERNAL_KEY" in
  *change-me*) echo "ERROR: replace all placeholder secrets in .env"; exit 1 ;;
esac

echo "=== Preflight ==="
nvidia-smi -L
docker compose config --quiet

echo "=== Render protected nginx edge ==="
./deploy-edge-proxy.sh --render-only

echo "=== Remove legacy standalone containers ==="
docker rm -f \
  eduai-vllm \
  eduai-vllm-t3 \
  eduai-vllm-proxy \
  eduai-edge-proxy \
  eduai-energy-meter \
  2>/dev/null || true

echo "=== Pull/build and start Qwen3.5 stack ==="
docker compose pull
docker compose build eduai-energy-meter
docker compose up -d

echo "=== Wait for both model backends ==="
for spec in "18001:qwen3.5-2b" "18002:qwen3.5-27b"; do
  port="${spec%%:*}"
  model="${spec#*:}"
  for _ in $(seq 1 160); do
    if curl -fsS "http://127.0.0.1:${port}/v1/models" | grep -q "\"${model}\""; then
      echo "OK ${model}"
      break
    fi
    sleep 15
  done
  curl -fsS "http://127.0.0.1:${port}/v1/models" | grep -q "\"${model}\""
done

echo "=== Verify protected edge and energy meter ==="
./verify-edge-security.sh
curl -fsS http://127.0.0.1:8001/v1/models \
  -H "Authorization: Bearer ${VLLM_API_KEY}"
echo
echo "cmps01 Qwen3.5 fleet profile ready"
