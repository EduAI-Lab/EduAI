#!/bin/bash
# Install the EduAI dev vhosts from THIS REPO into /etc/httpd/conf.d/.
#
# Previously this copied from ~/dev-vhosts/, which meant (a) editing the .conf
# files tracked in infra/s378/ had no effect, and (b) the script only worked at
# all for whichever account happened to have that directory. The repo is the
# source of truth now.
#
# Requires sudo (writes to /etc/httpd/conf.d and reloads httpd). Rare — only when
# a vhost actually changes, not on every deploy.
#
# Usage:
#   bash infra/s378/go-live-apache.sh
#   EDUAI_VHOST_SRC=/some/dir bash infra/s378/go-live-apache.sh   # override source

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
SRC="${EDUAI_VHOST_SRC:-$SCRIPT_DIR}"
DEST=/etc/httpd/conf.d
STAMP=$(date +%Y%m%d-%H%M%S)

VHOSTS=(
  dev.aitutor.eduai.ok.ubc.ca.conf
  dev.questionmaker.eduai.ok.ubc.ca.conf
)

# NOTE: Core's vhost (dev.eduai.ok.ubc.ca.conf) is deliberately not listed — it
# exists only on the box and is not versioned here. It still proxies / to :3000
# and is unaffected by the static-serving change. Versioning it is a follow-up.

echo "=== source: $SRC ==="
for f in "${VHOSTS[@]}"; do
  [ -f "$SRC/$f" ] || { echo "ERROR: missing $SRC/$f"; exit 1; }
done

# These vhosts stop proxying to a dev server and start serving files from disk,
# so a bad reload takes both extension sites down. Keep a timestamped rollback.
echo "=== backing up current vhosts (rollback point) ==="
for f in "${VHOSTS[@]}"; do
  if [ -f "$DEST/$f" ]; then
    sudo cp -p "$DEST/$f" "$DEST/$f.bak.$STAMP"
    echo "  $DEST/$f.bak.$STAMP"
  else
    echo "  (no existing $f)"
  fi
done

echo "=== installing ==="
for f in "${VHOSTS[@]}"; do
  sudo install -m 0644 -o root -g root "$SRC/$f" "$DEST/$f"
  echo "  $f"
done

echo "=== httpd -t ==="
if ! sudo httpd -t; then
  echo
  echo "CONFIG TEST FAILED — restoring backups, not reloading."
  for f in "${VHOSTS[@]}"; do
    [ -f "$DEST/$f.bak.$STAMP" ] && sudo cp -p "$DEST/$f.bak.$STAMP" "$DEST/$f"
  done
  exit 1
fi

sudo systemctl reload httpd

# The sites now serve files from the build output rather than proxying, so a
# missing build is a 403/404 on the whole site rather than a 502. Say so early.
REPO="${EDUAI_REPO:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore}"
for d in "$REPO/apps/extensions/ai-tutor/build/client" \
         "$REPO/apps/extensions/question-maker/app/frontend/dist"; do
  if [ ! -f "$d/index.html" ]; then
    echo "WARNING: $d/index.html is missing — run infra/s378/go-live-build.sh"
  fi
done

echo
echo "APACHE_OK (rollback: sudo cp $DEST/<vhost>.bak.$STAMP $DEST/<vhost> && sudo systemctl reload httpd)"
