#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${VLLM_API_KEY:?Set VLLM_API_KEY in .env}"
: "${EDUAI_INTERNAL_KEY:?Set EDUAI_INTERNAL_KEY in .env}"
EDGE_HOST="${EDGE_HOST:-http://127.0.0.1:8001}"

expect_code() {
  label="$1"; url="$2"; expected="$3"; shift 3
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$@" "$url" || true)"
  if [ "$code" != "$expected" ]; then
    echo "FAIL ${label}: expected ${expected}, got ${code:-no-response}"
    return 1
  fi
  echo "OK ${label}: HTTP ${code}"
}

expect_code "model list without bearer" "${EDGE_HOST}/v1/models" 401
expect_code "model list with bearer" "${EDGE_HOST}/v1/models" 200 \
  -H "Authorization: Bearer ${VLLM_API_KEY}"
expect_code "energy without internal key" "${EDGE_HOST}/energy/health" 403
expect_code "energy with internal key" "${EDGE_HOST}/energy/health" 200 \
  -H "X-EduAI-Internal-Key: ${EDUAI_INTERNAL_KEY}"

curl -fsS "${EDGE_HOST}/v1/models" \
  -H "Authorization: Bearer ${VLLM_API_KEY}" |
  grep -q '"qwen3.5-2b"'
curl -fsS "${EDGE_HOST}/v1/models" \
  -H "Authorization: Bearer ${VLLM_API_KEY}" |
  grep -q '"qwen3.5-27b"'
