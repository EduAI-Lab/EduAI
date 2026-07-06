#!/usr/bin/env bash
set -euo pipefail

CORE="${RESEARCH_CORE_DIR:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core}"
LOG="${RESEARCH_BATCH_LOG:-/tmp/ura-research-hour.log}"
UNDER_IDS="ts-028,ts-037,ts-044,ts-083,ts-094,ts-113,ts-119"

exec >>"$LOG" 2>&1
echo "=== research hour batch start $(date -Iseconds) ==="

cd "$CORE"
set -a
source .env
set +a

COOKIE="$(awk '/session_token/ {print $6"="$7}' /tmp/eduai-cookies.txt | tail -1)"
if [[ -z "$COOKIE" ]]; then
  echo "ERROR: no session cookie in /tmp/eduai-cookies.txt — login first"
  exit 1
fi

node scripts/research/enroll-research-user.mjs || echo "enroll step skipped/failed"

printf '%s\n' "{\"vllm\":{\"apiKey\":\"${VLLM_API_KEY}\",\"isEnabled\":true}}" \
  > scripts/research/research-api-keys.json

cat > .env.research <<EOF
RESEARCH_RUN_URL=http://127.0.0.1:3000/api/chat
RESEARCH_RUN_COOKIE=${COOKIE}
RESEARCH_RUN_API_KEYS_FILE=./scripts/research/research-api-keys.json
RESEARCH_RUNS_DIR=/srv/www/dev.eduai.ok.ubc.ca/EduAICore/docs/research/data/runs
RESEARCH_SUITE_DIR=./scripts/research/data/task-suite
RESEARCH_LABEL_OUT=/srv/www/dev.eduai.ok.ubc.ca/EduAICore/docs/research/data/runs/labels.v1.jsonl
RESEARCH_HUMAN_CHECK_IN=/srv/www/dev.eduai.ok.ubc.ca/EduAICore/docs/research/data/runs/both-tier.v1.jsonl
RESEARCH_DEFAULT_COURSE_CODE="COSC 101"
RESEARCH_RUN_SLEEP_MS=500
ENERGY_SIDECAR_URL=http://cmps01.ok.ubc.ca:8001/energy
EOF

echo "=== smoke (optional) ==="
bash /srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/tools/research/smoke-chat-routing.sh || echo "smoke skipped (Bearer path broken; cookie auth used for runs)"

set -a
source <(sed '1s/^\xEF\xBB\xBF//' .env.research)
set +a

run_policy() {
  local policy="$1"
  local split="$2"
  local out="$3"
  local label="$4"
  local ids="${5:-}"
  echo "=== ${policy} ${split} → ${out} ==="
  export RESEARCH_POLICY="$policy"
  export RESEARCH_RUN_SPLIT="$split"
  export RESEARCH_POLICY_OUT="$out"
  export RESEARCH_RUN_LABEL="$label"
  if [[ -n "$ids" ]]; then
    export RESEARCH_RUN_IDS="$ids"
  else
    unset RESEARCH_RUN_IDS
  fi
  node scripts/research/run-policy-comparison.mjs || echo "${policy} ${split} had errors (continuing)"
  RESEARCH_POLICY_OUT="$out" node scripts/research/summarize-policy-runs.mjs | tee "${out%.jsonl}-summary.txt"
}

echo "=== P1 under-route spot check (10 IDs) ==="
run_policy P1 dev /tmp/policy-runs-p1-under-route-v3.jsonl p1-under-route-v3 "$UNDER_IDS"

echo "=== P1 full dev (post rule-fix) ==="
run_policy P1 dev /tmp/policy-runs-p1-dev-v3.jsonl p1-dev-v3

echo "=== P0 vs P1 test with energy (cmps01 proxy) ==="
export RESEARCH_MEASURE_ENERGY=1
run_policy both test /tmp/policy-runs-both-test-energy-v1.jsonl both-test-energy-v1

echo "=== kNN leave-one-out (if embed API up) ==="
export RESEARCH_KNN_LEAVE_ONE_OUT=1
export RESEARCH_RUN_SPLIT=dev
npx tsx scripts/research/evaluate-knn-router.ts 2>&1 | tee /tmp/knn-loo-v3.log || echo "kNN eval skipped/failed"

echo "=== research status report ==="
export RESEARCH_RUNS_DIR=/srv/www/dev.eduai.ok.ubc.ca/EduAICore/docs/research/data/runs
export RESEARCH_POLICY_P1_DEV=/tmp/policy-runs-p1-dev-v3.jsonl
export RESEARCH_STATUS_OUT="$RESEARCH_RUNS_DIR/research-status-$(date +%Y-%m-%d)-hour.md"
node scripts/research/summarize-research-status.mjs | tee /tmp/research-status-hour.txt

RUNS="$RESEARCH_RUNS_DIR"
mkdir -p "$RUNS"
for f in \
  /tmp/policy-runs-p1-under-route-v3.jsonl \
  /tmp/policy-runs-p1-under-route-v3-summary.txt \
  /tmp/policy-runs-p1-dev-v3.jsonl \
  /tmp/policy-runs-p1-dev-v3-summary.txt \
  /tmp/policy-runs-both-test-energy-v1.jsonl \
  /tmp/policy-runs-both-test-energy-v1-summary.txt \
  /tmp/knn-loo-v3.log \
  /tmp/research-status-hour.txt
do
  [[ -f "$f" ]] && cp -f "$f" "$RUNS/$(basename "$f")"
done

echo "=== research hour batch done $(date -Iseconds) ==="
echo "ALL_DONE"
