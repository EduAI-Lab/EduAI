#!/bin/bash
loginctl show-user "$USER" -p Linger
echo '=== units ==='
systemctl --user --no-pager list-units 'eduai-*' || true
echo '=== failed ==='
systemctl --user --no-pager --failed || true
echo '=== ports ==='
ss -tln | grep -E ':3000|:3001|:4000|:5173|:8000' || true
echo '=== active ==='
for u in eduai-core eduai-aitutor-server eduai-aitutor-fe eduai-qm-backend eduai-qm-frontend eduai-dev.target; do
  printf '%s: %s\n' "$u" "$(systemctl --user is-active "$u" 2>&1 || true)"
done
echo '=== jobs ==='
systemctl --user list-jobs 2>&1 | head -20 || true
