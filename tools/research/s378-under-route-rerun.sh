#!/usr/bin/env bash
# Re-run P1 on 10 under-route IDs after rule2d fix.
set -euo pipefail
CORE=/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core
UNDER_IDS="ts-028,ts-037,ts-044,ts-083,ts-094,ts-113,ts-119"
LOG=/tmp/ura-under-route-v4.log

exec >>"$LOG" 2>&1
echo "=== under-route v4 $(date -Iseconds) ==="

cd "$CORE"
set -a
source .env
source <(sed '1s/^\xEF\xBB\xBF//' .env.research)
set +a
unset RESEARCH_RUN_LIMIT

export RESEARCH_POLICY=P1
export RESEARCH_RUN_SPLIT=dev
export RESEARCH_RUN_IDS="$UNDER_IDS"
export RESEARCH_POLICY_OUT=/tmp/policy-runs-p1-under-route-v4.jsonl
export RESEARCH_RUN_LABEL=p1-under-route-v4
export RESEARCH_MEASURE_ENERGY=1

node scripts/research/run-policy-comparison.mjs
RESEARCH_POLICY_OUT=/tmp/policy-runs-p1-under-route-v4.jsonl node scripts/research/summarize-policy-runs.mjs | tee /tmp/policy-runs-p1-under-route-v4-summary.txt

echo "=== tiers ==="
grep -o '"prompt_id":"[^"]*"\|"routing_tier":[0-9]*' /tmp/policy-runs-p1-under-route-v4.jsonl | paste - -
echo "ALL_DONE"
