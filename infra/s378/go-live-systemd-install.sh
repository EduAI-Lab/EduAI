#!/bin/bash
# Install EduAI s378 systemd --user units (does not start them).
# Run on s378 as the app user (ssaada08).
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
UNIT_SRC="${SCRIPT_DIR}/systemd"
# When copied to ~/dev-vhosts/, units live next to this script under systemd/
if [ ! -d "$UNIT_SRC" ] && [ -d "${SCRIPT_DIR}/../infra/s378/systemd" ]; then
  UNIT_SRC=$(cd "${SCRIPT_DIR}/../infra/s378/systemd" && pwd)
fi
if [ ! -d "$UNIT_SRC" ]; then
  echo "ERROR: cannot find systemd unit dir (expected ${SCRIPT_DIR}/systemd)"
  exit 1
fi

UNIT_DIR="${HOME}/.config/systemd/user"
mkdir -p "$UNIT_DIR"

echo "=== installing units to $UNIT_DIR ==="
cp -f "$UNIT_SRC"/*.service "$UNIT_DIR/"
cp -f "$UNIT_SRC"/*.target "$UNIT_DIR/"
cp -f "$UNIT_SRC"/eduai-dev.env "$UNIT_DIR/eduai-dev.env"

# Expand %h is not needed in unit files (systemd does it). Ensure volta npm exists.
if [ ! -x "${HOME}/.volta/bin/npm" ]; then
  echo "ERROR: ${HOME}/.volta/bin/npm not found. Adjust ExecStart paths in the unit files."
  exit 1
fi

systemctl --user daemon-reload
systemctl --user enable eduai-core.service eduai-aitutor-server.service \
  eduai-aitutor-fe.service eduai-qm-backend.service eduai-qm-frontend.service \
  eduai-dev.target

echo
echo "Installed and enabled (not started yet)."
echo
echo "ONE-TIME (requires sudo) so units survive SSH logout / reboot:"
echo "  sudo loginctl enable-linger ${USER}"
echo "  loginctl show-user ${USER} -p Linger   # expect Linger=yes"
echo
echo "Then migrate off tmux:"
echo "  bash ${SCRIPT_DIR}/go-live-systemd-start.sh"
