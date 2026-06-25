#!/usr/bin/env bash
# Full P1 dev re-benchmark after rule2d fix.
set -euo pipefail
CORE=/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core
LOG=/tmp/ura-p1-dev-v4.log
exec >>"$LOG" 2>&1
echo "=== P1 dev v4 $(date -Iseconds) ==="
cd "$CORE"
set -a; source .env; source <(sed '1s/^\xEF\xBB\xBF//' .env.research); set +a
unset RESEARCH_RUN_LIMIT RESEARCH_RUN_IDS
export RESEARCH_POLICY=P1 RESEARCH_RUN_SPLIT=dev
export RESEARCH_POLICY_OUT=/tmp/policy-runs-p1-dev-v4.jsonl
export RESEARCH_RUN_LABEL=p1-dev-v4
export RESEARCH_MEASURE_ENERGY=1
node scripts/research/run-policy-comparison.mjs
RESEARCH_POLICY_OUT=/tmp/policy-runs-p1-dev-v4.jsonl node scripts/research/summarize-policy-runs.mjs | tee /tmp/policy-runs-p1-dev-v4-summary.txt
RESEARCH_LABEL_OUT=/srv/www/dev.eduai.ok.ubc.ca/EduAICore/docs/research/data/runs/labels/labels-strict.v1.jsonl \
  RESEARCH_POLICY_OUT=/tmp/policy-runs-p1-dev-v4.jsonl node scripts/research/summarize-policy-runs.mjs | tee /tmp/policy-runs-p1-dev-v4-strict-summary.txt
cp -f /tmp/policy-runs-p1-dev-v4* /srv/www/dev.eduai.ok.ubc.ca/EduAICore/docs/research/data/runs/ 2>/dev/null || true
echo ALL_DONE
