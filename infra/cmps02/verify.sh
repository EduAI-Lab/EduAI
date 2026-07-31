#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
set -a
# shellcheck disable=SC1091
source .env
set +a

EDGE_HOST="${EDGE_HOST:-http://127.0.0.1:8001}"
models="$(curl -fsS "${EDGE_HOST}/v1/models" -H "Authorization: Bearer ${VLLM_API_KEY}")"
echo "$models" | grep -q '"qwen3.5-2b"'
echo "$models" | grep -q '"qwen3.5-27b"'
curl -fsS "${EDGE_HOST}/energy/health" \
  -H "X-EduAI-Internal-Key: ${EDUAI_INTERNAL_KEY}" |
  grep -q '"canMeasure":true'

code="$(curl -sS -o /dev/null -w '%{http_code}' "${EDGE_HOST}/v1/models")"
[ "$code" = "401" ]
code="$(curl -sS -o /dev/null -w '%{http_code}' "${EDGE_HOST}/energy/health")"
[ "$code" = "403" ]
echo "cmps02 edge, models, auth, and energy checks passed"
