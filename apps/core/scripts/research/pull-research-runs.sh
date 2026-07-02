#!/usr/bin/env bash
# Pull research run artifacts from GPU hosts into URA docs/research/data/.
#
# Usage (from apps/core):
#   bash ./scripts/research/pull-research-runs.sh
#
# Env:
#   RESEARCH_PULL_HOST     cmps02 | cmps01 | all (default cmps02)
#   RESEARCH_DATA_DIR      override destination (default ../../../docs/research/data from apps/core)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
DATA_DIR="${RESEARCH_DATA_DIR:-$(cd "$CORE_DIR/../../../docs/research/data" && pwd)}"
HOST_FILTER="${RESEARCH_PULL_HOST:-cmps02}"

mkdir -p "$DATA_DIR/runs/adequacy" "$DATA_DIR/runs/status"

pull_cmps02() {
  echo "=== pull cmps02 adequacy runs ==="
  scp cmps02:~/cmps02/adequacy-72b-hard-v1.jsonl \
    "$DATA_DIR/runs/adequacy/adequacy-72b-hard-v1.jsonl" 2>/dev/null || echo "  (skip adequacy-72b-hard-v1.jsonl — not on host yet)"
  scp cmps02:~/cmps02/adequacy-72b-hard.log \
    "$DATA_DIR/runs/adequacy/adequacy-72b-hard.log" 2>/dev/null || true
  scp cmps02:~/cmps02/adequacy-prompts-hard.jsonl \
    "$DATA_DIR/runs/adequacy/adequacy-prompts-hard.jsonl" 2>/dev/null || true
}

pull_cmps01() {
  echo "=== pull cmps01 (placeholder — add policy JSONL paths when staged on host) ==="
  # Policy-scale batches usually originate from s378; energy via :8001/energy proxy.
  :
}

case "$HOST_FILTER" in
  cmps02) pull_cmps02 ;;
  cmps01) pull_cmps01 ;;
  all) pull_cmps02; pull_cmps01 ;;
  *) echo "Unknown RESEARCH_PULL_HOST=$HOST_FILTER"; exit 1 ;;
esac

echo ""
echo "=== post-pull: rebuild matrix ==="
cd "$CORE_DIR"
npm run research:build-matrix

STAMP="$(date -u +%Y-%m-%dT%H:%MZ)"
STATUS_FILE="$DATA_DIR/runs/status/research-pull-$STAMP.md"
cat >"$STATUS_FILE" <<EOF
# Research pull — $STAMP

- Host: \`$HOST_FILTER\`
- Adequacy: \`runs/adequacy/adequacy-72b-hard-v1.jsonl\` (if present)
- Matrix refreshed: \`data/analysis/prompt-routing-matrix.csv\`

Agents: update \`findings/ADEQUACY_LADDER_STATUS.md\` after new adequacy JSONL lands.
EOF

echo "Wrote $STATUS_FILE"
echo "Done. Data dir: $DATA_DIR"
