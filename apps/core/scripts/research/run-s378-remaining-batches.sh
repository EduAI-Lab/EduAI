#!/usr/bin/env bash
# Remaining Tier A batches: P1 dev v2, P0 dev, P1 test + summarize + reports.
#
# Usage (SSH to s378):
#   nohup bash scripts/research/run-s378-remaining-batches.sh >>/tmp/ura-remaining.log 2>&1 &
#   tail -f /tmp/ura-remaining.log
set -euo pipefail

CORE="${RESEARCH_CORE_DIR:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core}"
RUNS="${RESEARCH_RUNS_DIR:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/docs/research/data/runs}"
LABELS="${RESEARCH_LABEL_OUT:-$RUNS/labels.v1.jsonl}"
LOG="${RESEARCH_REMAINING_LOG:-/tmp/ura-remaining.log}"

exec >>"$LOG" 2>&1
echo "=== remaining batches start $(date -Iseconds) ==="

cd "$CORE"
set -a
source .env
if [[ -f .env.research ]]; then
  source <(sed '1s/^\xEF\xBB\xBF//' .env.research)
fi
set +a
unset RESEARCH_RUN_LIMIT
export RESEARCH_RUN_SLEEP_MS="${RESEARCH_RUN_SLEEP_MS:-500}"
export RESEARCH_LABEL_OUT="$LABELS"

run_policy() {
  local policy="$1"
  local split="$2"
  local out="$3"
  local label="$4"
  echo "=== ${policy} ${split} → ${out} ==="
  export RESEARCH_POLICY="$policy"
  export RESEARCH_RUN_SPLIT="$split"
  export RESEARCH_POLICY_OUT="$out"
  export RESEARCH_RUN_LABEL="$label"
  node scripts/research/run-policy-comparison.mjs || echo "${policy} ${split} had errors (continuing)"
  RESEARCH_POLICY_OUT="$out" node scripts/research/summarize-policy-runs.mjs | tee "${out%.jsonl}-summary.txt"
}

run_policy P1 dev /tmp/policy-runs-p1-dev-v2.jsonl p1-dev-v2
run_policy P0 dev /tmp/policy-runs-p0-dev.jsonl p0-dev
run_policy P1 test /tmp/policy-runs-p1-test-v2.jsonl p1-test-v2

echo "=== P1 summary (legacy pre-vector file) ==="
RESEARCH_POLICY_OUT=/tmp/policy-runs-p1-dev.jsonl node scripts/research/summarize-policy-runs.mjs | tee /tmp/policy-runs-p1-dev-summary.txt

echo "=== research status report ==="
export RESEARCH_RUNS_DIR="$RUNS"
export RESEARCH_POLICY_P1_DEV=/tmp/policy-runs-p1-dev-v2.jsonl
export RESEARCH_POLICY_P3_DEV=/tmp/policy-runs-p3-dev-v2.jsonl
export RESEARCH_STATUS_OUT="$RUNS/research-status-$(date +%Y-%m-%d).md"
node scripts/research/summarize-research-status.mjs | tee /tmp/research-status-v2.txt

echo "=== human spot-check (both-tier baseline) ==="
  BOTH_TIER="/tmp/both-tier.v1.jsonl"
  if [[ ! -f "$BOTH_TIER" ]]; then
    BOTH_TIER="${RESEARCH_BOTH_TIER_IN:-$RUNS/both-tier.v1.jsonl}"
  fi
if [[ -f "$BOTH_TIER" ]]; then
  export RESEARCH_HUMAN_CHECK_IN="$BOTH_TIER"
  export RESEARCH_HUMAN_CHECK_LABELS="$LABELS"
  export RESEARCH_HUMAN_CHECK_OUT="$RUNS/human-spot-check-worksheet.md"
  node scripts/research/export-human-spot-check.mjs || echo "human spot-check failed"
else
  echo "skip human spot-check — no both-tier file at $BOTH_TIER"
fi

echo "=== copy key artifacts to RUNS dir ==="
mkdir -p "$RUNS"
for f in \
  /tmp/policy-runs-p1-dev.jsonl \
  /tmp/policy-runs-p1-dev-summary.txt \
  /tmp/policy-runs-p1-dev-v2.jsonl \
  /tmp/policy-runs-p1-dev-v2-summary.txt \
  /tmp/policy-runs-p0-dev.jsonl \
  /tmp/policy-runs-p0-dev-summary.txt \
  /tmp/policy-runs-p1-test-v2.jsonl \
  /tmp/policy-runs-p1-test-v2-summary.txt \
  /tmp/policy-runs-p3-dev-v2.jsonl \
  /tmp/policy-runs-p3-dev-v2-summary.txt \
  /tmp/policy-runs-p3-test-v2.jsonl \
  /tmp/policy-runs-p3-test-v2-summary.txt \
  /tmp/llm-classifier-eval.log \
  /tmp/research-status-v2.txt
do
  [[ -f "$f" ]] && cp -f "$f" "$RUNS/$(basename "$f")"
done

echo "=== remaining batches done $(date -Iseconds) ==="
echo "ALL_DONE"
