#!/usr/bin/env bash
set -euo pipefail
CORE=/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core
cd "$CORE"
set -a
source .env
set +a

LOG=/tmp/eduai-dev.log
before=$(wc -l < "$LOG" 2>/dev/null || echo 0)

curl -s -X POST http://127.0.0.1:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${EDUAI_API_KEY}" \
  -d '{
    "messages": [{"id": "debug-u1", "role": "user", "content": "Say hi in one word"}],
    "model": "auto",
    "streaming": false,
    "apiKeys": {"vllm": {"apiKey": "vllm-local", "isEnabled": true}}
  }' | head -c 2000

echo
echo "=== new log lines ==="
tail -n +"$((before + 1))" "$LOG" 2>/dev/null | tail -40

echo "=== vllm health ==="
curl -s -o /dev/null -w "%{http_code}" "${VLLM_BASE_URL:-http://127.0.0.1:8000}/v1/models" || true
echo
