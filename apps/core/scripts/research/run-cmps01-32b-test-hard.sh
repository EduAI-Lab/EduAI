#!/usr/bin/env bash
# Run 32B on test-split hard prompts missing from dev both-tier (for 72B comparison).
#
# Usage (from apps/core, on VPN / s378):
#   bash ./scripts/research/run-cmps01-32b-test-hard.sh

set -euo pipefail

export RESEARCH_VLLM_BASE_URL="${RESEARCH_VLLM_BASE_URL:-http://cmps01.ok.ubc.ca:8001}"
export RESEARCH_ADEQUACY_MODELS="${RESEARCH_ADEQUACY_MODELS:-qwen2.5-32b-instruct}"
export RESEARCH_RUN_LABEL="${RESEARCH_RUN_LABEL:-adequacy-32b-test-hard-v1}"
export RESEARCH_RUN_IDS="${RESEARCH_RUN_IDS:-ts-040,ts-043,ts-046,ts-103,ts-105,ts-107,ts-108,ts-115,ts-117}"

node ./scripts/research/run-model-adequacy.mjs
