#!/bin/bash
set -e
REPO=/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore
cd "$REPO"

start_session() {
  local name="$1"
  local cmd="$2"
  if tmux has-session -t "$name" 2>/dev/null; then
    echo "exists: $name"
  else
    tmux new-session -d -s "$name" "bash -lc 'cd $REPO && $cmd'"
    echo "started: $name"
  fi
}

port_up() {
  local port="$1"
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 2 "http://127.0.0.1:${port}/" 2>/dev/null || echo 000)
  [ "$code" != "000" ]
}

restart_if_down() {
  local name="$1"
  local port="$2"
  local cmd="$3"
  if port_up "$port"; then
    echo "up: $name (:$port)"
    return
  fi
  if tmux has-session -t "$name" 2>/dev/null; then
    tmux send-keys -t "$name" C-c Enter
    sleep 2
    tmux send-keys -t "$name" "cd $REPO && $cmd" Enter
    echo "restarted: $name"
  else
    start_session "$name" "$cmd"
  fi
}

restart_if_down eduai 3000 "npm run dev -w edu-ai"
restart_if_down ext-aitutor 4000 "npm run dev -w ai-tutor-server"
restart_if_down ext-aitutor-fe 3001 "npm run dev -w ai-tutor"
restart_if_down ext-qm-be 8000 "npm run dev -w question-maker-backend"
restart_if_down ext-qm-fe 5173 "npm run dev -w question-maker-frontend"

echo "waiting for ports..."
for i in $(seq 1 30); do
  ok=0
  curl -sf -o /dev/null http://127.0.0.1:3001/ && ok=$((ok+1))
  curl -sf -o /dev/null http://127.0.0.1:5173/ && ok=$((ok+1))
  [ "$ok" -ge 2 ] && break
  sleep 2
done

tmux ls
printf 'ports: '
curl -s -o /dev/null -w 'core:%{http_code} ' http://127.0.0.1:3000/
curl -s -o /dev/null -w 'aitutor-fe:%{http_code} ' http://127.0.0.1:3001/
curl -s -o /dev/null -w 'aitutor-be:%{http_code} ' http://127.0.0.1:4000/
curl -s -o /dev/null -w 'qm-fe:%{http_code} ' http://127.0.0.1:5173/
curl -s -o /dev/null -w 'qm-be:%{http_code}\n' http://127.0.0.1:8000/
