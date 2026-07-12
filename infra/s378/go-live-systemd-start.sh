#!/bin/bash
# Stop tmux-based go-live sessions and start the systemd --user stack.
set -euo pipefail

REPO=/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore

kill_port() {
  local port="$1"
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" 2>/dev/null || true
  fi
}

if ! systemctl --user cat eduai-dev.target >/dev/null 2>&1; then
  echo "ERROR: eduai-dev.target not installed. Run go-live-systemd-install.sh first."
  exit 1
fi

LINGER=$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || echo unknown)
if [ "$LINGER" != "yes" ]; then
  echo "WARNING: Linger=$LINGER — user services will stop when you log out."
  echo "         Run: sudo loginctl enable-linger $USER"
fi

echo "=== stopping tmux go-live sessions ==="
for s in eduai ext-aitutor ext-aitutor-fe ext-qm-be ext-qm-fe; do
  tmux kill-session -t "$s" 2>/dev/null || true
done

echo "=== freeing ports ==="
for p in 3000 3001 3002 3003 4000 5173 8000; do
  kill_port "$p"
done
sleep 2

echo "=== starting systemd eduai-dev.target (non-blocking) ==="
systemctl --user daemon-reload
# --no-block: do not wait on slow Vite/Prisma boot; we poll ports below
systemctl --user start --no-block eduai-dev.target

echo "=== waiting for ports (up to ~2 min) ==="
ready=0
for i in $(seq 1 60); do
  ready=0
  for p in 3000 3001 4000 5173 8000; do
    code=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 2 "http://127.0.0.1:${p}/" 2>/dev/null || echo 000)
    if [ "$code" != "000" ]; then
      ready=$((ready + 1))
    fi
  done
  if [ "$ready" -ge 5 ]; then
    break
  fi
  sleep 2
done

echo "=== systemctl --user status ==="
systemctl --user --no-pager --failed || true
systemctl --user --no-pager list-units 'eduai-*' || true

echo "=== localhost ports ==="
printf 'ports: '
curl -s -o /dev/null -w 'core:%{http_code} ' http://127.0.0.1:3000/ || true
curl -s -o /dev/null -w 'aitutor-fe:%{http_code} ' http://127.0.0.1:3001/ || true
curl -s -o /dev/null -w 'aitutor-be:%{http_code} ' http://127.0.0.1:4000/ || true
curl -s -o /dev/null -w 'qm-fe:%{http_code} ' http://127.0.0.1:5173/ || true
curl -s -o /dev/null -w 'qm-be:%{http_code}\n' http://127.0.0.1:8000/ || true

echo "=== public HTTPS ==="
curl -sI -k --connect-timeout 5 https://dev.eduai.ok.ubc.ca/login 2>/dev/null | head -1 || echo "core https: FAIL"
curl -sI -k --connect-timeout 5 https://dev.aitutor.eduai.ok.ubc.ca/ 2>/dev/null | head -1 || echo "aitutor https: FAIL"
curl -sI -k --connect-timeout 5 https://dev.questionmaker.eduai.ok.ubc.ca/ 2>/dev/null | head -1 || echo "qm https: FAIL"

echo
echo "Logs: journalctl --user -u eduai-core -f"
echo "Restart one: systemctl --user restart eduai-aitutor-fe"
echo "Restart all: systemctl --user restart eduai-dev.target"
