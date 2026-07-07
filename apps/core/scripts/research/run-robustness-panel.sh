#!/usr/bin/env bash
# Run frozen P0+P1 on the 20-prompt robustness panel with 3 replicates and energy.
#
# Prereqs: dev EduAI up, courses published, RESEARCH_RUN_* env set (see env.research.example).
#
# Usage (from apps/core):
#   bash ./scripts/research/run-robustness-panel.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PANEL="${SCRIPT_DIR}/data/task-suite/robustness-panel.v1.json"
OUT="${RESEARCH_POLICY_OUT:-docs/research/data/runs/policy-runs-robustness-panel-v1.jsonl}"

if [[ ! -f "$PANEL" ]]; then
  echo "Missing panel: $PANEL" >&2
  exit 1
fi

IDS="$(node -e "
const p=require('${PANEL//\\/\\\\}');
console.log(p.prompt_ids.join(','));
")"

export RESEARCH_SUITE_VERSION=v2
export RESEARCH_POLICY="${RESEARCH_POLICY:-both}"
export RESEARCH_RUN_SPLIT="${RESEARCH_RUN_SPLIT:-all}"
export RESEARCH_RUN_IDS="$IDS"
export RESEARCH_REPLICATE="${RESEARCH_REPLICATE:-3}"
export RESEARCH_RUN_LABEL="${RESEARCH_RUN_LABEL:-robustness-panel-v1}"
export RESEARCH_POLICY_OUT="$OUT"
export RESEARCH_RUN_SLEEP_MS="${RESEARCH_RUN_SLEEP_MS:-500}"

echo "=== robustness panel ==="
echo "panel: $PANEL"
echo "prompts: $(echo "$IDS" | tr ',' '\n' | wc -l | tr -d ' ')"
echo "replicates: $RESEARCH_REPLICATE"
echo "policies: $RESEARCH_POLICY"
echo "out: $OUT"
echo ""

node "${SCRIPT_DIR}/run-policy-comparison.mjs"

echo ""
echo "=== summarize replicates ==="
node "${SCRIPT_DIR}/summarize-policy-replicates.mjs" "$OUT"

echo ""
echo "=== robustness + sensitivity summary ==="
node "${SCRIPT_DIR}/research-robustness-summary.mjs" "$OUT"
