#!/usr/bin/env bash
# Run on cmps01 (GPU host): energy sidecar + small measured policy batch.
#
# Usage:
#   nohup bash scripts/research/run-cmps01-energy-batch.sh >>/tmp/ura-cmps01-energy.log 2>&1 &
#
# Prereqs: EduAI core checkout, .env with DATABASE_URL optional, research API keys file.
set -euo pipefail

CORE="${RESEARCH_CORE_DIR:-$HOME/EduAICore/EduAICore/apps/core}"
METER_DIR="${ENERGY_METER_DIR:-$HOME/EduAICore/EduAICore/tools/energy-meter}"
LOG="${RESEARCH_CMPS01_LOG:-/tmp/ura-cmps01-energy.log}"

exec >>"$LOG" 2>&1
echo "=== cmps01 energy batch start $(date -Iseconds) ==="

cd "$METER_DIR"
if [[ -d .venv ]]; then
  # shellcheck disable=SC1091
  source .venv/bin/activate
fi

pkill -f 'energy-meter/server' 2>/dev/null || true
sleep 1

if [[ -f server.py ]] && python3 -c 'import pynvml' 2>/dev/null; then
  nohup python3 server.py >>/tmp/energy-meter.log 2>&1 &
else
  nohup node server.mjs >>/tmp/energy-meter.log 2>&1 &
fi
sleep 2
curl -sf http://127.0.0.1:9100/health || { echo "energy sidecar failed"; exit 1; }

cd "$CORE"
set -a
[[ -f .env ]] && source .env
[[ -f .env.research ]] && source .env.research
set +a

export ENERGY_SIDECAR_URL="${ENERGY_SIDECAR_URL:-http://127.0.0.1:9100}"
export RESEARCH_MEASURE_ENERGY=1
export RESEARCH_REPLICATE="${RESEARCH_REPLICATE:-1}"
export RESEARCH_RUN_SPLIT="${RESEARCH_RUN_SPLIT:-test}"
export RESEARCH_POLICY="${RESEARCH_POLICY:-both}"
export RESEARCH_RUN_LABEL="${RESEARCH_RUN_LABEL:-policy-cmps01-energy}"
export RESEARCH_POLICY_OUT="${RESEARCH_POLICY_OUT:-/tmp/policy-runs-cmps01-energy.jsonl}"
export RESEARCH_RUN_SLEEP_MS="${RESEARCH_RUN_SLEEP_MS:-500}"
export RESEARCH_RUN_LIMIT="${RESEARCH_RUN_LIMIT:-24}"

echo "=== measured policy run (limit=$RESEARCH_RUN_LIMIT) ==="
node scripts/research/run-policy-comparison.mjs

echo "=== summarize ==="
RESEARCH_POLICY_OUT="$RESEARCH_POLICY_OUT" node scripts/research/summarize-policy-runs.mjs

echo "=== cmps01 energy batch done $(date -Iseconds) ==="
echo "POLICY_OUT=$RESEARCH_POLICY_OUT"
echo "ALL_DONE"
