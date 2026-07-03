#!/usr/bin/env bash
# Run 32B vs 72B judge on cmps02 (on-host 127.0.0.1:8001) using 72B as judge.
# 32B sources: dev both-tier tier-3 + test P0 policy rows.
#
# Usage (from apps/core):
#   bash ./scripts/research/run-cmps02-judge-32b-72b.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
DATA_DIR="$(cd "$CORE_DIR/../../../docs/research/data" && pwd)"
RUNS="$DATA_DIR/runs"

cd "$CORE_DIR"
node ./scripts/research/build-32b-combined-for-judge.mjs

scp "$RUNS/adequacy/adequacy-72b-hard-v1.jsonl" cmps02:~/cmps02/
scp "$RUNS/adequacy/adequacy-32b-combined-v1.jsonl" cmps02:~/cmps02/
mkdir -p /tmp/judge-scripts
scp "$SCRIPT_DIR/label-32b-72b-adequacy.mjs" "$SCRIPT_DIR/both-tier-io.mjs" "$SCRIPT_DIR/paths.mjs" cmps02:~/cmps02/judge-scripts/

ssh cmps02 "mkdir -p ~/cmps02/judge-scripts && cd ~/cmps02/judge-scripts && \
  RESEARCH_ADEQUACY_72B_IN=../adequacy-72b-hard-v1.jsonl \
  RESEARCH_ADEQUACY_32B_IN=../adequacy-32b-combined-v1.jsonl \
  RESEARCH_BOTH_TIER_IN=/dev/null \
  RESEARCH_LABEL_OUT=../labels-32b-72b.v1.jsonl \
  RESEARCH_JUDGE_BASE_URL=http://127.0.0.1:8001/v1 \
  RESEARCH_JUDGE_MODEL=qwen2.5-72b-instruct \
  RESEARCH_JUDGE_API_KEY=vllm-local \
  nohup node label-32b-72b-adequacy.mjs > ../judge-32b-72b.log 2>&1 & echo started_pid=\$!"

echo "Monitor: ssh cmps02 'tail -f ~/cmps02/judge-32b-72b.log'"
