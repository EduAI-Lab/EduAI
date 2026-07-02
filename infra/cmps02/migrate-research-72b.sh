#!/usr/bin/env bash
# cmps02 — temporary research profile: Qwen2.5-72B-Instruct-AWQ (TP=2).
#
# Replaces the production 7B + 32B stack on this host for XL-tier adequacy runs.
# Restore chat fleet with: ./migrate-tiered.sh
#
# Expect 20–60+ min on first run (HF download + compile).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VLLM_IMAGE="${VLLM_IMAGE:-vllm/vllm-openai:latest}"

echo "=== Step 1: stop old containers ==="
docker stop eduai-vllm eduai-vllm-t3 eduai-vllm-xl eduai-vllm-120b 2>/dev/null || true
docker rm eduai-vllm eduai-vllm-t3 eduai-vllm-xl eduai-vllm-120b 2>/dev/null || true
docker compose down 2>/dev/null || true

echo "=== Step 2: LiteLLM config (72B research only) ==="
cp -f litellm-config.research-72b.yaml litellm-config.yaml

echo "=== Step 3: start Qwen 72B AWQ backend (TP=2, localhost :18001) ==="
docker run -d --name eduai-vllm-xl --gpus all \
  --ipc=host \
  -p 127.0.0.1:18001:8000 \
  --restart unless-stopped \
  "$VLLM_IMAGE" \
  --model Qwen/Qwen2.5-72B-Instruct-AWQ \
  --served-model-name qwen2.5-72b-instruct \
  --host 0.0.0.0 \
  --port 8000 \
  --tensor-parallel-size 2 \
  --gpu-memory-utilization 0.90 \
  --max-model-len 16384

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
  echo "  TIMEOUT — check: docker logs -f eduai-vllm-xl"
  return 1
}

wait_for_model "http://127.0.0.1:18001" "eduai-vllm-xl"

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
echo "Done. Research model id: vllm:qwen2.5-72b-instruct"
echo '  VLLM_BASE_URL="http://cmps02.ok.ubc.ca:8001"'
echo '  VLLM_API_KEY="vllm-local"'
echo "Restore production tiered stack: ./migrate-tiered.sh"
