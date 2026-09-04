#!/usr/bin/env bash
# Replace only cmps02 GPU 1's legacy Qwen2.5 service with Qwen3.8-27B FP8.
# GPU 0 and the existing proxy stack are preserved.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

VLLM_IMAGE="${VLLM_IMAGE:-vllm/vllm-openai:latest}"
MODEL_REPO="Qwen/Qwen3.8-27B-FP8"
MODEL_ID="qwen3.8-27b-instruct"
OLD_MODEL_ID="qwen2.5-32b-instruct"
LITELLM_CONFIG="${LITELLM_CONFIG:-$SCRIPT_DIR/litellm-config.yaml}"
HF_CACHE="${HF_CACHE:-$HOME/.cache/huggingface}"

if [[ ! -f "$LITELLM_CONFIG" ]]; then
  echo "Missing LiteLLM config: $LITELLM_CONFIG" >&2
  exit 1
fi

if grep -q "$OLD_MODEL_ID" "$LITELLM_CONFIG"; then
  CONFIG_NEEDS_UPDATE=true
elif grep -q "$MODEL_ID" "$LITELLM_CONFIG"; then
  CONFIG_NEEDS_UPDATE=false
else
  echo "Neither '$OLD_MODEL_ID' nor '$MODEL_ID' was found in $LITELLM_CONFIG" >&2
  echo "Refusing to edit an unexpected proxy configuration." >&2
  exit 1
fi

echo "=== Step 1: pull vLLM image ==="
docker pull "$VLLM_IMAGE"

echo "=== Step 2: prefetch $MODEL_REPO (old service remains up) ==="
mkdir -p "$HF_CACHE"
docker run --rm --network host \
  -v "$HF_CACHE:/root/.cache/huggingface" \
  --entrypoint python3 \
  "$VLLM_IMAGE" \
  -c "from huggingface_hub import snapshot_download; snapshot_download('$MODEL_REPO')"

echo "=== Step 3: back up and update LiteLLM model id ==="
BACKUP="$LITELLM_CONFIG.bak.$(date +%Y%m%d%H%M%S)"
cp -a "$LITELLM_CONFIG" "$BACKUP"
if [[ "$CONFIG_NEEDS_UPDATE" == true ]]; then
  sed -i "s/$OLD_MODEL_ID/$MODEL_ID/g" "$LITELLM_CONFIG"
fi

echo "=== Step 4: recreate only the GPU 1 backend ==="
docker rm -f eduai-vllm-t3 2>/dev/null || true
docker run -d --name eduai-vllm-t3 --gpus '"device=1"' \
  -p 127.0.0.1:18002:8000 \
  -v "$HF_CACHE:/root/.cache/huggingface" \
  --ipc=host \
  --restart unless-stopped \
  "$VLLM_IMAGE" \
  --model "$MODEL_REPO" \
  --served-model-name "$MODEL_ID" \
  --host 0.0.0.0 \
  --port 8000 \
  --gpu-memory-utilization 0.90 \
  --max-model-len 65536 \
  --max-num-seqs 16 \
  --reasoning-parser qwen3 \
  --enable-auto-tool-choice \
  --tool-call-parser qwen3_coder

echo "Waiting for GPU 1 vLLM to become ready..."
for _ in $(seq 1 180); do
  if curl -sf --max-time 5 http://127.0.0.1:18002/v1/models >/dev/null; then
    break
  fi
  sleep 20
done

if ! curl -sf --max-time 10 http://127.0.0.1:18002/v1/models \
  | jq -e --arg model "$MODEL_ID" '.data | any(.[]; .id == $model)' >/dev/null; then
  echo "GPU 1 vLLM did not expose $MODEL_ID; inspect: docker logs eduai-vllm-t3" >&2
  exit 1
fi

echo "=== Step 5: restart proxy stack and verify ==="
docker compose up -d --force-recreate eduai-vllm-proxy
echo "GPU 1 backend is serving $MODEL_ID. Proxy verification from dev should follow."
