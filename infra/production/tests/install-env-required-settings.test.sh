#!/usr/bin/env bash
# Contract test for `install-env` in admin-helper.sh (#1935, #1904): it must
# refuse a Core environment where a setting whose absence breaks prod silently
# is missing, empty or duplicated, or COOKIE_DOMAIN is not .eduai.ok.ubc.ca,
# and install a complete one. Run from the repo root:
#   bash infra/production/tests/install-env-required-settings.test.sh
#
# Runs a copy of the helper with /etc/eduai pointed at a temp dir and `install`
# stubbed, so it needs no root and touches nothing outside the temp dir.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/eduai-install-env.XXXXXX")"
trap 'rm -rf "$TEST_DIR"' EXIT

mkdir -p "$TEST_DIR/etc/production-templates" "$TEST_DIR/bin"
sed "s|/etc/eduai|$TEST_DIR/etc|g" "$ROOT_DIR/infra/production/admin-helper.sh" >"$TEST_DIR/helper.sh"

# `install -o root -g eduai -m 0640 SRC DEST` → plain copy of SRC to DEST.
cat >"$TEST_DIR/bin/install" <<'STUB'
#!/usr/bin/env bash
cp "${@: -2:1}" "${@: -1}"
STUB
chmod +x "$TEST_DIR/bin/install"
export PATH="$TEST_DIR/bin:$PATH"

TEMPLATE="$TEST_DIR/etc/production-templates/eduai-core.env"
LIVE="$TEST_DIR/etc/eduai-core.env"

complete_env() {
  cat <<'ENV'
NODE_ENV=production
BETTER_AUTH_URL=https://my.eduai.ok.ubc.ca
COOKIE_DOMAIN=.eduai.ok.ubc.ca
EDUAI_API_KEY=test-service-key
ENV
}

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# A complete file installs.
complete_env >"$TEMPLATE"
rm -f "$LIVE"
bash "$TEST_DIR/helper.sh" install-env >/dev/null || fail "complete environment was refused"
cmp -s "$TEMPLATE" "$LIVE" || fail "complete environment was not installed"

expect_refused() {
  local label=$1 expected=$2
  echo "LIVE-BEFORE" >"$LIVE"
  if output=$(bash "$TEST_DIR/helper.sh" install-env 2>&1); then
    fail "install-env accepted an environment with $label"
  fi
  [[ "$output" == *"$expected"* ]] || fail "unexpected error for $label: $output"
  [[ "$(cat "$LIVE")" == "LIVE-BEFORE" ]] || fail "live file was overwritten with $label"
}

# Each required setting, missing, empty or empty-quoted, is refused and the live
# file is untouched. systemd strips the quotes, so KEY="" starts Core empty.
for key in BETTER_AUTH_URL COOKIE_DOMAIN EDUAI_API_KEY; do
  complete_env | grep -v "^${key}=" >"$TEMPLATE"
  expect_refused "$key missing" "missing or has an empty $key"
  complete_env | sed "s|^${key}=.*|${key}=|" >"$TEMPLATE"
  expect_refused "$key empty" "missing or has an empty $key"
  complete_env | sed "s|^${key}=.*|${key}=\"\"|" >"$TEMPLATE"
  expect_refused "$key empty-quoted" "missing or has an empty $key"
  { complete_env; echo "${key}="; } >"$TEMPLATE"
  expect_refused "$key duplicated" "sets $key more than once"
done

# COOKIE_DOMAIN values that start Core without a shared session cookie.
for bad in localhost .ok.ubc.ca eduai.ok.ubc.ca; do
  complete_env | sed "s|^COOKIE_DOMAIN=.*|COOKIE_DOMAIN=${bad}|" >"$TEMPLATE"
  expect_refused "COOKIE_DOMAIN=${bad}" "must set COOKIE_DOMAIN=.eduai.ok.ubc.ca"
done

# The right value, quoted, is accepted (read the way systemd reads it).
complete_env | sed 's|^COOKIE_DOMAIN=.*|COOKIE_DOMAIN=".eduai.ok.ubc.ca"|' >"$TEMPLATE"
rm -f "$LIVE"
bash "$TEST_DIR/helper.sh" install-env >/dev/null || fail "quoted COOKIE_DOMAIN was refused"

echo "install-env required settings contract: PASS"
