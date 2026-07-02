#!/usr/bin/env bash
# Start 14B easy-stratum adequacy batch on cmps02 (on-host 127.0.0.1:8001).
#
# Usage (from apps/core on laptop with SSH to cmps02):
#   bash ./scripts/research/run-cmps02-14b-easy.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
DATA_DIR="$(cd "$CORE_DIR/../../../docs/research/data" && pwd)"
PROMPTS_LOCAL="$DATA_DIR/runs/adequacy/adequacy-prompts-easy.jsonl"

cd "$CORE_DIR"
RESEARCH_RUN_STRATUM=easy RESEARCH_RUN_OUT="$PROMPTS_LOCAL" \
  node ./scripts/research/export-adequacy-prompts.mjs

echo "=== scp prompts to cmps02 ==="
scp "$PROMPTS_LOCAL" cmps02:~/cmps02/adequacy-prompts-easy.jsonl
scp "$CORE_DIR/../../infra/cmps02/run-adequacy-local.py" cmps02:~/cmps02/run-adequacy-local.py

echo "=== start 14B batch on cmps02 ==="
ssh cmps02 "cd ~/cmps02 && \
  PROMPTS_FILE=adequacy-prompts-easy.jsonl \
  OUT_FILE=adequacy-14b-easy-v1.jsonl \
  RUN_LABEL=adequacy-14b-easy-v1 \
  ADEQUACY_MODEL=qwen2.5-14b-instruct \
  ADEQUACY_TIER_LABEL=medium \
  nohup python3 run-adequacy-local.py > adequacy-14b-easy.log 2>&1 & echo started_pid=\$!"

echo "Monitor: ssh cmps02 'tail -f ~/cmps02/adequacy-14b-easy.log'"
