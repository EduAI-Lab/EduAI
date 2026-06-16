#!/usr/bin/env bash
# Offline analysis — no chat API. Run on laptop after scp of JSONL artifacts.
#
# Usage:
#   cd apps/core
#   bash scripts/research/run-offline-analysis.sh
set -euo pipefail

cd "$(dirname "$0")/../.."

if [[ -f .env.research ]]; then
  set -a
  source .env.research
  set +a
fi

echo "=== summarize labels ==="
node scripts/research/summarize-labels.mjs

echo "=== summarize policy (if RESEARCH_POLICY_OUT set) ==="
if [[ -n "${RESEARCH_POLICY_OUT:-}" ]] || [[ -f "${RESEARCH_RUNS_DIR:-../../../docs/research/data/runs}/policy-runs-p1-dev.jsonl" ]]; then
  node scripts/research/summarize-policy-runs.mjs
else
  echo "skip — no policy runs file"
fi

echo "=== build kNN exemplars ==="
node scripts/research/build-knn-exemplars-from-labels.mjs

echo "=== kNN leave-one-out eval ==="
RESEARCH_KNN_LEAVE_ONE_OUT=1 node scripts/research/evaluate-knn-router.ts

echo "=== human spot-check worksheet ==="
node scripts/research/export-human-spot-check.mjs

echo "=== research status report ==="
node scripts/research/summarize-research-status.mjs

echo "ALL_DONE"
