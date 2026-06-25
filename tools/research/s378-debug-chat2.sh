#!/usr/bin/env bash
set -euo pipefail
CORE=/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core
cd "$CORE"
set -a
source .env
set +a

echo "=== Bearer service key ==="
curl -s -D /tmp/h1.txt -X POST http://127.0.0.1:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${EDUAI_API_KEY}" \
  -d '{
    "messages": [{"id": "debug-u1", "role": "user", "content": "Reply with exactly: smoke ok"}],
    "model": "auto",
    "streaming": false,
    "forceHybridRag": true,
    "apiKeys": {"vllm": {"apiKey": "vllm-local", "isEnabled": true}}
  }' | head -c 1500
echo
head -1 /tmp/h1.txt

echo "=== Cookie + courseCode COSC111 ==="
source <(sed '1s/^\xEF\xBB\xBF//' .env.research)
curl -s -D /tmp/h2.txt -X POST http://127.0.0.1:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "Cookie: $RESEARCH_RUN_COOKIE" \
  -d '{
    "messages": [{"id": "debug-u2", "role": "user", "content": "Reply with exactly: smoke ok"}],
    "model": "auto",
    "streaming": false,
    "forceHybridRag": true,
    "courseCode": "COSC111",
    "apiKeys": {"vllm": {"apiKey": "vllm-local", "isEnabled": true}}
  }' | head -c 1500
echo
head -1 /tmp/h2.txt
