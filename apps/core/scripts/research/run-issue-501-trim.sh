#!/usr/bin/env bash
# Issue #501 — trimmed 15–30 min run (RAG-focused, 7B only).
#
# Shows pipeline improvements via:
#   Track A — retrieval hit rate / latency (no LLM, ~1 min)
#   Track B — 12 fixed rag_grounded prompts, full /api/chat (~4–6 min)
#   Track C — 30 students @ c=5 classroom load (~2 min)
#
# Compare latest vs main: run twice with different pipeline labels (or parallel:
#   latest on dev.eduai, main-baseline on my.eduai).
#
# Usage:
#   bash scripts/research/run-issue-501-trim.sh [pipeline-label]
#   bash scripts/research/run-issue-501-trim.sh latest --with-energy
#
# Skip tracks: RESEARCH_ISSUE_501_SKIP=A|B|C (e.g. skip Track A on my if no DB)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
RUNS_DIR="${RESEARCH_RUNS_DIR:-$CORE_DIR/../../docs/research/data/runs/issue-501-trim}"
PIPELINE_LABEL="latest"
WITH_ENERGY=0
for arg in "$@"; do
  case "$arg" in
    --with-energy) WITH_ENERGY=1 ;;
    *) PIPELINE_LABEL="$arg" ;;
  esac
done
GIT_SHA="$(git -C "$CORE_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"

# 12 fixed RAG prompts — same IDs on main and latest for apples-to-apples
export RESEARCH_TRIM_PROMPT_IDS="${RESEARCH_TRIM_PROMPT_IDS:-ts-020,ts-023,ts-025,ts-033,ts-044,ts-047,ts-070,ts-075,ts-081,ts-087,ts-104,ts-111}"

mkdir -p "$RUNS_DIR"
cd "$CORE_DIR"

export RESEARCH_PIPELINE_LABEL="$PIPELINE_LABEL"
export RESEARCH_GIT_SHA="$GIT_SHA"
export RESEARCH_RUN_SPLIT="${RESEARCH_RUN_SPLIT:-dev}"
export RESEARCH_RUN_SLEEP_MS="${RESEARCH_RUN_SLEEP_MS:-200}"
export RESEARCH_FIXED_MODEL="${RESEARCH_FIXED_MODEL:-7B}"

if [[ "$WITH_ENERGY" == "1" || "${RESEARCH_MEASURE_ENERGY:-}" == "1" ]]; then
  export RESEARCH_MEASURE_ENERGY=1
  export ENERGY_SIDECAR_URL="${ENERGY_SIDECAR_URL:-http://cmps01.ok.ubc.ca:8001/energy}"
  echo "=== energy preflight ==="
  node scripts/research/verify-energy-sidecar.mjs
else
  export RESEARCH_MEASURE_ENERGY="${RESEARCH_MEASURE_ENERGY:-0}"
fi

echo "=== Issue #501 TRIM run ==="
echo "pipeline: $PIPELINE_LABEL @ $GIT_SHA"
echo "outputs: $RUNS_DIR"
echo "Track B prompt IDs: $RESEARCH_TRIM_PROMPT_IDS"
echo ""

run_track_a() {
  echo "=== Track A: retrieval ($PIPELINE_LABEL) — 20 rag_grounded ==="
  export RESEARCH_RUN_LIMIT=20
  export RESEARCH_EVAL_RAG_OUT="$RUNS_DIR/track-a-${PIPELINE_LABEL}.jsonl"
  export RESEARCH_EVAL_RAG_SUMMARY="$RUNS_DIR/track-a-${PIPELINE_LABEL}-summary.txt"
  npm run research:eval-rag
}

run_track_b() {
  echo "=== Track B: 12 RAG chat prompts, 7B ($PIPELINE_LABEL) ==="
  export RESEARCH_FIXED_MODEL=7B
  export RESEARCH_RUN_IDS="$RESEARCH_TRIM_PROMPT_IDS"
  export RESEARCH_RUN_LABEL="501-trim-b-7b-${PIPELINE_LABEL}"
  export RESEARCH_POLICY_OUT="$RUNS_DIR/track-b-7b-${PIPELINE_LABEL}.jsonl"
  unset RESEARCH_RUN_LIMIT
  unset RESEARCH_RUN_CATEGORY
  npm run research:run-policy
  node scripts/research/summarize-issue-501.mjs "$RESEARCH_POLICY_OUT" || true
}

run_track_c() {
  echo "=== Track C: 30 students c=5, 7B ($PIPELINE_LABEL) ==="
  export RESEARCH_FIXED_MODEL=7B
  export RESEARCH_CLASSROOM_STUDENTS="${RESEARCH_CLASSROOM_STUDENTS:-30}"
  export RESEARCH_CLASSROOM_CONCURRENCY="${RESEARCH_CLASSROOM_CONCURRENCY:-5}"
  export RESEARCH_CLASSROOM_SPLIT="${RESEARCH_CLASSROOM_SPLIT:-dev}"
  export RESEARCH_RUN_CATEGORY=rag_grounded
  export RESEARCH_RUN_LABEL="501-trim-c1-7b-${PIPELINE_LABEL}"
  export RESEARCH_CLASSROOM_OUT="$RUNS_DIR/track-c1-7b-${PIPELINE_LABEL}.jsonl"
  export RESEARCH_CLASSROOM_SUMMARY="$RUNS_DIR/track-c1-7b-${PIPELINE_LABEL}.txt"
  export RESEARCH_RUN_TIMEOUT_MS="${RESEARCH_RUN_TIMEOUT_MS:-180000}"
  unset RESEARCH_RUN_IDS
  npm run research:run-classroom
}

if [[ "${RESEARCH_ISSUE_501_SKIP:-}" != *A* ]]; then
  run_track_a
fi

if [[ "${RESEARCH_ISSUE_501_SKIP:-}" != *B* ]]; then
  run_track_b
fi

if [[ "${RESEARCH_ISSUE_501_SKIP:-}" != *C* ]]; then
  run_track_c
fi

echo ""
echo "=== Issue #501 TRIM complete ==="
echo "pipeline: $PIPELINE_LABEL"
echo "git: $GIT_SHA"
echo "outputs: $RUNS_DIR"
echo ""
echo "Compare (after main-baseline run):"
echo "  node scripts/research/compare-issue-501-trim.mjs $RUNS_DIR"
