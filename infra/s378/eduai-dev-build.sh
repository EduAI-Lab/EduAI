#!/usr/bin/env bash
# Installed root-owned as /usr/local/sbin/eduai-dev-build by
# go-live-systemd-install.sh. eduai-dev members run it as the service account:
#
#   sudo -u service_eduai /usr/local/sbin/eduai-dev-build
#
# then restart + verify as themselves:
#
#   bash infra/s378/go-live-build.sh --restart-only
#
# Argument-less on purpose, so the sudoers grant (#1872) stays narrow: it can
# only update the shared checkout to origin/development and build it.
set -euo pipefail

REPO=/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore
[ "$#" -eq 0 ] || { echo "eduai-dev-build takes no arguments" >&2; exit 2; }
[ "$(id -un)" = "service_eduai" ] \
  || { echo "run as: sudo -u service_eduai $0" >&2; exit 1; }

# sudo resets PATH; the host's /usr/bin/node is v10, the units use /usr/local/bin/node.
export PATH=/usr/local/bin:/usr/bin:/bin
export HOME=/var/lib/service_eduai
umask 0002
cd "$REPO"

# `npm install` rewrites these generated files on every deploy; they are not
# anyone's work, so put them back rather than letting them block the pull.
git checkout --quiet -- package-lock.json packages/types/dist 2>/dev/null || true

# The shared checkout is sometimes left on a feature branch for testing. Refuse
# to deploy over local edits, then put it back on development before pulling.
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "ERROR: tracked files have local changes; resolve them before deploying:" >&2
  git status --short --untracked-files=no >&2
  exit 1
fi
git fetch --quiet origin
git checkout --quiet development
git pull --ff-only --quiet origin development
echo "deploying $(git log -1 --oneline)"

exec bash infra/s378/go-live-build.sh --install --no-restart
