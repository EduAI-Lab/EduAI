#!/usr/bin/env bash
# P3 dev re-run after tier-mapping tune (medium→1, confidence 60).
# Requires latest apps/core on s378 (token telemetry + P3 mapping).
#
# Usage (SSH to s378):
#   nohup bash scripts/research/run-s378-p3-dev-v3.sh >>/tmp/ura-p3-v3.log 2>&1 &
#   tail -f /tmp/ura-p3-v3.log
set -euo pipefail

CORE="${RESEARCH_CORE_DIR:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core}"
LOG="${RESEARCH_P3_V3_LOG:-/tmp/ura-p3-v3.log}"
ENERGY_METER_DIR="${ENERGY_METER_DIR:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/tools/energy-meter}"

exec >>"$LOG" 2>&1
echo "=== p3 dev v3 start $(date -Iseconds) ==="

cd "$CORE"
set -a
source .env
if [[ -f .env.research ]]; then
  source <(sed '1s/^\xEF\xBB\xBF//' .env.research)
fi
set +a
unset RESEARCH_RUN_LIMIT

# Energy sidecar (required by research scripts unless RESEARCH_MEASURE_ENERGY=0)
pkill -f 'energy-meter/server.mjs' 2>/dev/null || true
sleep 1
cd "$ENERGY_METER_DIR"
nohup node server.mjs >>/tmp/energy-meter.log 2>&1 &
sleep 2
curl -sf http://127.0.0.1:9100/health || { echo "energy sidecar failed"; exit 1; }

cd "$CORE"
export ENERGY_SIDECAR_URL=http://127.0.0.1:9100
export RESEARCH_POLICY=P3
export RESEARCH_RUN_SPLIT=dev
export RESEARCH_RUN_SLEEP_MS="${RESEARCH_RUN_SLEEP_MS:-500}"
export RESEARCH_POLICY_OUT=/tmp/policy-runs-p3-dev-v3.jsonl
export RESEARCH_RUN_LABEL=p3-dev-v3

echo "=== P3 dev → ${RESEARCH_POLICY_OUT} ==="
node scripts/research/run-policy-comparison.mjs

echo "=== summarize ==="
RESEARCH_POLICY_OUT="$RESEARCH_POLICY_OUT" node scripts/research/summarize-policy-runs.mjs | tee /tmp/policy-runs-p3-dev-v3-summary.txt

echo "=== p3 dev v3 done $(date -Iseconds) ==="
echo "ALL_DONE"
