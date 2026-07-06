#!/usr/bin/env bash
# Continue research: full P1 dev + remaining under-route IDs + P0/P1 test energy.
set -euo pipefail

CORE="${RESEARCH_CORE_DIR:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core}"
LOG="${RESEARCH_CONTINUE_LOG:-/tmp/ura-research-continue.log}"
UNDER_IDS="ts-028,ts-037,ts-044,ts-083,ts-094,ts-113,ts-119"

exec >>"$LOG" 2>&1
echo "=== continue batch start $(date -Iseconds) ==="

cd "$CORE"
set -a
source .env
source <(sed '1s/^\xEF\xBB\xBF//' .env.research)
set +a
unset RESEARCH_RUN_LIMIT

run_policy() {
  local policy="$1"
  local split="$2"
  local out="$3"
  local label="$4"
  local ids="${5-}"
  echo "=== ${policy} ${split} → ${out} ids=[${ids}] ==="
  export RESEARCH_POLICY="$policy"
  export RESEARCH_RUN_SPLIT="$split"
  export RESEARCH_POLICY_OUT="$out"
  export RESEARCH_RUN_LABEL="$label"
  unset RESEARCH_RUN_IDS
  if [[ -n "${ids}" ]]; then
    export RESEARCH_RUN_IDS="${ids}"
  fi
  node scripts/research/run-policy-comparison.mjs || echo "${policy} ${split} had errors (continuing)"
  RESEARCH_POLICY_OUT="$out" node scripts/research/summarize-policy-runs.mjs | tee "${out%.jsonl}-summary.txt"
  unset RESEARCH_RUN_IDS
}

export RESEARCH_MEASURE_ENERGY=1

run_policy P1 dev /tmp/policy-runs-p1-under-route-v3b.jsonl p1-under-route-v3b "${UNDER_IDS}"
unset RESEARCH_RUN_IDS
run_policy P1 dev /tmp/policy-runs-p1-dev-v3b.jsonl p1-dev-v3b ""
unset RESEARCH_RUN_IDS
run_policy both test /tmp/policy-runs-both-test-energy-v2.jsonl both-test-energy-v2 ""
unset RESEARCH_RUN_IDS

export RESEARCH_KNN_LEAVE_ONE_OUT=1
export RESEARCH_RUN_SPLIT=dev
npx tsx scripts/research/evaluate-knn-router.ts 2>&1 | tee /tmp/knn-loo-v3b.log || echo "kNN eval skipped"

export RESEARCH_RUNS_DIR=/srv/www/dev.eduai.ok.ubc.ca/EduAICore/docs/research/data/runs
export RESEARCH_POLICY_P1_DEV=/tmp/policy-runs-p1-dev-v3b.jsonl
export RESEARCH_STATUS_OUT="$RESEARCH_RUNS_DIR/research-status-$(date +%Y-%m-%d)-continue.md"
node scripts/research/summarize-research-status.mjs | tee /tmp/research-status-continue.txt

RUNS="$RESEARCH_RUNS_DIR"
mkdir -p "$RUNS"
for f in \
  /tmp/policy-runs-p1-under-route-v3b.jsonl \
  /tmp/policy-runs-p1-under-route-v3b-summary.txt \
  /tmp/policy-runs-p1-dev-v3b.jsonl \
  /tmp/policy-runs-p1-dev-v3b-summary.txt \
  /tmp/policy-runs-both-test-energy-v2.jsonl \
  /tmp/policy-runs-both-test-energy-v2-summary.txt \
  /tmp/knn-loo-v3b.log \
  /tmp/research-status-continue.txt
do
  [[ -f "$f" ]] && cp -f "$f" "$RUNS/$(basename "$f")"
done

echo "=== continue batch done $(date -Iseconds) ==="
echo "ALL_DONE"
