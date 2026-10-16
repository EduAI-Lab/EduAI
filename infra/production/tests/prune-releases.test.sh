#!/usr/bin/env bash
# Contract test for release pruning in admin-helper.sh (#1869): activating a
# release keeps it and the release it replaced (the rollback target) and removes
# every other release, so deploys stop filling s348's disk. Run from the repo root:
#   bash infra/production/tests/prune-releases.test.sh
#
# Runs a copy of the helper with the release tree pointed at a temp dir and
# `setfacl` stubbed, so it needs no root and touches nothing outside the temp dir.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/eduai-prune.XXXXXX")"
TEST_DIR="$(cd "$TEST_DIR" && pwd -P)"
trap 'rm -rf "$TEST_DIR"' EXIT

ROOT="$TEST_DIR/srv"
mkdir -p "$ROOT/releases" "$TEST_DIR/bin"
sed "s|/srv/www/eduai-production|$ROOT|g" "$ROOT_DIR/infra/production/admin-helper.sh" >"$TEST_DIR/helper.sh"
printf '#!/usr/bin/env bash\nexit 0\n' >"$TEST_DIR/bin/setfacl"
chmod +x "$TEST_DIR/bin/setfacl"
export PATH="$TEST_DIR/bin:$PATH"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

helper() { bash "$TEST_DIR/helper.sh" "$@"; }

# A release complete enough for validate-release, made $1 minutes in the past.
make_release() {
  local id=$1 age=$2 r="$ROOT/releases/$1" f
  for f in \
    apps/core/build/server/index.js \
    apps/core/node_modules/@prisma/client/index.js \
    apps/extensions/ai-tutor/server/node_modules/@eduai/ai-tutor-prisma-client/index.js \
    apps/extensions/ai-tutor/build/client/index.html \
    apps/extensions/question-maker/app/backend/node_modules/@eduai/question-maker-prisma-client/index.js \
    apps/extensions/question-maker/app/frontend/dist/index.html; do
    mkdir -p "$(dirname "$r/$f")"
    : >"$r/$f"
  done
  touch -t "$(date -v-"${age}"M +%Y%m%d%H%M 2>/dev/null || date -d "-$age minutes" +%Y%m%d%H%M)" "$r"
}

releases() { (cd "$ROOT/releases" && ls -1 | tr '\n' ' '); }

# Prod today: four releases, the newest live, nothing recording `previous`.
make_release 6aa7b9f7 40
make_release 1904c83f 30
make_release 4871d6fe 20
make_release 1e45c79b 10
ln -sfn "$ROOT/releases/1e45c79b" "$ROOT/current"

# 1. Pruning by hand keeps the live release and the newest other one.
out=$(helper prune-releases)
[[ "$(releases)" == "1e45c79b 4871d6fe " ]] || fail "first prune kept: $(releases)"
[[ "$out" == *"Removed release 6aa7b9f7"* && "$out" == *"Removed release 1904c83f"* ]] ||
  fail "prune did not report what it removed: $out"

# 2. Activating a new release records the old live one as `previous` and prunes.
make_release aaaa1111 0
helper activate-release aaaa1111 >/dev/null
[[ "$(readlink "$ROOT/current")" == "$ROOT/releases/aaaa1111" ]] || fail "current not flipped"
[[ "$(readlink "$ROOT/previous")" == "$ROOT/releases/1e45c79b" ]] || fail "previous not recorded"
[[ "$(releases)" == "1e45c79b aaaa1111 " ]] || fail "activation kept: $(releases)"

# 3. Rolling back keeps the release rolled back from, so it can be re-activated.
helper activate-release 1e45c79b >/dev/null
[[ "$(readlink "$ROOT/previous")" == "$ROOT/releases/aaaa1111" ]] || fail "rollback lost previous"
[[ "$(releases)" == "1e45c79b aaaa1111 " ]] || fail "rollback removed a release: $(releases)"

# 4. A build newer than the live release is waiting to be activated: kept.
touch -t "$(date -v-5M +%Y%m%d%H%M 2>/dev/null || date -d "-5 minutes" +%Y%m%d%H%M)" "$ROOT/releases/1e45c79b"
make_release bbbb2222 0
helper prune-releases >/dev/null
[[ "$(releases)" == "1e45c79b aaaa1111 bbbb2222 " ]] || fail "removed a build awaiting activation: $(releases)"
rm -rf "$ROOT/releases/bbbb2222"

# 5. Without a live release it refuses and deletes nothing.
rm "$ROOT/current"
if helper prune-releases >/dev/null 2>&1; then fail "pruned with no current release"; fi
[[ "$(releases)" == "1e45c79b aaaa1111 " ]] || fail "refused prune still deleted: $(releases)"

# 6. A non-release entry is left alone.
ln -sfn "$ROOT/releases/1e45c79b" "$ROOT/current"
mkdir "$ROOT/releases/notes"
helper prune-releases >/dev/null
[[ -d "$ROOT/releases/notes" ]] || fail "removed a non-release directory"

echo "PASS: prune-releases"
