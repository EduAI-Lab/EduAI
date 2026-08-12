#!/usr/bin/env bash
# cmps01 — migrate eduai-vllm + eduai-vllm-t3 behind LiteLLM on :8001
# Run on cmps01 after copying this infra/cmps01 folder to the host.
#
# Downtime: both models offline until backends reload + proxy starts.
# 32B AWQ may take 10–30+ minutes to become ready.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# shellcheck source=lib/check-example-secrets.sh
source "${SCRIPT_DIR}/lib/check-example-secrets.sh"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

# Reject unset/empty/example secrets before any docker stop/run (#1115).
# Otherwise a bad CMPS01_INTERNAL_KEY still tears down and recreates vLLM before
# deploy-edge-proxy.sh fails closed. CMPS01_INTERNAL_ALLOW_IPS gets the same
# early check — it used to only be validated inside deploy-edge-proxy.sh at
# Step 3, well after Step 1/2 had already stopped and recreated containers.
check_cmps01_internal_key || exit 1
check_cmps01_allow_ips || exit 1

echo "=== Step 1: stop old containers ==="
docker stop eduai-vllm eduai-vllm-t3 2>/dev/null || true
docker rm eduai-vllm eduai-vllm-t3 2>/dev/null || true
# Remove proxy if re-running migration
docker compose down 2>/dev/null || true

echo "=== Step 2: recreate backends (localhost only) ==="

docker run -d --name eduai-vllm --gpus '"device=0"' \
  -p 127.0.0.1:18001:8000 \
  --restart unless-stopped \
  vllm/vllm-openai:latest \
  --model Qwen/Qwen2.5-7B-Instruct \
  --served-model-name qwen2.5-7b-instruct \
  --host 0.0.0.0 \
  --port 8000

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
  echo "  TIMEOUT: $label not ready after 30 min — check: docker logs $label"
  return 1
}

wait_for_model "http://127.0.0.1:18001" "eduai-vllm"
wait_for_model "http://127.0.0.1:18002" "eduai-vllm-t3"

echo "=== Step 3: start LiteLLM + nginx edge via deploy-edge-proxy.sh ==="
# Renders LiteLLM master_key from CMPS01_INTERNAL_KEY and rejects example secrets (#1115).
./deploy-edge-proxy.sh

echo ""
echo "Done. Next on s378:"
echo '  VLLM_BASE_URL="http://cmps01.ok.ubc.ca:8001"'
echo '  CMPS01_INTERNAL_KEY=<same as cmps01 .env>'
echo '  VLLM_API_KEY=<same as CMPS01_INTERNAL_KEY>'
echo "  restart dev server, npm run vllm:smoke, register models in Admin → AI Models"
