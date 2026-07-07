#!/usr/bin/env bash
# Frozen P1 on all sensitivity variants + their base prompts (tier flip analysis).
#
# Usage (from apps/core):
#   RESEARCH_SUITE_VERSION=v2 npm run research:run-sensitivity
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${RESEARCH_POLICY_OUT:-docs/research/data/runs/policy-runs-sensitivity-v1.jsonl}"

IDS="$(RESEARCH_SUITE_VERSION=v2 node -e "
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const path = join('${SCRIPT_DIR//\\/\\\\}', 'data/task-suite/prompts.v2.jsonl');
const rows = readFileSync(path,'utf8').trim().split('\n').map(l=>JSON.parse(l));
const bases = new Set();
const ids = new Set();
for (const r of rows) {
  if (!r.sensitivity_group) continue;
  ids.add(r.id);
  if (r.replicate_of) bases.add(r.replicate_of);
}
for (const b of bases) ids.add(b);
console.log([...ids].sort().join(','));
")"

if [[ -z "$IDS" ]]; then
  echo "No sensitivity rows in prompts.v2.jsonl" >&2
  exit 1
fi

export RESEARCH_SUITE_VERSION=v2
export RESEARCH_POLICY="${RESEARCH_POLICY:-P1}"
export RESEARCH_RUN_SPLIT=all
export RESEARCH_RUN_IDS="$IDS"
export RESEARCH_REPLICATE="${RESEARCH_REPLICATE:-1}"
export RESEARCH_RUN_LABEL="${RESEARCH_RUN_LABEL:-sensitivity-v1}"
export RESEARCH_POLICY_OUT="$OUT"
export RESEARCH_RUN_SLEEP_MS="${RESEARCH_RUN_SLEEP_MS:-400}"

N="$(echo "$IDS" | tr ',' '\n' | wc -l | tr -d ' ')"
echo "=== sensitivity batch (frozen P1) ==="
echo "prompts: $N (variants + bases)"
echo "out: $OUT"
echo ""

node "${SCRIPT_DIR}/run-policy-comparison.mjs"

echo ""
node "${SCRIPT_DIR}/research-robustness-summary.mjs" "$OUT"
