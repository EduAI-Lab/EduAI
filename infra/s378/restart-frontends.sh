#!/bin/bash
REPO=/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore
grep allowedHosts "$REPO/apps/extensions/ai-tutor/vite.config.ts" || echo "AT allowedHosts missing"
grep allowedHosts "$REPO/apps/extensions/question-maker/app/frontend/vite.config.ts" || echo "QM allowedHosts missing"

restart_fe() {
  local name="$1"
  local ws="$2"
  tmux send-keys -t "$name" C-c Enter
  sleep 2
  tmux send-keys -t "$name" "cd $REPO && npm run dev -w $ws" Enter
  echo "restarted $name"
}

restart_fe ext-aitutor-fe ai-tutor
restart_fe ext-qm-fe question-maker-frontend
sleep 20
curl -sI -k https://dev.aitutor.eduai.ok.ubc.ca/ | head -3
curl -sI -k https://dev.questionmaker.eduai.ok.ubc.ca/ | head -3
