#!/usr/bin/env bash
# Copy-paste helper for manual SSH on s378 (issue #501).
# Run AFTER: git pull, checkout feat/501-rag-stress-test, source .env.research
#
#   cd /srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core
#   git fetch origin && git checkout feat/501-rag-stress-test && git pull
#   set -a && source .env && source .env.research && set +a
#   nohup bash scripts/research/run-on-s378-handoff.sh >> /tmp/issue-501.log 2>&1 &
#   tail -f /tmp/issue-501.log

set -euo pipefail
CORE="${RESEARCH_CORE_DIR:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core}"
cd "$CORE"

export RESEARCH_RUNS_DIR="${RESEARCH_RUNS_DIR:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/docs/research/data/runs/issue-501}"
export RESEARCH_RUN_URL="${RESEARCH_RUN_URL:-http://127.0.0.1:3000/api/chat}"

echo "=== issue #501 handoff start $(date -Iseconds) ==="
echo "core: $CORE"
echo "branch: $(git rev-parse --abbrev-ref HEAD) @ $(git rev-parse --short HEAD)"

# Energy via cmps01 nginx proxy (GPU host — not s378)
export ENERGY_SIDECAR_URL="${ENERGY_SIDECAR_URL:-http://cmps01.ok.ubc.ca:8001/energy}"

bash scripts/research/run-issue-501.sh latest --with-energy

echo "=== ALL_DONE $(date -Iseconds) ==="
echo "Pull results: scp -r eduai-dev:/srv/www/dev.eduai.ok.ubc.ca/EduAICore/docs/research/data/runs/issue-501 ./docs/research/data/runs/"
