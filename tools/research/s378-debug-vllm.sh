#!/usr/bin/env bash
set -euo pipefail
CORE=/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core
cd "$CORE"
set -a
source .env
source <(sed '1s/^\xEF\xBB\xBF//' .env.research)
set +a

echo "=== vllm models with key ==="
curl -s -o /tmp/vllm-models.json -w "http=%{http_code}\n" \
  -H "Authorization: Bearer ${VLLM_API_KEY}" \
  "${VLLM_BASE_URL}/v1/models"
head -c 300 /tmp/vllm-models.json
echo

echo "=== enrollments for a@mail.com ==="
psql "${DATABASE_URL}" -t -A -c "SELECT c.code, c.\"isPublished\" FROM \"Enrollment\" e JOIN \"Course\" c ON c.id=e.\"courseId\" JOIN \"User\" u ON u.id=e.\"userId\" WHERE u.email='a@mail.com' AND e.\"deletedAt\" IS NULL LIMIT 10;" 2>/dev/null || \
  psql postgresql://eduai:eduai@127.0.0.1:54320/eduai -t -A -c "SELECT c.code, c.\"isPublished\" FROM \"Enrollment\" e JOIN \"Course\" c ON c.id=e.\"courseId\" JOIN \"User\" u ON u.id=e.\"userId\" WHERE u.email='a@mail.com' LIMIT 10;" 2>/dev/null || echo "psql failed"

COURSE=$(psql postgresql://eduai:eduai@127.0.0.1:54320/eduai -t -A -c "SELECT c.code FROM \"Enrollment\" e JOIN \"Course\" c ON c.id=e.\"courseId\" JOIN \"User\" u ON u.id=e.\"userId\" WHERE u.email='a@mail.com' AND c.\"isPublished\"=true LIMIT 1;" 2>/dev/null | tr -d '[:space:]')
echo "picked course: [${COURSE}]"

if [[ -n "$COURSE" ]]; then
  echo "=== cookie chat with course $COURSE ==="
  curl -s -D /tmp/h3.txt -X POST http://127.0.0.1:3000/api/chat \
    -H "Content-Type: application/json" \
    -H "Cookie: $RESEARCH_RUN_COOKIE" \
    -d "{\"messages\":[{\"id\":\"debug-u3\",\"role\":\"user\",\"content\":\"Say hi in one word\"}],\"model\":\"auto\",\"streaming\":false,\"courseCode\":\"$COURSE\",\"apiKeys\":{\"vllm\":{\"apiKey\":\"${VLLM_API_KEY}\",\"isEnabled\":true}}}" | head -c 1500
  echo
  head -1 /tmp/h3.txt
  grep -i x-routing /tmp/h3.txt || true
fi

echo "=== bearer chat with real vllm key ==="
curl -s -D /tmp/h4.txt -X POST http://127.0.0.1:3000/api/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${EDUAI_API_KEY}" \
  -d "{\"messages\":[{\"id\":\"debug-u4\",\"role\":\"user\",\"content\":\"Say hi in one word\"}],\"model\":\"auto\",\"streaming\":false,\"apiKeys\":{\"vllm\":{\"apiKey\":\"${VLLM_API_KEY}\",\"isEnabled\":true}}}" | head -c 1500
echo
head -1 /tmp/h4.txt
grep -i x-routing /tmp/h4.txt || true
