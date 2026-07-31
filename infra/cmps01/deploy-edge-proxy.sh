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
: "${INTERNAL_ALLOW_IPS:?Set INTERNAL_ALLOW_IPS to s378 only}"

{
  echo "allow 127.0.0.1;"
  echo "allow ::1;"
  for ip in $INTERNAL_ALLOW_IPS; do
    [ -n "$ip" ] && echo "allow ${ip};"
  done
  echo "deny all;"
} > internal-allow.conf

export EDUAI_INTERNAL_KEY
envsubst '${EDUAI_INTERNAL_KEY}' < nginx.conf.template > nginx.conf

if [ "${1:-}" = "--render-only" ]; then
  exit 0
fi

docker compose up -d eduai-vllm-proxy eduai-energy-meter eduai-edge-proxy
./verify-edge-security.sh
