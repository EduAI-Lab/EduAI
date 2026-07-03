#!/usr/bin/env bash
# Run 7B vs 14B judge on cmps02 (on-host 127.0.0.1:8001) using 14B as judge.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
DATA_DIR="$(cd "$CORE_DIR/../../../docs/research/data" && pwd)"
RUNS="$DATA_DIR/runs"

KEY="${RESEARCH_SSH_KEY:-$HOME/.ssh/id_ed25519_cmps02}"
HOST="ssaada08@cmps02.ok.ubc.ca"
SCP_OPTS=(-i "$KEY")
SSH_OPTS=(-i "$KEY")

cd "$CORE_DIR"
node ./scripts/research/build-7b-for-judge.mjs

scp "${SCP_OPTS[@]}" "$RUNS/adequacy/adequacy-14b-easy-v1.jsonl" \
  "$RUNS/adequacy/adequacy-7b-easy-v1.jsonl" \
  "$CORE_DIR/../../infra/cmps02/judge-7b-14b-local.py" \
  "$HOST:~/cmps02/"

ssh "${SSH_OPTS[@]}" "$HOST" "cd ~/cmps02 && \
  sed -i 's/\r$//' judge-7b-14b-local.py && chmod +x judge-7b-14b-local.py && \
  rm -f labels-7b-14b.v1.jsonl && \
  python3 judge-7b-14b-local.py 2>&1 | tee judge-7b-14b.log | tail -5"

scp "${SCP_OPTS[@]}" "$HOST:~/cmps02/labels-7b-14b.v1.jsonl" "$RUNS/labels/"
echo "pulled → $RUNS/labels/labels-7b-14b.v1.jsonl"
