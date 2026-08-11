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

UNITS=(eduai-core.service eduai-cron-worker.service eduai-aitutor-server.service eduai-qm-backend.service)
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

# The worker executes the shell jobs as the dedicated account. Keep this
# separate from ssaada08 (the account used by the web services) so the cron
# env, backup files, and audit log have one predictable owner.
getent passwd eduai-cron >/dev/null || {
  echo "ERROR: user eduai-cron does not exist"
  echo "       Create it first: sudo useradd -r -s /bin/false eduai-cron"
  exit 1
}
id -nG eduai-cron | tr ' ' '\n' | grep -qx eduai-dev || {
  echo "ERROR: eduai-cron must be a member of eduai-dev to read the shared service env"
  echo "       Run: sudo usermod -a -G eduai-dev eduai-cron"
  exit 1
}
echo "  user eduai-cron ok (member of eduai-dev)"

# Core is exec'd directly rather than via `npm run start`, so this path must exist.
if [ ! -f "$REPO/node_modules/@react-router/serve/bin.js" ]; then
  echo "ERROR: $REPO/node_modules/@react-router/serve/bin.js missing (run npm install)."
  exit 1
fi
echo "  react-router-serve ok"

CRON_SRC="$REPO/infra/cron"
CRON_DIR=/opt/eduai/cron
[ -d "$CRON_SRC" ] || { echo "ERROR: missing cron scripts at $CRON_SRC"; exit 1; }

echo
echo "=== installing cron worker scripts ==="
sudo install -d -m 0750 -o eduai-cron -g eduai-cron "$CRON_DIR"
for script in "$CRON_SRC"/*.sh; do
  sudo install -m 0750 -o eduai-cron -g eduai-cron "$script" "$CRON_DIR/"
done
echo "  $CRON_DIR (eduai-cron:eduai-cron, 0750)"

echo
echo "=== retiring the old --user units ==="
# This has to be enforced, not suggested. The old units live in
# ~ssaada08/.config/systemd/user/ with Linger=yes, so they come back at every
# boot running `npm run dev`. Whichever copy loses the race for :3000/:4000/:8000
# gets EADDRINUSE and, with Restart=always, crash-loops forever — while
# `systemctl status eduai-core` looks healthy because the OTHER copy won.
OLD_OWNER="${EDUAI_OLD_UNIT_OWNER:-ssaada08}"
if [ "$(id -un)" != "$OLD_OWNER" ]; then
  STALE_USER_UNITS=$(sudo find "$(getent passwd "$OLD_OWNER" | cut -d: -f6)/.config/systemd/user" \
    -maxdepth 1 -name 'eduai-*' -print -quit 2>/dev/null || true)
  LINGER=$(loginctl show-user "$OLD_OWNER" -p Linger --value 2>/dev/null || echo unknown)
  if [ -n "$STALE_USER_UNITS" ] || [ "$LINGER" = "yes" ]; then
    echo "ERROR: $OLD_OWNER still owns the old --user units (linger=$LINGER)."
    echo "       They will restart at boot and fight these system units for"
    echo "       :3000/:4000/:8000. Have $OLD_OWNER run, or run as root:"
    echo "         sudo -u $OLD_OWNER XDG_RUNTIME_DIR=/run/user/\$(id -u $OLD_OWNER) \\"
    echo "           systemctl --user disable --now eduai-dev.target eduai-core.service \\"
    echo "           eduai-aitutor-server.service eduai-aitutor-fe.service \\"
    echo "           eduai-qm-backend.service eduai-qm-frontend.service"
    echo "         sudo rm -f ~$OLD_OWNER/.config/systemd/user/eduai-*"
    echo "         sudo loginctl disable-linger $OLD_OWNER"
    echo "       Then re-run this script."
    exit 1
  fi
  echo "  no leftover --user units for $OLD_OWNER (linger=$LINGER)"
fi
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
if [ "$(id -un)" = "$OLD_OWNER" ]; then
  # Same reason as the preflight above: without this the units come back at boot.
  loginctl disable-linger "$OLD_OWNER" 2>/dev/null \
    || sudo loginctl disable-linger "$OLD_OWNER"
  echo "  linger disabled for $OLD_OWNER"
fi

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
  systemctl is-active eduai-core eduai-cron-worker eduai-aitutor-server eduai-qm-backend
  systemctl status eduai-cron-worker.service
  journalctl -u eduai-cron-worker.service -f
  sudo -u eduai-cron /opt/eduai/cron/backup-nightly.sh   # smoke the script identity/env
  systemctl --user list-units 'eduai*'   # expect empty

If the restart does prompt, the polkit rule is not taking effect. Fall back to a
scoped sudoers entry:
  echo '%eduai-dev ALL=(root) NOPASSWD: /usr/bin/systemctl restart eduai-*, /usr/bin/systemctl start eduai-*, /usr/bin/systemctl stop eduai-*' \\
    | sudo tee /etc/sudoers.d/eduai-dev
  sudo visudo -c
EOF
