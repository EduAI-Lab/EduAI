#!/usr/bin/env bash
# Retry failed P0 + full P1 dev energy runs (after branch sync + Auto routing restore).
#
# Usage (SSH to s378):
#   nohup bash scripts/research/run-s378-dev-energy-retry.sh >>/tmp/ura-dev-energy-retry.log 2>&1 &
#   tail -f /tmp/ura-dev-energy-retry.log
set -euo pipefail

CORE="${RESEARCH_CORE_DIR:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core}"
RUNS="${RESEARCH_RUNS_DIR:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/docs/research/data/runs}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="${RESEARCH_DEV_ENERGY_RETRY_LOG:-/tmp/ura-dev-energy-retry.log}"

P0_RETRY_IDS="${RESEARCH_P0_RETRY_IDS:-ts-025,ts-044,ts-047,ts-048,ts-049,ts-050,ts-051,ts-052,ts-053,ts-054,ts-056,ts-057,ts-058,ts-059,ts-060,ts-061,ts-063,ts-065,ts-066,ts-067,ts-068,ts-070,ts-071,ts-072,ts-073,ts-074,ts-075,ts-076,ts-077,ts-078,ts-079,ts-081,ts-083,ts-085,ts-086,ts-087,ts-088,ts-089,ts-104,ts-109,ts-110}"

exec >>"$LOG" 2>&1
echo "=== dev energy retry start $(date -Iseconds) stamp=$STAMP ==="

cd "$CORE"
set -a
# shellcheck disable=SC1091
source .env
# shellcheck disable=SC1091
source <(sed '1s/^\xEF\xBB\xBF//' .env.research)
set +a

unset RESEARCH_RUN_X_API_KEY CHAT_BENCH_X_API_KEY RESEARCH_RUN_LIMIT

export EDUAI_INTERNAL_KEY="${EDUAI_INTERNAL_KEY:-${CMPS01_INTERNAL_KEY:-}}"
export ENERGY_SIDECAR_URL="${ENERGY_SIDECAR_URL:-http://cmps01.ok.ubc.ca:8001/energy}"
export RESEARCH_MEASURE_ENERGY=1
export RESEARCH_RUN_SPLIT=dev
export RESEARCH_RUN_SLEEP_MS="${RESEARCH_RUN_SLEEP_MS:-500}"
export RESEARCH_RUNS_DIR="$RUNS"

node scripts/research/verify-energy-sidecar.mjs || echo "WARN: energy preflight failed"

run_policy() {
  local policy="$1"
  local ids="$2"
  local out="$3"
  local label="$4"
  echo "=== ${policy} retry (${ids//,/ }) → ${out} ==="
  export RESEARCH_POLICY="$policy"
  export RESEARCH_RUN_IDS="$ids"
  export RESEARCH_POLICY_OUT="$out"
  export RESEARCH_RUN_LABEL="$label"
  node scripts/research/run-policy-comparison.mjs
  RESEARCH_POLICY_OUT="$out" node scripts/research/summarize-policy-runs.mjs \
    | tee "${out%.jsonl}-summary.txt"
}

P0_OUT="$RUNS/policy-runs-p0-dev-energy-retry-$STAMP.jsonl"
P1_OUT="$RUNS/policy-runs-p1-dev-energy-retry-$STAMP.jsonl"

run_policy P0 "$P0_RETRY_IDS" "$P0_OUT" "p0-dev-energy-retry-$STAMP"
unset RESEARCH_RUN_IDS
run_policy P1 "" "$P1_OUT" "p1-dev-energy-retry-$STAMP"

echo "=== dev energy retry done $(date -Iseconds) ==="
echo "P0_OUT=$P0_OUT"
echo "P1_OUT=$P1_OUT"
echo "ALL_DONE"
