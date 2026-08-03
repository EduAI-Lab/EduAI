#!/usr/bin/env bash
# cmps01 GPU1 — swap Qwen3.5-9B (dense ladder) for the PREREG_v3.md Sec 2.3
# primary judge, Llama-3.3-70B-Instruct, AWQ-quantized to fit one 49GB GPU.
#
# Deviation from Sec 2.3 (logged in RUN_LOG.md / PREREG Sec 10): the frozen
# spec names Llama-3.3-70B-Instruct at full precision; no GPU in the fleet has
# headroom for that footprint alongside the dense ladder + secondary judge, so
# a pre-quantized AWQ checkpoint of the *same* model is used instead. Model
# identity is unchanged; only precision differs.
#
# GPU0 (Qwen3.5-2B, eduai-vllm) and the embed model (eduai-vllm-embed) are
# left untouched. Only eduai-vllm-t3 (9B, GPU1) is replaced.
#
# 9B's dense-ladder generation data was already collected in full before this
# swap (see results/generation-results.jsonl) — pausing 9B does not lose data,
# it only means 9B is not being served live during judge deployment.
#
# Restore 9B: see infra/cmps01/README.md / migrate-qwen35-cmps01.sh.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
VLLM_IMAGE="${VLLM_IMAGE:-vllm/vllm-openai:latest}"
JUDGE_MODEL="${JUDGE_MODEL:-casperhansen/llama-3.3-70b-instruct-awq}"
JUDGE_SERVED_NAME="${JUDGE_SERVED_NAME:-llama-3.3-70b-instruct-awq}"

echo "=== Step 0: backup current litellm config ==="
cp -f litellm-config.yaml "litellm-config.pre-primary-judge-$(date +%Y%m%d-%H%M%S).yaml"

echo "=== Step 1: pull image ==="
docker pull "$VLLM_IMAGE"

echo "=== Step 2: stop 9B container only (2B, embed untouched) ==="
docker stop eduai-vllm-t3 2>/dev/null || true
docker rm eduai-vllm-t3 2>/dev/null || true

echo "=== Step 3: LiteLLM config — add judge, keep 2B + embed passthrough ==="
if [ -f litellm-config.primary-judge.yaml ]; then
  cp -f litellm-config.primary-judge.yaml litellm-config.yaml
else
  echo "  WARNING: litellm-config.primary-judge.yaml not found — edit litellm-config.yaml manually to add the judge model entry, then re-run from Step 4."
fi

echo "=== Step 4: start primary judge (AWQ, single GPU) ==="
mkdir -p "$HOME/.cache/huggingface"
docker run -d --name eduai-vllm-t3 --gpus '"device=1"' \
  -p 127.0.0.1:18002:8000 \
  -v "$HOME/.cache/huggingface:/root/.cache/huggingface" \
  --restart unless-stopped \
  "$VLLM_IMAGE" \
  --model "$JUDGE_MODEL" \
  --served-model-name "$JUDGE_SERVED_NAME" \
  --quantization awq_marlin \
  --host 0.0.0.0 \
  --port 8000 \
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
  echo "  TIMEOUT: $label not ready — check docker logs eduai-vllm-t3"
  return 1
}
wait_for_model "http://127.0.0.1:18002" "eduai-vllm-t3 (primary judge, AWQ 70B)"

echo "=== Step 5: restart LiteLLM + nginx edge on :8001 ==="
# docker compose up -d alone will NOT reload litellm-config.yaml if the proxy
# container is already running — it leaves an already-up container untouched.
# Force a restart so LiteLLM re-reads the mounted config.
docker compose up -d
docker compose restart eduai-vllm-proxy
for i in $(seq 1 40); do
  if curl -sf http://127.0.0.1:8001/v1/models -H "Authorization: Bearer vllm-local" >/dev/null 2>&1; then
    break
  fi
  sleep 3
done

echo "=== Step 6: verify ==="
curl -s http://127.0.0.1:8001/v1/models -H "Authorization: Bearer vllm-local" | jq -r '.data[].id' | sed 's/^/  /'
echo ""
echo "Done. cmps01 now serving:"
echo "  vllm:qwen3.5-2b-instruct           (GPU 0, unchanged)"
echo "  $JUDGE_SERVED_NAME  (GPU 1, primary judge — was 9B)"
echo "  mxbai-embed-large unchanged (GPU 0, :18003)"
echo ""
echo "9B is paused, not deleted. To restore: bash migrate-qwen35-cmps01.sh"
