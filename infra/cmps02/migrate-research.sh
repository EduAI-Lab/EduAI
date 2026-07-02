#!/usr/bin/env bash
# cmps02 — research profile: Qwen2.5-14B (GPU 0) + Qwen2.5-72B-Instruct-AWQ (GPU 1).
#
# Replaces the fleet 7B + 32B stack on this host for model adequacy experiments.
# cmps01 keeps 7B + 32B for production routing work.
# Restore fleet chat with: ./migrate-tiered.sh
#
# First run: 14B loads in ~5–15 min; 72B AWQ ~15–45 min (HF cache helps if 72B ran before).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VLLM_IMAGE="${VLLM_IMAGE:-vllm/vllm-openai:latest}"

echo "=== Step 1: stop old containers ==="
docker stop eduai-vllm eduai-vllm-t3 eduai-vllm-mid eduai-vllm-xl eduai-vllm-120b 2>/dev/null || true
docker rm eduai-vllm eduai-vllm-t3 eduai-vllm-mid eduai-vllm-xl eduai-vllm-120b 2>/dev/null || true
docker compose down 2>/dev/null || true

echo "=== Step 2: LiteLLM config (14B + 72B research) ==="
cp -f litellm-config.research.yaml litellm-config.yaml

echo "=== Step 3: start backends (localhost only) ==="

docker run -d --name eduai-vllm-mid --gpus '"device=0"' \
  -p 127.0.0.1:18001:8000 \
  --restart unless-stopped \
  "$VLLM_IMAGE" \
  --model Qwen/Qwen2.5-14B-Instruct \
  --served-model-name qwen2.5-14b-instruct \
  --host 0.0.0.0 \
  --port 8000 \
  --gpu-memory-utilization 0.85 \
  --max-model-len 8192

docker run -d --name eduai-vllm-xl --gpus '"device=1"' \
  -p 127.0.0.1:18002:8000 \
  --restart unless-stopped \
  "$VLLM_IMAGE" \
  --model Qwen/Qwen2.5-72B-Instruct-AWQ \
  --served-model-name qwen2.5-72b-instruct \
  --host 0.0.0.0 \
  --port 8000 \
  --gpu-memory-utilization 0.95 \
  --max-model-len 8192

wait_for_model() {
  local url="$1"
  local label="$2"
  echo "Waiting for $label at $url ..."
  for i in $(seq 1 180); do
    if curl -sf "$url/v1/models" >/dev/null 2>&1; then
      echo "  OK: $label ready"
      curl -s "$url/v1/models" | jq -r '.data[].id' | sed "s/^/    /"
      return 0
    fi
    sleep 20
  done
  echo "  TIMEOUT — check docker logs for $label"
  return 1
}

wait_for_model "http://127.0.0.1:18001" "eduai-vllm-mid (14B)"
wait_for_model "http://127.0.0.1:18002" "eduai-vllm-xl (72B)"

echo "=== Step 4: start LiteLLM + nginx edge on :8001 ==="
docker compose up -d

echo "Waiting for edge ..."
for i in $(seq 1 40); do
  if curl -sf http://127.0.0.1:8001/v1/models -H "Authorization: Bearer vllm-local" >/dev/null 2>&1; then
    break
  fi
  sleep 3
done

echo "=== Step 5: verify ==="
curl -s http://127.0.0.1:8001/v1/models -H "Authorization: Bearer vllm-local" | jq -r '.data[].id' | sed 's/^/  /'

echo ""
echo "Done. Research models on cmps02:"
echo "  vllm:qwen2.5-14b-instruct  (medium — GPU 0)"
echo "  vllm:qwen2.5-72b-instruct  (XL — GPU 1)"
echo '  VLLM_BASE_URL="http://cmps02.ok.ubc.ca:8001"'
echo '  VLLM_API_KEY="vllm-local"'
echo "Restore fleet 7B+32B: ./migrate-tiered.sh"
