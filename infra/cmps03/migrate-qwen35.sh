#!/usr/bin/env bash
# cmps03 heavy/background fleet host: Qwen3.5-35B-A3B (MoE) across both 48 GB GPUs.
# Replaces gpt-oss-120b (see deploy.sh for rollback). Serves as the
# docs/research/v3/PREREG_v3.md §2.3 secondary judge (same-lineage, strictly
# larger than the selected large dense tier; never the answerer).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
VLLM_IMAGE="${VLLM_IMAGE:-vllm/vllm-openai:latest}"

echo "=== Preflight ==="
nvidia-smi -L

echo "=== Stop prior cmps03 stack ==="
docker compose down 2>/dev/null || true
docker rm -f eduai-vllm-120b eduai-vllm-moe 2>/dev/null || true

if ss -tln 2>/dev/null | grep -Eq ':(8001|18001|18091)[[:space:]]'; then
  echo "ERROR: one of ports 8001, 18001, or 18091 is already in use"
  exit 1
fi

echo "=== Pull image ==="
docker pull "$VLLM_IMAGE"
docker compose pull

echo "=== Start Qwen3.5-35B-A3B backend (tensor parallel 2) ==="
mkdir -p "$HOME/.cache/huggingface" "$HOME/.cache/vllm"
docker run -d --name eduai-vllm-moe \
  --gpus all \
  --ipc=host \
  -p 127.0.0.1:18001:8000 \
  -v "$HOME/.cache/huggingface:/root/.cache/huggingface" \
  -v "$HOME/.cache/vllm:/root/.cache/vllm" \
  --restart unless-stopped \
  "$VLLM_IMAGE" \
  --model Qwen/Qwen3.5-35B-A3B \
  --served-model-name qwen3.5-35b-a3b \
  --host 0.0.0.0 \
  --port 8000 \
  --tensor-parallel-size 2 \
  --gpu-memory-utilization 0.90 \
  --max-model-len 32768

echo "Backend started. Follow startup with:"
echo "  docker logs -f eduai-vllm-moe"
echo "If the log shows 'max_num_seqs (256) exceeds available Mamba cache blocks (N)',"
echo "stop/rm the container and recreate with --max-num-seqs <N or lower>"
echo "(Qwen3.5 hybrid Mamba/GDN architecture constraint)."

wait_for_model() {
  local url="$1"
  local label="$2"
  echo "Waiting for $label at $url ..."
  for i in $(seq 1 240); do
    if curl -sf "$url/v1/models" >/dev/null 2>&1; then
      echo "  OK: $label ready"
      curl -s "$url/v1/models" | jq -r '.data[].id' | sed "s/^/    /"
      return 0
    fi
    sleep 20
  done
  echo "  TIMEOUT: $label not ready — check docker logs"
  return 1
}
wait_for_model "http://127.0.0.1:18001" "eduai-vllm-moe (35B-A3B)"

echo "=== Start LiteLLM + nginx edge on :8001 ==="
docker compose up -d
for i in $(seq 1 40); do
  if curl -sf http://127.0.0.1:8001/v1/models -H "Authorization: Bearer vllm-local" >/dev/null 2>&1; then
    break
  fi
  sleep 3
done

echo "=== Verify ==="
curl -s http://127.0.0.1:8001/v1/models -H "Authorization: Bearer vllm-local" | jq -r '.data[].id' | sed 's/^/  /'
echo ""
echo "Done. Qwen3.5 MoE judge on cmps03:"
echo "  vllm:qwen3.5-35b-a3b  (TP=2, both GPUs)"
echo "Restore gpt-oss-120b: cp litellm-config.120b.yaml litellm-config.yaml && ./deploy.sh"
