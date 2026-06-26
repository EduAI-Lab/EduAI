#!/usr/bin/env bash
# cmps02 — gpt-oss-120b on BOTH GPUs (tensor parallel), LiteLLM/nginx on :8001
# Recommended layout for cmps02 (2× RTX 6000 Ada, ~48 GB each).
#
# Expect 20–60+ min on first run (HF download + compile).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VLLM_IMAGE="${VLLM_IMAGE:-vllm/vllm-openai:v0.18.0}"

echo "=== Step 1: stop old containers ==="
docker stop eduai-vllm eduai-vllm-t3 eduai-vllm-120b 2>/dev/null || true
docker rm eduai-vllm eduai-vllm-t3 eduai-vllm-120b 2>/dev/null || true
docker compose down 2>/dev/null || true

echo "=== Step 2: LiteLLM config (120B only) ==="
cp -f litellm-config.120b.yaml litellm-config.yaml

echo "=== Step 3: start gpt-oss-120b backend (TP=2, localhost :18001) ==="
docker run -d --name eduai-vllm-120b --gpus all \
  --ipc=host \
  -p 127.0.0.1:18001:8000 \
  --restart unless-stopped \
  "$VLLM_IMAGE" \
  --model openai/gpt-oss-120b \
  --served-model-name gpt-oss-120b \
  --host 0.0.0.0 \
  --port 8000 \
  --tensor-parallel-size 2 \
  --gpu-memory-utilization 0.90 \
  --max-model-len 32768

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
  echo "  TIMEOUT — check: docker logs -f eduai-vllm-120b"
  return 1
}

wait_for_model "http://127.0.0.1:18001" "eduai-vllm-120b"

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
echo "Done. EduAI model id: vllm:gpt-oss-120b"
echo '  VLLM_BASE_URL="http://cmps02.ok.ubc.ca:8001"'
echo '  VLLM_API_KEY="vllm-local"'
