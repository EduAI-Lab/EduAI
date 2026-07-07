#!/usr/bin/env bash
# Confirmatory v2 batch: held-out TEST split only, P0+P1, 2 replicates, energy.
# Locked by plans/PREREGISTRATION.md — no rule changes after this point.
#
# Usage (from apps/core):
#   RESEARCH_SUITE_VERSION=v2 npm run research:run-v2-test-confirmatory
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${RESEARCH_POLICY_OUT:-docs/research/data/runs/policy-runs-v2-test-confirmatory-v1.jsonl}"

export RESEARCH_SUITE_VERSION=v2
export RESEARCH_POLICY="${RESEARCH_POLICY:-both}"
export RESEARCH_RUN_SPLIT=test
export RESEARCH_REPLICATE="${RESEARCH_REPLICATE:-2}"
export RESEARCH_RUN_LABEL="${RESEARCH_RUN_LABEL:-v2-test-confirmatory-v1}"
export RESEARCH_POLICY_OUT="$OUT"
export RESEARCH_RUN_SLEEP_MS="${RESEARCH_RUN_SLEEP_MS:-500}"

echo "=== v2 confirmatory (test split only) ==="
echo "policies: $RESEARCH_POLICY"
echo "replicates: $RESEARCH_REPLICATE"
echo "out: $OUT"
echo ""

node "${SCRIPT_DIR}/run-policy-comparison.mjs"

echo ""
echo "=== replicate summary ==="
node "${SCRIPT_DIR}/summarize-policy-replicates.mjs" "$OUT"

echo ""
node "${SCRIPT_DIR}/research-robustness-summary.mjs" "$OUT"
