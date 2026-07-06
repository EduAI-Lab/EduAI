#!/usr/bin/env bash
# P1 dev energy (96) + remaining P0 failures.
set -euo pipefail

CORE="${RESEARCH_CORE_DIR:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core}"
RUNS="${RESEARCH_RUNS_DIR:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/docs/research/data/runs}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="/tmp/ura-dev-energy-retry2.log"
P0_IDS="${RESEARCH_P0_RETRY_IDS:-ts-025,ts-044,ts-070,ts-071,ts-075,ts-076,ts-079,ts-083,ts-086,ts-104,ts-109,ts-110}"

exec >>"$LOG" 2>&1
echo "=== p1+p0 retry2 start $(date -Iseconds) stamp=$STAMP ==="

cd "$CORE"
set -a
source .env
source <(sed '1s/^\xEF\xBB\xBF//' .env.research)
set +a

unset RESEARCH_RUN_X_API_KEY CHAT_BENCH_X_API_KEY RESEARCH_RUN_LIMIT
export EDUAI_INTERNAL_KEY="${EDUAI_INTERNAL_KEY:-${CMPS01_INTERNAL_KEY:-}}"
export ENERGY_SIDECAR_URL="${ENERGY_SIDECAR_URL:-http://cmps01.ok.ubc.ca:8001/energy}"
export RESEARCH_MEASURE_ENERGY=1
export RESEARCH_RUN_SPLIT=dev
export RESEARCH_RUN_SLEEP_MS=500
export RESEARCH_RUNS_DIR="$RUNS"

P1_OUT="$RUNS/policy-runs-p1-dev-energy-retry2-$STAMP.jsonl"
echo "=== P1 dev (96) → $P1_OUT ==="
export RESEARCH_POLICY=P1 RESEARCH_RUN_LABEL="p1-dev-energy-retry2-$STAMP" RESEARCH_POLICY_OUT="$P1_OUT"
unset RESEARCH_RUN_IDS
node scripts/research/run-policy-comparison.mjs || true

P0_OUT="$RUNS/policy-runs-p0-dev-energy-retry2-$STAMP.jsonl"
echo "=== P0 retry ($P0_IDS) → $P0_OUT ==="
export RESEARCH_POLICY=P0 RESEARCH_RUN_IDS="$P0_IDS" RESEARCH_RUN_LABEL="p0-dev-energy-retry2-$STAMP" RESEARCH_POLICY_OUT="$P0_OUT"
node scripts/research/run-policy-comparison.mjs || true

echo "=== done $(date -Iseconds) ==="
echo "P1_OUT=$P1_OUT"
echo "P0_OUT=$P0_OUT"
echo "ALL_DONE"
