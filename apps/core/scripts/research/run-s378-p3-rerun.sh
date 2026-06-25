#!/usr/bin/env bash
# Re-run P3 (auto-llm) after LLM classifier fix — dev + test splits.
#
# Usage (SSH to s378):
#   nohup bash scripts/research/run-s378-p3-rerun.sh >>/tmp/ura-p3-v2.log 2>&1 &
#   tail -f /tmp/ura-p3-v2.log
set -euo pipefail

CORE="${RESEARCH_CORE_DIR:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core}"
LOG="${RESEARCH_P3_RERUN_LOG:-/tmp/ura-p3-v2.log}"

exec >>"$LOG" 2>&1
echo "=== p3 rerun start $(date -Iseconds) ==="

cd "$CORE"
set -a
source .env
if [[ -f .env.research ]]; then
  source <(sed '1s/^\xEF\xBB\xBF//' .env.research)
fi
set +a
unset RESEARCH_RUN_LIMIT

export RESEARCH_POLICY=P3
export RESEARCH_RUN_SLEEP_MS="${RESEARCH_RUN_SLEEP_MS:-500}"

for split in dev test; do
  out="/tmp/policy-runs-p3-${split}-v2.jsonl"
  echo "=== P3 ${split} → ${out} ==="
  export RESEARCH_RUN_SPLIT="$split"
  export RESEARCH_POLICY_OUT="$out"
  export RESEARCH_RUN_LABEL="p3-${split}-v2"
  node scripts/research/run-policy-comparison.mjs || echo "P3 ${split} had errors (continuing)"
  echo "=== summarize P3 ${split} ==="
  RESEARCH_POLICY_OUT="$out" node scripts/research/summarize-policy-runs.mjs | tee "/tmp/policy-runs-p3-${split}-v2-summary.txt"
done

echo "=== p3 rerun done $(date -Iseconds) ==="
echo "ALL_DONE"
