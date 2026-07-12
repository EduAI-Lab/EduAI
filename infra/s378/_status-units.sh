#!/bin/bash
for u in eduai-core eduai-aitutor-fe eduai-qm-frontend eduai-aitutor-server eduai-qm-backend; do
  echo "===== $u ====="
  systemctl --user status "$u" --no-pager -l 2>&1 | tail -35
  echo
done
