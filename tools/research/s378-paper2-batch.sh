#!/usr/bin/env bash
# Paper 2 batch: P1 test (post rule2e), dev P0+P1 energy, test P0+P1 2× replicate.
set -euo pipefail
CORE=/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core
RUNS=/srv/www/dev.eduai.ok.ubc.ca/EduAICore/docs/research/data/runs
LABELS_TEST="${RUNS}/labels/labels-strict-test.v1.jsonl"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
LOG=/tmp/ura-paper2-batch-${STAMP}.log

exec >>"$LOG" 2>&1
echo "=== paper2 batch start $(date -Iseconds) stamp=${STAMP} ==="

cd "$CORE"
set -a
source .env
source <(sed '1s/^\xEF\xBB\xBF//' .env.research)
set +a

export RESEARCH_MEASURE_ENERGY=1
export RESEARCH_RUN_SLEEP_MS=500
unset RESEARCH_RUN_LIMIT
unset RESEARCH_RUN_IDS

echo "=== energy preflight ==="
node scripts/research/verify-energy-sidecar.mjs

run_policy() {
  local policy="$1"
  local split="$2"
  local out="$3"
  local label="$4"
  local replicate="${5:-1}"
  echo "=== ${policy} ${split} rep=${replicate} → ${out} ==="
  export RESEARCH_POLICY="$policy"
  export RESEARCH_RUN_SPLIT="$split"
  export RESEARCH_POLICY_OUT="$out"
  export RESEARCH_RUN_LABEL="$label"
  export RESEARCH_REPLICATE="$replicate"
  node scripts/research/run-policy-comparison.mjs
  RESEARCH_POLICY_OUT="$out" node scripts/research/summarize-policy-runs.mjs | tee "${out%.jsonl}-summary.txt"
}

score_test_oracle() {
  local jsonl="$1"
  echo "=== strict oracle (test) for ${jsonl} ==="
  RESEARCH_POLICY_OUT="$jsonl" \
    RESEARCH_LABEL_OUT="$LABELS_TEST" \
    RESEARCH_ORACLE_SPLIT=test \
    node scripts/research/summarize-policy-runs.mjs
}

P1_TEST_OUT="${RUNS}/policy-runs-P1-test-energy-${STAMP}.jsonl"
DEV_BOTH_OUT="${RUNS}/policy-runs-both-dev-energy-${STAMP}.jsonl"
TEST_BOTH_OUT="${RUNS}/policy-runs-both-test-energy-2rep-${STAMP}.jsonl"

echo "=== 1/3 P1 full test (24 prompts, verify ts-080 fix) ==="
run_policy P1 test "$P1_TEST_OUT" "p1-test-post-rule2e-${STAMP}" 1
score_test_oracle "$P1_TEST_OUT"

echo "=== 2/3 dev P0+P1 energy (96 prompts × 2 policies) ==="
run_policy both dev "$DEV_BOTH_OUT" "both-dev-energy-${STAMP}" 1

echo "=== 3/3 test P0+P1 energy 2× replicate (24 × 2 × 2 = 96 calls) ==="
run_policy both test "$TEST_BOTH_OUT" "both-test-energy-2rep-${STAMP}" 2

echo "=== replicate summary (test) ==="
node scripts/research/summarize-policy-replicates.mjs "$TEST_BOTH_OUT" | tee "${TEST_BOTH_OUT%.jsonl}-replicates-summary.txt"

echo "=== copy summaries ==="
for f in \
  "$P1_TEST_OUT" "${P1_TEST_OUT%.jsonl}-summary.txt" \
  "$DEV_BOTH_OUT" "${DEV_BOTH_OUT%.jsonl}-summary.txt" \
  "$TEST_BOTH_OUT" "${TEST_BOTH_OUT%.jsonl}-summary.txt" \
  "${TEST_BOTH_OUT%.jsonl}-replicates-summary.txt"
do
  [[ -f "$f" ]] && echo "wrote $f"
done

echo "=== paper2 batch done $(date -Iseconds) stamp=${STAMP} ==="
echo "ALL_DONE stamp=${STAMP} log=${LOG}"
