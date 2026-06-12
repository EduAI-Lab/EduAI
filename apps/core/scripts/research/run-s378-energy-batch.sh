#!/usr/bin/env bash
# Run on s378: measured policy + strict re-label
set -euo pipefail
CORE=/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core
LOG=/tmp/ura-research-batch.log

exec >>"$LOG" 2>&1
echo "=== start $(date -Iseconds) ==="

cd "$CORE"
set -a
source .env
set +a

# After .env — avoid clobbering by any METER= in .env
ENERGY_METER_DIR=/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/tools/energy-meter

# Energy sidecar
pkill -f 'energy-meter/server.mjs' 2>/dev/null || true
sleep 1
cd "$ENERGY_METER_DIR"
nohup node server.mjs >>/tmp/energy-meter.log 2>&1 &
sleep 2
curl -s http://127.0.0.1:9100/health || { echo "sidecar failed"; exit 1; }

cd "$CORE"
export ENERGY_SIDECAR_URL=http://127.0.0.1:9100
export RESEARCH_MEASURE_ENERGY=1
export RESEARCH_REPLICATE=3
export RESEARCH_RUN_SPLIT=test
export RESEARCH_POLICY=both
export RESEARCH_RUN_LABEL=policy-energy-v2
export RESEARCH_POLICY_OUT=/tmp/policy-runs-test.energy.v2.jsonl
export RESEARCH_RUN_SLEEP_MS=500
unset RESEARCH_RUN_LIMIT

echo "=== measured policy run ==="
node scripts/research/run-policy-comparison.mjs || echo "policy run had errors (continuing)"

export RESEARCH_JUDGE_VIA_EDUAI=1
export RESEARCH_JUDGE_STRICT=1
export RESEARCH_LABEL_IN=/tmp/both-tier.v1.jsonl
export RESEARCH_LABEL_OUT=/tmp/labels-strict.v1.jsonl
export RESEARCH_LABEL_VERSION=strict-v1
export RESEARCH_LABEL_SLEEP_MS=300

echo "=== strict re-label dev ==="
node scripts/research/label-both-tier-runs.mjs

echo "=== done $(date -Iseconds) ==="
