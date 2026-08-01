#!/usr/bin/env bash
# cmps02 — Qwen3.5-4B (GPU 0) + Qwen3.5-27B-FP8 (GPU 1).
# Replaces the Qwen2.5 7B+32B fleet stack per docs/research/v3/PREREG_v3.md Sec 2.1
# model-family freeze. cmps02 is a live-chat host (see README.md) same as cmps01.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
VLLM_IMAGE="${VLLM_IMAGE:-vllm/vllm-openai:latest}"

echo "=== Step 0: pull image ==="
docker pull "$VLLM_IMAGE"

echo "=== Step 1: stop old containers ==="
docker stop eduai-vllm eduai-vllm-t3 eduai-vllm-mid eduai-vllm-xl eduai-vllm-120b 2>/dev/null || true
docker rm eduai-vllm eduai-vllm-t3 eduai-vllm-mid eduai-vllm-xl eduai-vllm-120b 2>/dev/null || true
docker compose down 2>/dev/null || true

echo "=== Step 2: recreate backends (localhost only) ==="
mkdir -p "$HOME/.cache/huggingface"
docker run -d --name eduai-vllm --gpus '"device=0"' \
  -p 127.0.0.1:18001:8000 \
  -v "$HOME/.cache/huggingface:/root/.cache/huggingface" \
  --restart unless-stopped \
  "$VLLM_IMAGE" \
  --model Qwen/Qwen3.5-4B \
  --served-model-name qwen3.5-4b-instruct \
  --host 0.0.0.0 \
  --port 8000 \
  --gpu-memory-utilization 0.85 \
  --max-model-len 16384

docker run -d --name eduai-vllm-t3 --gpus '"device=1"' \
  -p 127.0.0.1:18002:8000 \
  -v "$HOME/.cache/huggingface:/root/.cache/huggingface" \
  --restart unless-stopped \
  "$VLLM_IMAGE" \
  --model Qwen/Qwen3.5-27B-FP8 \
  --served-model-name qwen3.5-27b-instruct \
  --host 0.0.0.0 \
  --port 8000 \
  --gpu-memory-utilization 0.90 \
  --max-model-len 16384 \
  --max-num-seqs 224 \
  --enable-auto-tool-choice \
  --tool-call-parser hermes

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
  echo "  TIMEOUT: $label not ready — check docker logs"
  echo "  If the log shows 'max_num_seqs (256) exceeds available Mamba cache blocks (N)',"
  echo "  recreate the container with --max-num-seqs <N or lower> (Qwen3.5 hybrid Mamba/GDN constraint)."
  return 1
}
wait_for_model "http://127.0.0.1:18001" "eduai-vllm (4B)"
wait_for_model "http://127.0.0.1:18002" "eduai-vllm-t3 (27B FP8)"

echo "=== Step 3: start LiteLLM + nginx edge on :8001 ==="
docker compose up -d
for i in $(seq 1 40); do
  if curl -sf http://127.0.0.1:8001/v1/models -H "Authorization: Bearer vllm-local" >/dev/null 2>&1; then
    break
  fi
  sleep 3
done

echo "=== Step 4: verify ==="
curl -s http://127.0.0.1:8001/v1/models -H "Authorization: Bearer vllm-local" | jq -r '.data[].id' | sed 's/^/  /'
echo ""
echo "Done. Qwen3.5 models on cmps02:"
echo "  vllm:qwen3.5-4b-instruct   (GPU 0)"
echo "  vllm:qwen3.5-27b-instruct  (GPU 1, FP8)"
