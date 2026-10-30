#!/usr/bin/env bash
# Keep dev (s378) on the latest `development` (#2050). Run nightly by
# eduai-dev-update.timer as service_eduai; teammates can run it by hand too:
#
#   sudo systemctl start eduai-dev-update.service     # or wait for the timer
#   journalctl -u eduai-dev-update.service -n 50      # what it did
#
# What it does:
#   1. Skip when origin/development is already the commit deployed last time.
#   2. Otherwise build it (eduai-dev-build: pull, npm install, migrate, build).
#   3. Only if the build succeeded, restart and wait for every port
#      (go-live-build.sh --restart-only). A failed build leaves the running
#      services alone, and the unit fails so `systemctl --failed` shows it.
#
# The deployed commit is recorded only after a healthy restart, so a failed
# night is retried the next night instead of being skipped as "already current".
set -euo pipefail

# Everything runs inside main(): eduai-dev-build pulls new commits into this very
# checkout, and bash reads a script as it goes, so an edit to this file landing
# mid-run could execute half-old, half-new lines. A function is parsed whole first.
main() {
  REPO=/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore
  STATE=/var/lib/service_eduai/dev-deployed-commit
  export PATH=/usr/local/bin:/usr/bin:/bin
  export HOME=/var/lib/service_eduai

  [ "$(id -un)" = "service_eduai" ] \
    || { echo "run as service_eduai (the eduai-dev-update service does)" >&2; exit 1; }
  cd "$REPO"

  git fetch --quiet origin development
  TARGET=$(git rev-parse origin/development)
  DEPLOYED=$(cat "$STATE" 2>/dev/null || echo none)

  if [ "$TARGET" = "$DEPLOYED" ]; then
    echo "dev is current: $(git log -1 --format='%h %s' "$TARGET")"
    exit 0
  fi
  if [ "$DEPLOYED" != none ] && git cat-file -e "$DEPLOYED" 2>/dev/null; then
    echo "dev is $(git rev-list --count "$DEPLOYED..$TARGET") commits behind development; updating"
  else
    echo "no record of the deployed commit; updating to development"
  fi

  /usr/local/sbin/eduai-dev-build
  bash infra/s378/go-live-build.sh --restart-only

  git rev-parse HEAD > "$STATE"
  echo "dev updated to $(git log -1 --format='%h %s')"
}

main "$@"
