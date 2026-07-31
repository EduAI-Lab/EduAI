#!/usr/bin/env bash
# Unit tests for infra/cmps01/lib/check-example-secrets.sh (#1115).
# Run: bash infra/cmps01/tests/check-example-secrets.test.sh
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../lib/check-example-secrets.sh
source "${DIR}/lib/check-example-secrets.sh"

pass=0
fail=0

assert_rejects() {
  local label="$1"
  local value="$2"
  CMPS01_INTERNAL_KEY="${value}"
  if check_cmps01_internal_key 2>/tmp/cmps01-check-err.$$; then
    echo "FAIL: expected reject for ${label}"
    fail=$((fail + 1))
  else
    local err
    err="$(cat /tmp/cmps01-check-err.$$)"
    rm -f /tmp/cmps01-check-err.$$
    if echo "${err}" | grep -q "${value}" && [ -n "${value}" ]; then
      echo "FAIL: error message leaked the secret for ${label}"
      fail=$((fail + 1))
      return
    fi
    if ! echo "${err}" | grep -q "FATAL:"; then
      echo "FAIL: missing FATAL message for ${label}"
      fail=$((fail + 1))
      return
    fi
    echo "ok: rejects ${label}"
    pass=$((pass + 1))
  fi
}

assert_accepts() {
  local label="$1"
  local value="$2"
  CMPS01_INTERNAL_KEY="${value}"
  if check_cmps01_internal_key 2>/tmp/cmps01-check-err.$$; then
    echo "ok: accepts ${label}"
    pass=$((pass + 1))
  else
    echo "FAIL: expected accept for ${label}: $(cat /tmp/cmps01-check-err.$$)"
    fail=$((fail + 1))
  fi
  rm -f /tmp/cmps01-check-err.$$
}

assert_rejects "vllm-local" "vllm-local"
assert_rejects "changeme-run-deploy-edge-proxy" "changeme-run-deploy-edge-proxy"
assert_rejects "change-me-use-openssl-rand-hex-32" "change-me-use-openssl-rand-hex-32"
assert_rejects "empty string" ""

# Unset
unset CMPS01_INTERNAL_KEY || true
if check_cmps01_internal_key 2>/tmp/cmps01-check-err.$$; then
  echo "FAIL: expected reject for unset"
  fail=$((fail + 1))
else
  err="$(cat /tmp/cmps01-check-err.$$)"
  rm -f /tmp/cmps01-check-err.$$
  if echo "${err}" | grep -q "FATAL:"; then
    echo "ok: rejects unset"
    pass=$((pass + 1))
  else
    echo "FAIL: missing FATAL for unset"
    fail=$((fail + 1))
  fi
fi

assert_accepts "synthetic openssl-like key" "a1b2c3d4e5f6789012345678abcdef01"

# Early-exit: deploy must not reach docker when key is bad (smoke via subshell dry-run of check only).
if CMPS01_INTERNAL_KEY=vllm-local bash -c 'source "'"${DIR}"'/lib/check-example-secrets.sh"; check_cmps01_internal_key' 2>/dev/null; then
  echo "FAIL: deploy check would not block vllm-local"
  fail=$((fail + 1))
else
  echo "ok: deploy check blocks before services"
  pass=$((pass + 1))
fi

# migrate.sh must validate before any docker stop/run (static order check).
migrate="${DIR}/migrate.sh"
check_line="$(grep -n 'check_cmps01_internal_key' "${migrate}" | head -1 | cut -d: -f1)"
docker_line="$(grep -nE '^docker stop ' "${migrate}" | head -1 | cut -d: -f1)"
if [ -n "${check_line}" ] && [ -n "${docker_line}" ] && [ "${check_line}" -lt "${docker_line}" ]; then
  echo "ok: migrate.sh validates before docker stop"
  pass=$((pass + 1))
else
  echo "FAIL: migrate.sh must call check_cmps01_internal_key before docker stop (check=${check_line:-missing} docker=${docker_line:-missing})"
  fail=$((fail + 1))
fi

echo "---"
echo "passed=${pass} failed=${fail}"
[ "${fail}" -eq 0 ]
