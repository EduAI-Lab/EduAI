#!/usr/bin/env bash
set -euo pipefail
CORE=/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core
cd "$CORE"
set -a
source .env
source <(sed '1s/^\xEF\xBB\xBF//' .env.research)
set +a
node -e "
const fs=require('fs');
const ids=new Set('ts-028,ts-031,ts-037,ts-044,ts-083,ts-094,ts-101,ts-102,ts-113,ts-119'.split(','));
const rows=fs.readFileSync('scripts/research/data/task-suite/prompts.v1.jsonl','utf8').trim().split('\n').map(l=>JSON.parse(l));
const hit=rows.filter(r=>ids.has(r.id)&&r.split==='dev');
console.log('dev under-route count', hit.length, hit.map(r=>r.id).join(','));
console.log('total dev', rows.filter(r=>r.split==='dev').length);
"
