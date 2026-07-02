#!/usr/bin/env bash
# Hard stratum + tier-sensitive prompts on cmps02 Qwen 72B AWQ (direct LiteLLM).
#
# Usage (from apps/core):
#   bash ./scripts/research/run-cmps02-72b-hard.sh
#
# Optional: RESEARCH_MEASURE_ENERGY=1 ENERGY_SIDECAR_URL=http://cmps02.ok.ubc.ca:8001/energy

set -euo pipefail
cd "$(dirname "$0")/../.."

export RESEARCH_VLLM_BASE_URL="${RESEARCH_VLLM_BASE_URL:-http://cmps02.ok.ubc.ca:8001}"
export RESEARCH_VLLM_API_KEY="${RESEARCH_VLLM_API_KEY:-vllm-local}"
export RESEARCH_ADEQUACY_MODELS="${RESEARCH_ADEQUACY_MODELS:-qwen2.5-72b-instruct}"
export RESEARCH_RUN_HARD_OR_TIER_SENSITIVE=1
export RESEARCH_RUN_SPLIT="${RESEARCH_RUN_SPLIT:-all}"
export RESEARCH_RUN_LABEL="${RESEARCH_RUN_LABEL:-adequacy-72b-hard-v1}"
export RESEARCH_RUN_OUT="${RESEARCH_RUN_OUT:-}"
export RESEARCH_RUN_SLEEP_MS="${RESEARCH_RUN_SLEEP_MS:-800}"
export RESEARCH_MEASURE_ENERGY="${RESEARCH_MEASURE_ENERGY:-0}"

if [[ -z "$RESEARCH_RUN_OUT" ]]; then
  export RESEARCH_RUN_OUT="../../docs/research/data/runs/adequacy/adequacy-72b-hard-v1.jsonl"
fi

echo "=== cmps02 72B hard + tier-sensitive batch ==="
echo "vllm: $RESEARCH_VLLM_BASE_URL"
echo "out:  $RESEARCH_RUN_OUT"
echo ""

npm run research:run-adequacy
