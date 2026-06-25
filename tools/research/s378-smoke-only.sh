#!/usr/bin/env bash
set -euo pipefail
CORE=/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core
cd "$CORE"
set -a
source .env
set +a
COOKIE="$(awk '/session_token/ {print $6"="$7}' /tmp/eduai-cookies.txt | tail -1)"
cat > .env.research <<EOF
RESEARCH_RUN_URL=http://127.0.0.1:3000/api/chat
RESEARCH_RUN_X_API_KEY=${EDUAI_API_KEY}
RESEARCH_RUN_COOKIE=${COOKIE}
RESEARCH_RUN_API_KEYS_FILE=./scripts/research/research-api-keys.json
RESEARCH_RUNS_DIR=/srv/www/dev.eduai.ok.ubc.ca/EduAICore/docs/research/data/runs
RESEARCH_SUITE_DIR=/srv/www/dev.eduai.ok.ubc.ca/EduAICore/docs/research/data/task-suite
RESEARCH_RUN_SLEEP_MS=500
ENERGY_SIDECAR_URL=http://cmps01.ok.ubc.ca:8001/energy
EOF
bash /srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/tools/research/smoke-chat-routing.sh
