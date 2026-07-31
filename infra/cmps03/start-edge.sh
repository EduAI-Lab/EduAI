#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
set -a
# shellcheck disable=SC1091
source .env
set +a

docker compose up -d eduai-vllm-proxy eduai-energy-meter eduai-edge-proxy

models="$(curl -fsS http://127.0.0.1:8001/v1/models \
  -H "Authorization: Bearer ${VLLM_API_KEY}")"
echo "$models" | grep -q '"qwen3.5-4b"'
echo "$models" | grep -q '"qwen3.5-9b"'
curl -fsS http://127.0.0.1:8001/energy/health \
  -H "X-EduAI-Internal-Key: ${EDUAI_INTERNAL_KEY}" |
  grep -q '"canMeasure":true'

code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8001/v1/models)"
[ "$code" = "401" ]
code="$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:8001/energy/health)"
[ "$code" = "403" ]

echo "cmps03 Qwen3.5 ladder profile ready"
