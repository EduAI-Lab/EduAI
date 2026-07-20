#!/usr/bin/env bash
# cmps02 — Qwen 7B + 32B AWQ (cmps01 clone). Uses one GPU per model.
# NOT compatible with gpt-oss-120b on the same machine — see README.md.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

SKIP_32B="${SKIP_32B:-0}"

echo "=== Step 1: stop old containers ==="
# Current canonical names + prior mid/xl layout (14B/72B) that still holds :18001/:18002.
OLD_BACKENDS=(
  eduai-vllm
  eduai-vllm-t3
  eduai-vllm-120b
  eduai-vllm-mid
  eduai-vllm-xl
)
docker stop "${OLD_BACKENDS[@]}" 2>/dev/null || true
docker rm "${OLD_BACKENDS[@]}" 2>/dev/null || true
docker compose down 2>/dev/null || true

echo "=== Step 2: LiteLLM config (tiered) ==="
cp -f litellm-config.tiered.yaml litellm-config.yaml

echo "=== Step 3: recreate backends (localhost only) ==="

docker run -d --name eduai-vllm --gpus '"device=0"' \
  -p 127.0.0.1:18001:8000 \
  --restart unless-stopped \
  vllm/vllm-openai:latest \
  --model Qwen/Qwen2.5-7B-Instruct \
  --served-model-name qwen2.5-7b-instruct \
  --host 0.0.0.0 \
  --port 8000

if [[ "$SKIP_32B" != "1" ]]; then
  docker run -d --name eduai-vllm-t3 --gpus '"device=1"' \
    -p 127.0.0.1:18002:8000 \
    --restart unless-stopped \
    vllm/vllm-openai:latest \
    --model Qwen/Qwen2.5-32B-Instruct-AWQ \
    --served-model-name qwen2.5-32b-instruct \
    --host 0.0.0.0 \
    --port 8000 \
    --gpu-memory-utilization 0.88 \
    --max-model-len 16384 \
    --enable-auto-tool-choice \
    --tool-call-parser hermes
fi

wait_for_model() {
  local url="$1"
  local label="$2"
  echo "Waiting for $label at $url ..."
  for i in $(seq 1 120); do
    if curl -sf "$url/v1/models" >/dev/null 2>&1; then
      echo "  OK: $label ready"
      curl -s "$url/v1/models" | jq -r '.data[].id' | sed "s/^/    /"
      return 0
    fi
    sleep 15
  done
  echo "  TIMEOUT: $label not ready — check docker logs"
  return 1
}

wait_for_model "http://127.0.0.1:18001" "eduai-vllm"
if [[ "$SKIP_32B" != "1" ]]; then
  wait_for_model "http://127.0.0.1:18002" "eduai-vllm-t3"
fi

echo "=== Step 4: start LiteLLM + nginx edge on :8001 ==="
docker compose up -d

for i in $(seq 1 40); do
  if curl -sf http://127.0.0.1:8001/v1/models -H "Authorization: Bearer vllm-local" >/dev/null 2>&1; then
    break
  fi
  sleep 3
done

curl -s http://127.0.0.1:8001/v1/models -H "Authorization: Bearer vllm-local" | jq -r '.data[].id' | sed 's/^/  /'

echo ""
echo "Done. Optional energy sidecar:"
echo "  ~/eduai-energy-meter/deploy-cmps02.sh && ./deploy-edge-proxy.sh"
echo "Next on s378:"
echo '  VLLM_BASE_URL="http://cmps02.ok.ubc.ca:8001"'
echo '  ENERGY_SIDECAR_URL="http://cmps02.ok.ubc.ca:8001/energy"'
echo '  VLLM_API_KEY="vllm-local"'
