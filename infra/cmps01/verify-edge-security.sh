#!/usr/bin/env bash
# Verify nginx edge blocks anonymous clients and allows s378 + internal key.
# Run on cmps01 after deploy-edge-proxy.sh.
set -euo pipefail

EDGE_HOST="${EDGE_HOST:-http://127.0.0.1:8001}"
FAIL=0

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

expect_code() {
  local label="$1"
  local url="$2"
  local expected="$3"
  shift 3
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$@" "$url" || echo "000")
  if [ "$code" != "$expected" ]; then
    echo "FAIL $label: expected HTTP $expected got $code ($url)"
    FAIL=1
  else
    echo "OK   $label: HTTP $code"
  fi
}

echo "=== edge security probe ($EDGE_HOST) ==="

expect_code "energy without key" "${EDGE_HOST}/energy/health" "403"
expect_code "ollama without key" "${EDGE_HOST}/ollama/api/tags" "403"

if [ -n "${CMPS01_INTERNAL_KEY:-}" ]; then
  expect_code "energy with key" "${EDGE_HOST}/energy/health" "200" \
    -H "X-EduAI-Internal-Key: ${CMPS01_INTERNAL_KEY}"
else
  echo "SKIP energy with key — CMPS01_INTERNAL_KEY not set"
fi

echo ""
echo "From a laptop (should be 403 or unreachable — not 200):"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' http://cmps01.ok.ubc.ca:8001/energy/health"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' http://cmps01.ok.ubc.ca:11434/api/tags"
echo ""

if [ "$FAIL" -ne 0 ]; then
  exit 1
fi
echo "=== all checks passed ==="
