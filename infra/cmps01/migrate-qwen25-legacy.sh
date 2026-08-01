#!/usr/bin/env bash
# cmps01 — ROLLBACK to Qwen2.5 (7B + 32B AWQ). Superseded by ./migrate.sh (Qwen3.5).
# Run on cmps01 after copying this infra/cmps01 folder to the host.
#
# Downtime: both models offline until backends reload + proxy starts.
# 32B AWQ may take 10–30+ minutes to become ready.
# NOTE: after rollback, litellm-config.yaml must also be reverted to the qwen2.5-* entries
# (git show HEAD~1:infra/cmps01/litellm-config.yaml before the Qwen3.5 migration commit).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

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

echo "=== Step 3: start LiteLLM proxy on :8001 ==="
docker compose up -d

echo "Waiting for proxy ..."
for i in $(seq 1 20); do
  if curl -sf http://127.0.0.1:8001/v1/models -H "Authorization: Bearer vllm-local" >/dev/null 2>&1; then
    break
  fi
  sleep 3
done

echo "=== Step 4: verify ==="
echo "Backends:"
curl -s http://127.0.0.1:18001/v1/models | jq -r '.data[].id' | sed 's/^/  7B: /'
curl -s http://127.0.0.1:18002/v1/models | jq -r '.data[].id' | sed 's/^/  32B: /'

echo "Proxy (both models):"
curl -s http://127.0.0.1:8001/v1/models -H "Authorization: Bearer vllm-local" | jq -r '.data[].id' | sed 's/^/  /'

echo ""
echo "Done. Next on s378:"
echo '  VLLM_BASE_URL="http://cmps01.ok.ubc.ca:8001"'
echo '  VLLM_API_KEY="vllm-local"'
echo "  restart dev server, npm run vllm:smoke, register models in Admin → AI Models"
