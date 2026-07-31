#!/bin/bash
# Install the EduAI s378 stack as SYSTEM units owned by the eduai-dev group,
# replacing the old per-account `systemctl --user` units.
#
# Run once, on s378, as any eduai-dev member. Requires sudo.
#
# Why: the old units lived in ~ssaada08/.config/systemd/user/ with Linger=yes.
# Only that one account could restart the stack, and nobody else could even READ
# the unit files (the directory is mode 700). System units + a polkit rule give
# every eduai-dev member `systemctl restart eduai-dev.target` with no sudo and no
# linger.
#
# This does NOT build or start anything. After it finishes:
#   bash infra/s378/go-live-build.sh

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
UNIT_SRC="${SCRIPT_DIR}/systemd"
REPO="${EDUAI_REPO:-/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore}"

UNITS=(eduai-core.service eduai-aitutor-server.service eduai-qm-backend.service)
SYSTEMD_DIR=/etc/systemd/system
ENV_DIR=/etc/eduai
POLKIT_DIR=/etc/polkit-1/rules.d

[ -d "$UNIT_SRC" ] || { echo "ERROR: missing $UNIT_SRC"; exit 1; }

echo "=== preflight ==="
# The units hardcode /usr/local/bin/node (system install, no volta on this box).
if [ ! -x /usr/local/bin/node ]; then
  echo "ERROR: /usr/local/bin/node not found — update ExecStart/PATH in the unit files."
  exit 1
fi
echo "  node $(/usr/local/bin/node -v) at /usr/local/bin/node"

getent group eduai-dev >/dev/null || { echo "ERROR: group eduai-dev does not exist"; exit 1; }
echo "  group eduai-dev ok"

# Core is exec'd directly rather than via `npm run start`, so this path must exist.
if [ ! -f "$REPO/node_modules/@react-router/serve/bin.js" ]; then
  echo "ERROR: $REPO/node_modules/@react-router/serve/bin.js missing (run npm install)."
  exit 1
fi
echo "  react-router-serve ok"

echo
echo "=== retiring the old --user units ==="
# Best-effort: only the owning account can actually do this. Anyone else just
# gets a notice, and the old units are inert once the system units take the ports.
if systemctl --user list-unit-files 'eduai-*' >/dev/null 2>&1; then
  systemctl --user disable --now eduai-dev.target 2>/dev/null || true
  systemctl --user disable --now eduai-core.service eduai-aitutor-server.service \
    eduai-aitutor-fe.service eduai-qm-backend.service eduai-qm-frontend.service 2>/dev/null || true
  rm -f "$HOME"/.config/systemd/user/eduai-*.service \
        "$HOME"/.config/systemd/user/eduai-*.target \
        "$HOME"/.config/systemd/user/eduai-dev.env 2>/dev/null || true
  systemctl --user daemon-reload 2>/dev/null || true
  echo "  cleared ~/.config/systemd/user/eduai-*"
else
  echo "  no --user units visible from this account"
fi
echo "  NOTE: if the old units were installed under a different account, that user"
echo "        must run:  systemctl --user disable --now eduai-dev.target"
echo "        and:       sudo loginctl disable-linger <that-user>"

echo
echo "=== installing environment file ==="
sudo install -d -m 0750 -o root -g eduai-dev "$ENV_DIR"
sudo install -m 0640 -o root -g eduai-dev "$UNIT_SRC/eduai-dev.env" "$ENV_DIR/eduai-dev.env"
echo "  $ENV_DIR/eduai-dev.env"

echo
echo "=== installing units ==="
for u in "${UNITS[@]}"; do
  sudo install -m 0644 -o root -g root "$UNIT_SRC/$u" "$SYSTEMD_DIR/$u"
  echo "  $SYSTEMD_DIR/$u"
done
sudo install -m 0644 -o root -g root "$UNIT_SRC/eduai-dev.target" "$SYSTEMD_DIR/eduai-dev.target"
echo "  $SYSTEMD_DIR/eduai-dev.target"

# The two frontend units are gone for good — both extension frontends are static
# now and served by Apache. Remove any stale copies so eduai-dev.target does not
# resurrect a Vite process that fights Apache for the site.
for stale in eduai-aitutor-fe.service eduai-qm-frontend.service; do
  if [ -f "$SYSTEMD_DIR/$stale" ]; then
    sudo systemctl disable --now "$stale" 2>/dev/null || true
    sudo rm -f "$SYSTEMD_DIR/$stale"
    echo "  removed stale $stale"
  fi
done

echo
echo "=== installing polkit rule (sudo-less restarts for eduai-dev) ==="
sudo install -m 0644 -o root -g root "$UNIT_SRC/49-eduai-dev.rules" "$POLKIT_DIR/49-eduai-dev.rules"
echo "  $POLKIT_DIR/49-eduai-dev.rules"

echo
echo "=== enabling ==="
sudo systemctl daemon-reload
sudo systemctl enable "${UNITS[@]}" eduai-dev.target

cat <<EOF

Installed and enabled (NOT started — nothing is built yet).

Next:
  bash ${SCRIPT_DIR}/go-live-build.sh

Then verify, ideally as an eduai-dev member who is NOT the old unit owner:
  systemctl restart eduai-dev.target     # must NOT prompt for a password
  systemctl is-active eduai-core eduai-aitutor-server eduai-qm-backend
  systemctl --user list-units 'eduai*'   # expect empty

If the restart does prompt, the polkit rule is not taking effect. Fall back to a
scoped sudoers entry:
  echo '%eduai-dev ALL=(root) NOPASSWD: /usr/bin/systemctl restart eduai-*, /usr/bin/systemctl start eduai-*, /usr/bin/systemctl stop eduai-*' \\
    | sudo tee /etc/sudoers.d/eduai-dev
  sudo visudo -c
EOF
