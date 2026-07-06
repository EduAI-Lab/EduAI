#!/usr/bin/env bash
# Last 4 RAG prompts that failed on unpublished COSC 211 / PHIL 220.
set -euo pipefail

CORE="${RESEARCH_CORE_DIR:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core}"
RUNS="${RESEARCH_RUNS_DIR:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/docs/research/data/runs}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
IDS="ts-044,ts-070,ts-071,ts-086"
LOG="/tmp/ura-dev-energy-last4.log"

exec >>"$LOG" 2>&1
echo "=== last 4 start $(date -Iseconds) ==="

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
export RESEARCH_RUN_IDS="$IDS"
export RESEARCH_RUN_SLEEP_MS=200
export RESEARCH_RUNS_DIR="$RUNS"

node scripts/research/publish-rag-courses.mjs

for POL in P0 P1; do
  OUT="$RUNS/policy-runs-${POL,,}-dev-energy-last4-$STAMP.jsonl"
  echo "=== $POL → $OUT ==="
  export RESEARCH_POLICY="$POL"
  export RESEARCH_RUN_LABEL="${POL,,}-dev-energy-last4-$STAMP"
  export RESEARCH_POLICY_OUT="$OUT"
  node scripts/research/run-policy-comparison.mjs || true
done

node scripts/research/merge-dev-energy-runs.mjs || true
echo "ALL_DONE"
