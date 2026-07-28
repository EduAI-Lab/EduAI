#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=== Verify backend ==="
curl -fsS http://127.0.0.1:18001/v1/models
echo

echo "=== Start LiteLLM and nginx edge ==="
docker compose up -d

for _ in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:8001/v1/models \
      -H "Authorization: Bearer vllm-local" >/dev/null; then
    echo "=== Edge ready ==="
    curl -fsS http://127.0.0.1:8001/v1/models \
      -H "Authorization: Bearer vllm-local"
    echo
    exit 0
  fi
  sleep 3
done

echo "ERROR: edge did not become ready"
docker compose ps
exit 1

