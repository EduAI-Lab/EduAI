#!/usr/bin/env bash
set -eu

ROOT="${1:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core}"
cd "$ROOT"

if [[ -f .env.research ]]; then
  # shellcheck disable=SC1091
  set -a && source .env.research && set +a
fi

if [[ -f .env ]]; then
  # shellcheck disable=SC1091
  set -a && source .env && set +a
fi

API_URL="${RESEARCH_RUN_URL:-${SMOKE_API_URL:-http://127.0.0.1:3000/api/chat}}"

if [[ -z "${RESEARCH_RUN_COOKIE:-}" && -z "${RESEARCH_RUN_X_API_KEY:-}" && -z "${EDUAI_API_KEY:-}" ]]; then
  echo '{"error":"Set RESEARCH_RUN_COOKIE, RESEARCH_RUN_X_API_KEY, or EDUAI_API_KEY"}'
  exit 1
fi

COURSE_ID="${SMOKE_COURSE_ID:-${RESEARCH_RUN_COURSE_ID:-}}"
if [[ -z "$COURSE_ID" ]]; then
  COURSE_ID="$(node --input-type=module -e "
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const course = await prisma.course.findFirst({
  where: { deletedAt: null, isPublished: true },
  select: { id: true },
  orderBy: { createdAt: 'asc' },
});
console.log(course?.id ?? '');
await prisma.\$disconnect();
")"
fi

if [[ -z "$COURSE_ID" ]]; then
  echo '{"error":"No published course found; set SMOKE_COURSE_ID"}'
  exit 1
fi

auth_curl() {
  local model="$1"
  local args=(
    -s -D /tmp/smoke-headers.txt
    -X POST "$API_URL"
    -H "Content-Type: application/json"
  )
  if [[ -n "${RESEARCH_RUN_COOKIE:-}" ]]; then
    args+=(-H "Cookie: ${RESEARCH_RUN_COOKIE}")
  fi
  if [[ -n "${RESEARCH_RUN_X_API_KEY:-}" ]]; then
    args+=(-H "x-api-key: ${RESEARCH_RUN_X_API_KEY}")
  fi
  if [[ -n "${EDUAI_API_KEY:-}" ]]; then
    args+=(-H "Authorization: Bearer ${EDUAI_API_KEY}")
  fi
  curl "${args[@]}" -d "{
    \"messages\": [{\"id\": \"smoke-u1\", \"role\": \"user\", \"content\": \"Reply with exactly: smoke ok\"}],
    \"model\": \"${model}\",
    \"courseId\": \"${COURSE_ID}\",
    \"streaming\": false,
    \"forceHybridRag\": true,
    \"apiKeys\": {\"vllm\": {\"apiKey\": \"${VLLM_API_KEY:-vllm-local}\", \"isEnabled\": true}}
  }"
}

summarize() {
  node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); console.log(JSON.stringify({model:j.model,routedModel:j.routedModel,promptTokens:j.usage?.promptTokens,completionTokens:j.usage?.completionTokens,preview:(j.content||j.error||'').slice(0,60)}));"
}

echo "=== energy ==="
curl -s "${ENERGY_SIDECAR_URL:-http://cmps01.ok.ubc.ca:8001/energy}/health" | head -c 200
echo

echo "=== auto (course=${COURSE_ID}) ==="
body="$(auth_curl auto)"
status="$(head -1 /tmp/smoke-headers.txt | awk '{print $2}')"
echo "status=$status tier=$(grep -i x-router-tier /tmp/smoke-headers.txt | awk '{print $2}' | tr -d '\r' || true)"
echo "$body" | summarize

echo "=== auto-llm ==="
body="$(auth_curl auto-llm)"
status="$(head -1 /tmp/smoke-headers.txt | awk '{print $2}')"
echo "status=$status"
echo "$body" | summarize
