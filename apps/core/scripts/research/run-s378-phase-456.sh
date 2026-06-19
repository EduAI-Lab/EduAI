#!/usr/bin/env bash
# Tasks 4–6 on s378: routing benchmark (P1/P3a/P3b dev), strict re-label, 100-student classroom.
#
# Prereqs: latest apps/core deployed (auto-hybrid, P3b tune, energy sidecar defaults).
#
# Usage (SSH as ssaada08@dev.eduai.ok.ubc.ca):
#   cd /srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core
#   git pull && npm run build && pm2 restart eduai-dev   # or your process manager
#   nohup bash scripts/research/run-s378-phase-456.sh >>/tmp/ura-phase-456.log 2>&1 &
#   tail -f /tmp/ura-phase-456.log
set -euo pipefail
CORE="${RESEARCH_CORE_DIR:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core}"
URA_RUNS="${URA_RESEARCH_RUNS:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/docs/research/data/runs}"
ENERGY_METER_DIR="${ENERGY_METER_DIR:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/tools/energy-meter}"
LOG="${RESEARCH_PHASE_456_LOG:-/tmp/ura-phase-456.log}"

exec >>"$LOG" 2>&1
echo "=== phase 4-6 start $(date -Iseconds) ==="

cd "$CORE"
set -a
source .env
if [[ -f .env.research ]]; then
  source <(sed '1s/^\xEF\xBB\xBF//' .env.research)
fi
set +a
unset RESEARCH_RUN_LIMIT

# Energy: sidecar must run on cmps01 (GPU host), not s378
export ENERGY_SIDECAR_URL="${ENERGY_SIDECAR_URL:-http://cmps01.ok.ubc.ca:8001/energy}"
export RESEARCH_MEASURE_ENERGY=1
export RESEARCH_RUN_SLEEP_MS="${RESEARCH_RUN_SLEEP_MS:-500}"

echo "=== energy preflight (cmps01) ==="
node scripts/research/verify-energy-sidecar.mjs || {
  echo "FAIL: energy sidecar not ready. Deploy on cmps01: tools/energy-meter/deploy-cmps01.sh"
  echo "      and infra/cmps01/deploy-edge-proxy.sh (ENERGY_SIDECAR_URL=http://cmps01.ok.ubc.ca:8001/energy)."
  exit 1
}

# --- Task 4: P1 vs P3a (hybrid) vs P3b on dev (96 prompts) ---
export RESEARCH_POLICY=ROUTING
export RESEARCH_RUN_SPLIT=dev
export RESEARCH_RUN_LABEL=routing-dev-v1
export RESEARCH_POLICY_OUT="$URA_RUNS/policy/policy-runs-routing-dev-v1.jsonl"
mkdir -p "$(dirname "$RESEARCH_POLICY_OUT")"

echo "=== task 4: routing benchmark (P1/P3a/P3b dev) ==="
node scripts/research/run-policy-comparison.mjs

RESEARCH_POLICY_OUT="$RESEARCH_POLICY_OUT" \
  RESEARCH_LABEL_OUT="$URA_RUNS/labels/labels.v1.jsonl" \
  node scripts/research/summarize-policy-runs.mjs \
  | tee "$URA_RUNS/policy/policy-runs-routing-dev-v1-summary.txt"

# --- Task 5: strict LLM re-label (oracle for router eval) ---
export RESEARCH_JUDGE_VIA_EDUAI=1
export RESEARCH_JUDGE_STRICT=1
export RESEARCH_LABEL_IN="$URA_RUNS/labels/both-tier.v1.jsonl"
export RESEARCH_LABEL_OUT="$URA_RUNS/labels/labels-strict.v1.jsonl"
export RESEARCH_LABEL_VERSION=strict-v1
export RESEARCH_LABEL_SLEEP_MS=300

echo "=== task 5: strict re-label (96 prompts) ==="
node scripts/research/label-both-tier-runs.mjs

RESEARCH_LABEL_OUT="$RESEARCH_LABEL_OUT" node scripts/research/summarize-both-tier-labels.mjs \
  | tee "$URA_RUNS/labels/labels-strict.v1-summary.txt"

# Re-eval routers against strict labels (offline)
export RESEARCH_LABEL_IN="$RESEARCH_LABEL_OUT"
echo "=== eval P3a/P3b vs strict labels ==="
RESEARCH_RUN_SPLIT=dev npx tsx scripts/research/evaluate-knn-router.ts 2>/dev/null || true
RESEARCH_RUN_SPLIT=dev npx tsx scripts/research/evaluate-llm-router.ts 2>/dev/null || true

# --- Task 6: 100-student classroom sim (P0, P1, P3b) ---
export RESEARCH_CLASSROOM_STUDENTS=100
export RESEARCH_CLASSROOM_CONCURRENCY="${RESEARCH_CLASSROOM_CONCURRENCY:-10}"
export RESEARCH_CLASSROOM_SPLIT=test
export RESEARCH_RUN_LABEL=classroom-100-v1

run_classroom() {
  local policy="$1"
  export RESEARCH_CLASSROOM_POLICY="$policy"
  export RESEARCH_CLASSROOM_OUT="$URA_RUNS/classroom/classroom-${policy,,}-100-v1.jsonl"
  export RESEARCH_CLASSROOM_SUMMARY="$URA_RUNS/classroom/classroom-${policy,,}-100-v1-summary.txt"
  mkdir -p "$(dirname "$RESEARCH_CLASSROOM_OUT")"
  echo "=== task 6: classroom $policy (100 students) ==="
  node scripts/research/run-classroom-sim.mjs
}

run_classroom P0
run_classroom P1
run_classroom P3b

echo "=== phase 4-6 done $(date -Iseconds) ==="
echo "ALL_DONE"
