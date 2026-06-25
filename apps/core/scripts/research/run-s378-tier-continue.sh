#!/usr/bin/env bash
# Continue Tier A after P1: wait for P3 dev batch, then summarize + status report.
#
# Usage (SSH to s378):
#   nohup bash scripts/research/run-s378-tier-continue.sh >>/tmp/ura-tier-continue.log 2>&1 &
#   tail -f /tmp/ura-tier-continue.log
set -euo pipefail

CORE="${RESEARCH_CORE_DIR:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core}"
LOG="${RESEARCH_TIER_CONTINUE_LOG:-/tmp/ura-tier-continue.log}"
P3_OUT="${RESEARCH_P3_OUT:-/tmp/policy-runs-p3-dev.jsonl}"
P1_OUT="${RESEARCH_POLICY_OUT:-/tmp/policy-runs-p1-dev.jsonl}"
DEV_PROMPTS=96

exec >>"$LOG" 2>&1
echo "=== tier-continue start $(date -Iseconds) ==="

cd "$CORE"
set -a
source .env
if [[ -f .env.research ]]; then
  source <(sed '1s/^\xEF\xBB\xBF//' .env.research)
fi
set +a
unset RESEARCH_RUN_LIMIT

wait_for_p3() {
  while pgrep -f 'node scripts/research/run-policy-comparison' >/dev/null 2>&1; do
    local n
    n=$(wc -l <"$P3_OUT" 2>/dev/null || echo 0)
    echo "P3 running… $n/$DEV_PROMPTS $(date -Iseconds)"
    sleep 30
  done
  local n
  n=$(wc -l <"$P3_OUT" 2>/dev/null || echo 0)
  if [[ "$n" -lt "$DEV_PROMPTS" ]]; then
    echo "P3 incomplete ($n/$DEV_PROMPTS) — starting batch"
    export RESEARCH_POLICY=P3
    export RESEARCH_RUN_SPLIT=dev
    export RESEARCH_POLICY_OUT="$P3_OUT"
    export RESEARCH_RUN_LABEL=tier-a-p3-dev
    export RESEARCH_RUN_SLEEP_MS="${RESEARCH_RUN_SLEEP_MS:-500}"
    node scripts/research/run-policy-comparison.mjs || echo "P3 run had errors (continuing)"
  fi
  n=$(wc -l <"$P3_OUT" 2>/dev/null || echo 0)
  echo "P3 done: $n rows"
}

wait_for_p3

echo "=== summarize P1 ==="
RESEARCH_POLICY_OUT="$P1_OUT" node scripts/research/summarize-policy-runs.mjs | tee /tmp/policy-runs-p1-dev-summary.txt

echo "=== summarize P3 ==="
RESEARCH_POLICY_OUT="$P3_OUT" node scripts/research/summarize-policy-runs.mjs | tee /tmp/policy-runs-p3-dev-summary.txt

echo "=== research status report ==="
export RESEARCH_POLICY_P1_DEV="$P1_OUT"
node scripts/research/summarize-research-status.mjs | tee /tmp/research-status.txt || echo "status report skipped"

echo "=== tier-continue done $(date -Iseconds) ==="
echo "P1_OUT=$P1_OUT"
echo "P3_OUT=$P3_OUT"
echo "ALL_DONE"
