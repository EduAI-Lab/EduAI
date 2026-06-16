#!/usr/bin/env bash
# Tier A — unattended on s378: P1 dev policy run + summarize + human-check worksheet.
#
# Usage (SSH to s378):
#   nohup bash scripts/research/run-s378-tier-a.sh >>/tmp/ura-tier-a.log 2>&1 &
#   tail -f /tmp/ura-tier-a.log
#
# Optional: RESEARCH_TIER_A_MEASURE_ENERGY=1 to start local sidecar (s378 Joules often null).
set -euo pipefail

CORE="${RESEARCH_CORE_DIR:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core}"
LOG="${RESEARCH_TIER_A_LOG:-/tmp/ura-tier-a.log}"
STAMP=$(date -Iseconds)

exec >>"$LOG" 2>&1
echo "=== tier-a start $STAMP ==="

cd "$CORE"
set -a
source .env
set +a

if [[ -f .env.research ]]; then
  set -a
  source .env.research
  set +a
fi

POLICY_OUT="${RESEARCH_POLICY_OUT:-/tmp/policy-runs-p1-dev.jsonl}"
SUMMARY_OUT="${RESEARCH_TIER_A_SUMMARY:-/tmp/policy-runs-p1-dev-summary.txt}"
HUMAN_OUT="${RESEARCH_HUMAN_CHECK_OUT:-/tmp/human-spot-check.md}"
LABELS_IN="${RESEARCH_LABEL_OUT:-}"

if [[ "${RESEARCH_TIER_A_MEASURE_ENERGY:-0}" == "1" ]]; then
  ENERGY_METER_DIR="${ENERGY_METER_DIR:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/tools/energy-meter}"
  pkill -f 'energy-meter/server.mjs' 2>/dev/null || true
  sleep 1
  cd "$ENERGY_METER_DIR"
  nohup node server.mjs >>/tmp/energy-meter.log 2>&1 &
  sleep 2
  curl -sf http://127.0.0.1:9100/health || { echo "energy sidecar failed"; exit 1; }
  cd "$CORE"
  export ENERGY_SIDECAR_URL=http://127.0.0.1:9100
  export RESEARCH_MEASURE_ENERGY=1
fi

export RESEARCH_POLICY=P1
export RESEARCH_RUN_SPLIT=dev
export RESEARCH_POLICY_OUT="$POLICY_OUT"
export RESEARCH_RUN_LABEL=tier-a-p1-dev
export RESEARCH_RUN_SLEEP_MS="${RESEARCH_RUN_SLEEP_MS:-500}"
unset RESEARCH_RUN_LIMIT

echo "=== P1 dev policy run ==="
echo "output: $POLICY_OUT"
node scripts/research/run-policy-comparison.mjs || echo "policy run had errors (continuing)"

echo "=== summarize policy + oracle gap ==="
{
  RESEARCH_POLICY_OUT="$POLICY_OUT"
  if [[ -n "$LABELS_IN" ]]; then
    export RESEARCH_LABEL_OUT="$LABELS_IN"
  fi
  node scripts/research/summarize-policy-runs.mjs
} | tee "$SUMMARY_OUT"

echo "=== human spot-check worksheet ==="
export RESEARCH_HUMAN_CHECK_OUT="$HUMAN_OUT"
node scripts/research/export-human-spot-check.mjs || echo "export-human-check skipped (missing inputs)"

echo "=== tier-a done $(date -Iseconds) ==="
echo "POLICY_OUT=$POLICY_OUT"
echo "SUMMARY_OUT=$SUMMARY_OUT"
echo "HUMAN_OUT=$HUMAN_OUT"
echo "ALL_DONE"
