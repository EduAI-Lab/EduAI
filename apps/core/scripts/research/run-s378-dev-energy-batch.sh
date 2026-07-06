#!/usr/bin/env bash
# Dev split P0+P1 with measured GPU Joules via cmps01 energy sidecar.
#
# Usage (SSH to s378):
#   nohup bash scripts/research/run-s378-dev-energy-batch.sh >>/tmp/ura-dev-energy-v1.log 2>&1 &
#   tail -f /tmp/ura-dev-energy-v1.log
set -euo pipefail

CORE="${RESEARCH_CORE_DIR:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core}"
RUNS="${RESEARCH_RUNS_DIR:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/docs/research/data/runs}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${RESEARCH_POLICY_OUT:-$RUNS/policy-runs-both-dev-energy-$STAMP.jsonl}"
LOG="${RESEARCH_DEV_ENERGY_LOG:-/tmp/ura-dev-energy-v1.log}"

exec >>"$LOG" 2>&1
echo "=== dev P0+P1 energy batch start $(date -Iseconds) stamp=$STAMP ==="

cd "$CORE"
set -a
# shellcheck disable=SC1091
source .env
# shellcheck disable=SC1091
source <(sed '1s/^\xEF\xBB\xBF//' .env.research)
set +a

# Cookie auth only — x-api-key in .env is admin-restricted on current branch.
unset RESEARCH_RUN_X_API_KEY CHAT_BENCH_X_API_KEY RESEARCH_RUN_LIMIT

export EDUAI_INTERNAL_KEY="${EDUAI_INTERNAL_KEY:-${CMPS01_INTERNAL_KEY:-}}"
export ENERGY_SIDECAR_URL="${ENERGY_SIDECAR_URL:-http://cmps01.ok.ubc.ca:8001/energy}"
export RESEARCH_MEASURE_ENERGY=1
export RESEARCH_RUN_SPLIT=dev
export RESEARCH_POLICY=both
export RESEARCH_RUN_LABEL="both-dev-energy-$STAMP"
export RESEARCH_POLICY_OUT="$OUT"
export RESEARCH_RUN_SLEEP_MS="${RESEARCH_RUN_SLEEP_MS:-500}"
export RESEARCH_RUNS_DIR="$RUNS"

node scripts/research/verify-energy-sidecar.mjs || {
  echo "WARN: energy preflight failed — continuing (Joules may be null)"
}

echo "=== policy run → $OUT ==="
node scripts/research/run-policy-comparison.mjs

RESEARCH_POLICY_OUT="$OUT" node scripts/research/summarize-policy-runs.mjs \
  | tee "${OUT%.jsonl}-summary.txt"

echo "=== dev energy batch done $(date -Iseconds) ==="
echo "OUT=$OUT"
echo "ALL_DONE"
