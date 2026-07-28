#!/usr/bin/env bash
# cmps03 heavy/background fleet host: gpt-oss-120b across both 48 GB GPUs.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VLLM_IMAGE="${VLLM_IMAGE:-vllm/vllm-openai:v0.18.0}"

echo "=== Preflight ==="
nvidia-smi -L
docker run --rm --gpus all ubuntu nvidia-smi -L

echo "=== Stop prior cmps03 stack ==="
docker compose down 2>/dev/null || true
docker rm -f eduai-vllm-120b 2>/dev/null || true

if ss -tln 2>/dev/null | grep -Eq ':(8001|18001|18091)[[:space:]]'; then
  echo "ERROR: one of ports 8001, 18001, or 18091 is already in use"
  exit 1
fi

echo "=== Pull images ==="
docker pull "$VLLM_IMAGE"
docker compose pull

echo "=== Start gpt-oss-120b backend (tensor parallel 2) ==="
mkdir -p "$HOME/.cache/huggingface" "$HOME/.cache/vllm"
docker run -d --name eduai-vllm-120b \
  --gpus all \
  --ipc=host \
  -p 127.0.0.1:18001:8000 \
  -v "$HOME/.cache/huggingface:/root/.cache/huggingface" \
  -v "$HOME/.cache/vllm:/root/.cache/vllm" \
  --restart unless-stopped \
  "$VLLM_IMAGE" \
  openai/gpt-oss-120b \
  --served-model-name gpt-oss-120b \
  --host 0.0.0.0 \
  --port 8000 \
  --tensor-parallel-size 2 \
  --gpu-memory-utilization 0.90 \
  --max-model-len 32768

echo "Backend started. Follow startup with:"
echo "  docker logs -f eduai-vllm-120b"
echo "After /v1/models is ready, run ./start-edge.sh"
