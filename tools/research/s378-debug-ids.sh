#!/usr/bin/env bash
cd /srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core
set -a
source .env
source <(sed '1s/^\xEF\xBB\xBF//' .env.research)
set +a
export RESEARCH_RUN_IDS='ts-028,ts-037,ts-044,ts-083,ts-094,ts-113,ts-119'
node scripts/research/tmp-debug-ids.mjs
