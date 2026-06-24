#!/usr/bin/env bash
set -eu

ROOT="${1:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core}"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo '{"error":"missing .env"}'
  exit 1
fi

# shellcheck disable=SC1091
set -a && source .env && set +a

if [[ -z "${EDUAI_API_KEY:-}" ]]; then
  echo '{"error":"EDUAI_API_KEY not set"}'
  exit 1
fi

API_URL="${SMOKE_API_URL:-http://127.0.0.1:3000/api/chat}"

run_chat() {
  local model="$1"
  curl -s -D /tmp/smoke-headers.txt -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${EDUAI_API_KEY}" \
    -d "{
      \"messages\": [{\"id\": \"smoke-u1\", \"role\": \"user\", \"content\": \"Reply with exactly: smoke ok\"}],
      \"model\": \"${model}\",
      \"streaming\": false,
      \"forceHybridRag\": true,
      \"apiKeys\": {\"vllm\": {\"apiKey\": \"${VLLM_API_KEY:-vllm-local}\", \"isEnabled\": true}}
    }"
}

echo "=== energy ==="
curl -s "${ENERGY_SIDECAR_URL:-http://cmps01.ok.ubc.ca:8001/energy}/health" | head -c 200
echo

echo "=== auto ==="
body="$(run_chat auto)"
status="$(head -1 /tmp/smoke-headers.txt | awk '{print $2}')"
echo "status=$status tier=$(grep -i x-router-tier /tmp/smoke-headers.txt | awk '{print $2}' | tr -d '\r')"
echo "$body" | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(JSON.stringify({model:j.model,routedModel:j.routedModel,promptTokens:j.usage?.promptTokens,completionTokens:j.usage?.completionTokens,preview:(j.content||j.error||'').slice(0,60)}));"

echo "=== auto-llm ==="
body="$(run_chat auto-llm)"
status="$(head -1 /tmp/smoke-headers.txt | awk '{print $2}')"
echo "status=$status"
echo "$body" | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(JSON.stringify({model:j.model,routedModel:j.routedModel,promptTokens:j.usage?.promptTokens,completionTokens:j.usage?.completionTokens,preview:(j.content||j.error||'').slice(0,60)}));"
