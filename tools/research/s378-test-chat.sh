#!/usr/bin/env bash
set -euo pipefail
CORE=/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core
cd "$CORE"
set -a
source .env
source <(sed '1s/^\xEF\xBB\xBF//' .env.research)
set +a

node scripts/research/tmp-chat-test.mjs
