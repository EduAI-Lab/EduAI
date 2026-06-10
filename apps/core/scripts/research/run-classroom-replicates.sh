#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a
source .env.research
set +a

for i in 1 2 3; do
  echo "=== P1 replicate $i ==="
  RESEARCH_CLASSROOM_POLICY=P1 \
  RESEARCH_CLASSROOM_STUDENTS=30 \
  RESEARCH_CLASSROOM_CONCURRENCY=5 \
  RESEARCH_CLASSROOM_OUT="/tmp/classroom-p1-r${i}.jsonl" \
  RESEARCH_CLASSROOM_SUMMARY="/tmp/classroom-p1-r${i}.txt" \
  RESEARCH_RUN_LABEL="classroom-p1-r${i}" \
  node ./scripts/research/run-classroom-sim.mjs
done

for i in 1 2 3; do
  echo "=== P0 replicate $i ==="
  RESEARCH_CLASSROOM_POLICY=P0 \
  RESEARCH_CLASSROOM_STUDENTS=30 \
  RESEARCH_CLASSROOM_CONCURRENCY=5 \
  RESEARCH_CLASSROOM_OUT="/tmp/classroom-p0-r${i}.jsonl" \
  RESEARCH_CLASSROOM_SUMMARY="/tmp/classroom-p0-r${i}.txt" \
  RESEARCH_RUN_LABEL="classroom-p0-r${i}" \
  node ./scripts/research/run-classroom-sim.mjs
done

echo "ALL_DONE"
