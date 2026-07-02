#!/usr/bin/env bash
# Adequacy ladder next steps on s378 (EduAI → cmps01 vLLM) + status checks.
#
# Prereq: cmps01 :8001 reachable from s378 (EduAI VLLM_BASE_URL). If curl to
# cmps01:8001 fails, fix edge proxy on cmps01 before running.
#
# Usage (SSH to s378):
#   nohup bash scripts/research/run-s378-adequacy-ladder.sh >>/tmp/ura-adequacy-ladder.log 2>&1 &
#   tail -f /tmp/ura-adequacy-ladder.log
set -euo pipefail

CORE="${RESEARCH_CORE_DIR:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core}"
RUNS="${RESEARCH_RUNS_DIR:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/docs/research/data/runs}"
LOG="${RESEARCH_ADEQUACY_LOG:-/tmp/ura-adequacy-ladder.log}"

exec >>"$LOG" 2>&1
echo "=== adequacy ladder s378 start $(date -Iseconds) ==="

cd "$CORE"
set -a
source .env
if [[ -f .env.research ]]; then
  source <(sed '1s/^\xEF\xBB\xBF//' .env.research)
fi
set +a

echo "=== connectivity ==="
curl -s -o /dev/null -w "cmps01:8001/v1/models → %{http_code}\n" \
  --connect-timeout 10 -H "Authorization: Bearer vllm-local" \
  http://cmps01.ok.ubc.ca:8001/v1/models || true
curl -s -o /dev/null -w "cmps02:8001/v1/models → %{http_code}\n" \
  --connect-timeout 10 -H "Authorization: Bearer vllm-local" \
  http://cmps02.ok.ubc.ca:8001/v1/models || true

export RESEARCH_RUNS_DIR="$RUNS"
export RESEARCH_RUN_SLEEP_MS="${RESEARCH_RUN_SLEEP_MS:-800}"
export RESEARCH_MEASURE_ENERGY=0
unset RESEARCH_VLLM_BASE_URL

mkdir -p "$RUNS/adequacy" "$RUNS/labels"

echo "=== 32B test-split hard (9 prompts) via EduAI ==="
export RESEARCH_ADEQUACY_MODELS="vllm:qwen2.5-32b-instruct"
export RESEARCH_RUN_LABEL="adequacy-32b-test-hard-v1"
export RESEARCH_RUN_OUT="$RUNS/adequacy/adequacy-32b-test-hard-v1.jsonl"
export RESEARCH_RUN_IDS="ts-040,ts-043,ts-046,ts-103,ts-105,ts-107,ts-108,ts-115,ts-117"
node scripts/research/run-model-adequacy.mjs || echo "32B test-hard batch had errors (continuing)"

echo "=== 32B vs 72B judge (dev+test paired) via cmps01 proxy ==="
export RESEARCH_ADEQUACY_72B_IN="$RUNS/adequacy/adequacy-72b-hard-v1.jsonl"
export RESEARCH_ADEQUACY_32B_IN="$RUNS/adequacy/adequacy-32b-test-hard-v1.jsonl"
export RESEARCH_LABEL_OUT="$RUNS/labels/labels-32b-72b.v1.jsonl"
export RESEARCH_JUDGE_BASE_URL="http://cmps01.ok.ubc.ca:8001/v1"
export RESEARCH_JUDGE_API_KEY="${VLLM_API_KEY:-vllm-local}"
export RESEARCH_JUDGE_MODEL="qwen2.5-32b-instruct"
if [[ -f "$RESEARCH_ADEQUACY_72B_IN" ]]; then
  if curl -sf --connect-timeout 5 -H "Authorization: Bearer ${VLLM_API_KEY:-vllm-local}" \
    http://cmps01.ok.ubc.ca:8001/v1/models >/dev/null 2>&1; then
    node scripts/research/label-32b-72b-adequacy.mjs || echo "32B vs 72B judge had errors"
  else
    echo "skip judge — cmps01:8001 not reachable from s378 (redeploy eduai-edge-proxy on cmps01)"
  fi
else
  echo "skip judge — missing $RESEARCH_ADEQUACY_72B_IN (pull from cmps02 first)"
fi

echo "=== adequacy ladder s378 done $(date -Iseconds) ==="
echo "ALL_DONE"
