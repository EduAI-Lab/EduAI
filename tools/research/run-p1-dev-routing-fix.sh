#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core}"
cd "$ROOT"
# shellcheck disable=SC1091
source scripts/research/source-research-env.sh .
export RESEARCH_POLICY=P1
export RESEARCH_RUN_SPLIT=dev
unset RESEARCH_RUN_LIMIT
unset RESEARCH_RUN_IDS
export RESEARCH_POLICY_OUT=/tmp/policy-runs-p1-dev-routing-fix.jsonl
export RESEARCH_RUN_LABEL=p1-dev-post-routing-fix
rm -f "$RESEARCH_POLICY_OUT"
npm run research:run-policy
