#!/bin/bash
# Full reset + start for Core + extension dev apps on s378.
set -euo pipefail
REPO=/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore
cd "$REPO"

kill_port() {
  local port="$1"
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" 2>/dev/null || true
  fi
}

ensure_session() {
  local name="$1"
  local cmd="$2"
  tmux kill-session -t "$name" 2>/dev/null || true
  tmux new-session -d -s "$name" "bash -lc 'cd $REPO && $cmd'"
  echo "started: $name"
}

port_up() {
  local port="$1"
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 2 "http://127.0.0.1:${port}/" 2>/dev/null || echo 000)
  [ "$code" != "000" ]
}

host_ok() {
  local host="$1"
  local port="$2"
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 3 -H "Host: ${host}" "http://127.0.0.1:${port}/" 2>/dev/null || echo 000)
  [ "$code" = "200" ] || [ "$code" = "304" ]
}

echo "=== stopping all dev processes ==="
for s in eduai ext-aitutor ext-aitutor-fe ext-qm-be ext-qm-fe; do
  tmux kill-session -t "$s" 2>/dev/null || true
done
for p in 3000 3001 3002 3003 4000 5173 8000; do
  kill_port "$p"
done
sleep 2

echo "=== starting all apps ==="
ensure_session eduai "npm run dev -w edu-ai"
ensure_session ext-aitutor "npm run dev -w ai-tutor-server"
ensure_session ext-aitutor-fe "npm run dev -w ai-tutor"
ensure_session ext-qm-be "npm run dev -w question-maker-backend"
ensure_session ext-qm-fe "npm run dev -w question-maker-frontend"

echo "=== waiting for ports ==="
for i in $(seq 1 45); do
  ready=0
  port_up 3000 && ready=$((ready + 1))
  port_up 3001 && ready=$((ready + 1))
  port_up 4000 && ready=$((ready + 1))
  port_up 5173 && ready=$((ready + 1))
  port_up 8000 && ready=$((ready + 1))
  if [ "$ready" -ge 5 ]; then
    break
  fi
  sleep 2
done

echo "=== tmux ==="
tmux ls 2>/dev/null || echo "(no tmux sessions)"

echo "=== localhost ports ==="
printf 'ports: '
curl -s -o /dev/null -w 'core:%{http_code} ' http://127.0.0.1:3000/ || true
curl -s -o /dev/null -w 'aitutor-fe:%{http_code} ' http://127.0.0.1:3001/ || true
curl -s -o /dev/null -w 'aitutor-be:%{http_code} ' http://127.0.0.1:4000/ || true
curl -s -o /dev/null -w 'qm-fe:%{http_code} ' http://127.0.0.1:5173/ || true
curl -s -o /dev/null -w 'qm-be:%{http_code}\n' http://127.0.0.1:8000/ || true

echo "=== proxied host headers (Vite allowedHosts) ==="
host_ok dev.aitutor.eduai.ok.ubc.ca 3001 && echo "aitutor host: OK" || echo "aitutor host: FAIL"
host_ok dev.questionmaker.eduai.ok.ubc.ca 5173 && echo "qm host: OK" || echo "qm host: FAIL"

echo "=== public HTTPS ==="
curl -sI -k --connect-timeout 5 https://dev.eduai.ok.ubc.ca/login 2>/dev/null | head -1 || echo "core https: FAIL"
curl -sI -k --connect-timeout 5 https://dev.aitutor.eduai.ok.ubc.ca/ 2>/dev/null | head -1 || echo "aitutor https: FAIL"
curl -sI -k --connect-timeout 5 https://dev.questionmaker.eduai.ok.ubc.ca/ 2>/dev/null | head -1 || echo "qm https: FAIL"
