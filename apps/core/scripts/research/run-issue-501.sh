#!/usr/bin/env bash
# Issue #501 — sequential batch runner for dev (s378).
#
# Usage:
#   bash scripts/research/run-issue-501.sh [pipeline-label]
#   bash scripts/research/run-issue-501.sh latest --with-energy
#
# pipeline-label defaults to "latest". Set RESEARCH_ISSUE_501_SKIP=* to skip tracks.
# Requires .env.research loaded (see env.research.s378.example).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
RUNS_DIR="${RESEARCH_RUNS_DIR:-$CORE_DIR/../../docs/research/data/runs/issue-501}"
PIPELINE_LABEL="latest"
WITH_ENERGY=0
for arg in "$@"; do
  case "$arg" in
    --with-energy) WITH_ENERGY=1 ;;
    *) PIPELINE_LABEL="$arg" ;;
  esac
done
GIT_SHA="$(git -C "$CORE_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
MODELS=(7B 32B)

mkdir -p "$RUNS_DIR"
cd "$CORE_DIR"

export RESEARCH_PIPELINE_LABEL="$PIPELINE_LABEL"
export RESEARCH_GIT_SHA="$GIT_SHA"
export RESEARCH_RUN_SPLIT="${RESEARCH_RUN_SPLIT:-dev}"
export RESEARCH_RUN_SLEEP_MS="${RESEARCH_RUN_SLEEP_MS:-500}"

if [[ "$WITH_ENERGY" == "1" || "${RESEARCH_MEASURE_ENERGY:-}" == "1" ]]; then
  export RESEARCH_MEASURE_ENERGY=1
  export ENERGY_SIDECAR_URL="${ENERGY_SIDECAR_URL:-http://cmps01.ok.ubc.ca:8001/energy}"
  echo "=== energy preflight ==="
  node scripts/research/verify-energy-sidecar.mjs
else
  export RESEARCH_MEASURE_ENERGY="${RESEARCH_MEASURE_ENERGY:-0}"
fi

run_track_a() {
  echo "=== Track A: retrieval ($PIPELINE_LABEL) ==="
  export RESEARCH_RUN_LIMIT=20
  export RESEARCH_EVAL_RAG_OUT="$RUNS_DIR/track-a-${PIPELINE_LABEL}.jsonl"
  export RESEARCH_EVAL_RAG_SUMMARY="$RUNS_DIR/track-a-${PIPELINE_LABEL}-summary.txt"
  npm run research:eval-rag
}

run_track_b() {
  local model="$1"
  echo "=== Track B: sequential sweep $model ($PIPELINE_LABEL) ==="
  export RESEARCH_FIXED_MODEL="$model"
  export RESEARCH_RUN_LABEL="501-track-b-${model}-${PIPELINE_LABEL}"
  export RESEARCH_POLICY_OUT="$RUNS_DIR/track-b-${model}-${PIPELINE_LABEL}.jsonl"
  unset RESEARCH_RUN_LIMIT
  npm run research:run-policy
  node scripts/research/summarize-issue-501.mjs "$RESEARCH_POLICY_OUT" || true
}

run_track_c() {
  local model="$1"
  local scenario="$2"
  local students="$3"
  local concurrency="$4"
  echo "=== Track C: $scenario $model ($PIPELINE_LABEL) ==="
  export RESEARCH_FIXED_MODEL="$model"
  export RESEARCH_CLASSROOM_STUDENTS="$students"
  export RESEARCH_CLASSROOM_CONCURRENCY="$concurrency"
  export RESEARCH_CLASSROOM_SPLIT="${RESEARCH_CLASSROOM_SPLIT:-dev}"
  export RESEARCH_RUN_LABEL="501-${scenario}-${model}-${PIPELINE_LABEL}"
  export RESEARCH_CLASSROOM_OUT="$RUNS_DIR/track-${scenario}-${model}-${PIPELINE_LABEL}.jsonl"
  export RESEARCH_CLASSROOM_SUMMARY="$RUNS_DIR/track-${scenario}-${model}-${PIPELINE_LABEL}.txt"
  if [[ "$model" == "120B" ]]; then
    export RESEARCH_RUN_TIMEOUT_MS=300000
  else
    export RESEARCH_RUN_TIMEOUT_MS="${RESEARCH_RUN_TIMEOUT_MS:-180000}"
  fi
  npm run research:run-classroom
}

if [[ "${RESEARCH_ISSUE_501_SKIP:-}" != *A* ]]; then
  run_track_a
fi

if [[ "${RESEARCH_ISSUE_501_SKIP:-}" != *B* ]]; then
  for model in "${MODELS[@]}"; do
    run_track_b "$model"
  done
fi

if [[ "${RESEARCH_ISSUE_501_SKIP:-}" != *C* ]]; then
  for model in "${MODELS[@]}"; do
    run_track_c "$model" c1 100 5
    run_track_c "$model" c2 100 10
  done
fi

echo ""
echo "=== Issue #501 batch complete ==="
echo "pipeline: $PIPELINE_LABEL"
echo "git: $GIT_SHA"
echo "outputs: $RUNS_DIR"
