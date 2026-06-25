#!/usr/bin/env bash
set -euo pipefail
CORE=/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core
cd "$CORE"
set -a
source .env
source <(sed '1s/^\xEF\xBB\xBF//' .env.research)
set +a

curl -s -D /tmp/chat-headers.txt -X POST "$RESEARCH_RUN_URL" \
  -H "Content-Type: application/json" \
  -H "Cookie: $RESEARCH_RUN_COOKIE" \
  -d '{
    "messages": [{"id": "debug-u1", "role": "user", "content": "Reply with exactly: smoke ok"}],
    "model": "auto",
    "streaming": false,
    "forceHybridRag": true,
    "apiKeys": {"vllm": {"apiKey": "vllm-local", "isEnabled": true}}
  }' | head -c 2000

echo
echo "--- headers ---"
head -20 /tmp/chat-headers.txt
