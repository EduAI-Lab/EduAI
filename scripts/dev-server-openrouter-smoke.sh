#!/usr/bin/env bash
set -euo pipefail
cd /srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core

OR_KEY=$(grep '^OPENROUTER_API_KEY=' .env | cut -d= -f2- | tr -d '"')
COOKIE=/tmp/eduai-smoke-cookies.txt
rm -f "$COOKIE"

echo "== sign-in =="
SIGN_STATUS=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST 'http://127.0.0.1:3000/api/auth/sign-in/email' \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@eduai.local","password":"EduAI2026!"}' \
  -o /tmp/signin.json -w '%{http_code}')
echo "sign-in status=$SIGN_STATUS"
head -c 300 /tmp/signin.json; echo

if [ "$SIGN_STATUS" != "200" ]; then
  echo "sign-in failed; skipping /api/chat HTTP test"
  exit 0
fi

echo "== /api/chat openrouter =="
CHAT_STATUS=$(curl -sS -c "$COOKIE" -b "$COOKIE" \
  -X POST 'http://127.0.0.1:3000/api/chat' \
  -H 'Content-Type: application/json' \
  -d "$(node -e "
const key = process.env.OR_KEY;
console.log(JSON.stringify({
  messages: [{ role: 'user', content: 'Say pong only.' }],
  model: 'openrouter:google/gemini-2.5-flash',
  apiKeys: { openrouter: { apiKey: key, isEnabled: true } },
  streaming: false,
}));
" OR_KEY="$OR_KEY")" \
  -o /tmp/chat.json -w '%{http_code}')
echo "chat status=$CHAT_STATUS"
head -c 800 /tmp/chat.json; echo
