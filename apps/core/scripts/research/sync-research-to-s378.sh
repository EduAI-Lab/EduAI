#!/usr/bin/env bash
# Sync research scripts to s378 and copy 72B adequacy artifact for ladder batches.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CORE_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
DATA_DIR="$(cd "$CORE_DIR/../../../docs/research/data" && pwd)"
S378="${S378_HOST:-ssaada08@dev.eduai.ok.ubc.ca}"
REMOTE_CORE="${S378_CORE_DIR:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core}"
REMOTE_RUNS="${S378_RUNS_DIR:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/docs/research/data/runs}"

echo "=== sync research scripts to s378 ==="
scp -r "$SCRIPT_DIR"/*.mjs "$SCRIPT_DIR"/*.sh \
  "$S378:$REMOTE_CORE/scripts/research/" 2>/dev/null || true

for f in paths.mjs both-tier-io.mjs policy-ids.mjs energy-sidecar.mjs research-chat-body.mjs; do
  scp "$SCRIPT_DIR/$f" "$S378:$REMOTE_CORE/scripts/research/" 2>/dev/null || true
done

echo "=== copy 72B adequacy JSONL to s378 ==="
ssh "$S378" "mkdir -p $REMOTE_RUNS/adequacy $REMOTE_RUNS/labels"
if [[ -f "$DATA_DIR/runs/adequacy/adequacy-72b-hard-v1.jsonl" ]]; then
  scp "$DATA_DIR/runs/adequacy/adequacy-72b-hard-v1.jsonl" \
    "$S378:$REMOTE_RUNS/adequacy/adequacy-72b-hard-v1.jsonl"
fi

echo "Done. Start batch on s378:"
echo "  ssh $S378"
echo "  cd $REMOTE_CORE && nohup bash scripts/research/run-s378-adequacy-ladder.sh >>/tmp/ura-adequacy-ladder.log 2>&1 &"
