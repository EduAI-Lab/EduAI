#!/bin/bash
set -euo pipefail
echo "=== units ==="
systemctl --user --no-pager is-active eduai-core eduai-aitutor-fe eduai-aitutor-server eduai-qm-frontend eduai-qm-backend || true
echo "=== ports ==="
for p in 3000 3001 4000 5173 8000; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --connect-timeout 3 "http://127.0.0.1:${p}/" || echo 000)
  echo "  :$p -> $code"
done
echo "=== https ==="
for u in https://dev.eduai.ok.ubc.ca/login https://dev.aitutor.eduai.ok.ubc.ca/ https://dev.questionmaker.eduai.ok.ubc.ca/; do
  echo -n "  $u -> "
  curl -sI -k --connect-timeout 5 "$u" 2>/dev/null | head -1 || echo FAIL
done
echo "=== core status ==="
systemctl --user --no-pager status eduai-core 2>&1 | head -25
