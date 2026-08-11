#!/usr/bin/env bash
# Contract tests for the standalone cron lease path in lib.sh.
# Run from the repository root with:
#   bash infra/cron/tests/standalone-lease-contract.test.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/eduai-cron-lease.XXXXXX")"
trap 'rm -rf "$TEST_DIR"' EXIT

mkdir -p "$TEST_DIR/bin"
cat >"$TEST_DIR/cron.env.local" <<EOF
DB_HOST=localhost
DB_PORT_CORE=54320
DB_PORT_TUTOR=54321
DB_PORT_QM=55432
DB_USER=postgres
DB_PASS=postgres
AUDIT_LOG=$TEST_DIR/audit.log
ALERT_EMAIL=test@example.invalid
EOF

cat >"$TEST_DIR/bin/psql" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

sql=""
while (($#)); do
  case "$1" in
    -c)
      sql=$2
      shift 2
      ;;
    *) shift ;;
  esac
done

if [[ -z "$sql" ]]; then
  sql=$(cat)
fi

printf '%s\n' "$sql" >>"$FAKE_PSQL_SQL_LOG"

if [[ -f "$FAKE_PSQL_FAIL_FILE" ]]; then
  echo "simulated database failure" >&2
  exit 17
fi

if [[ "$sql" == *"INSERT INTO cron_job_runs"* ]]; then
  printf 'run-id|owner-token\n'
elif [[ -f "$FAKE_PSQL_EMPTY_UPDATE_FILE" ]]; then
  :
else
  printf 'run-id\n'
fi
EOF
chmod +x "$TEST_DIR/bin/psql"

export PATH="$TEST_DIR/bin:$PATH"
export FAKE_PSQL_SQL_LOG="$TEST_DIR/sql.log"
export FAKE_PSQL_FAIL_FILE="$TEST_DIR/psql-fail"
export FAKE_PSQL_EMPTY_UPDATE_FILE="$TEST_DIR/psql-empty-update"

# Load the production library from a temporary directory so this test never
# creates or edits infra/cron/cron.env.local in the checkout.
cp "$ROOT_DIR/infra/cron/lib.sh" "$TEST_DIR/lib.sh"

source "$TEST_DIR/lib.sh"

assert_contains() {
  local needle=$1 file=$2
  grep -Fq "$needle" "$file" || {
    echo "expected $file to contain: $needle" >&2
    exit 1
  }
}

run_start_failure_must_be_fatal() {
  : >"$FAKE_PSQL_FAIL_FILE"
  if (cron_start "start-failure"); then
    echo "cron_start unexpectedly succeeded after a database failure" >&2
    exit 1
  fi
  rm -f "$FAKE_PSQL_FAIL_FILE"
}

run_success_contract() {
  : >"$FAKE_PSQL_SQL_LOG"
  cron_start "success-job"
  [[ "$CRON_RUN_ID" == "run-id" ]] || {
    echo "cron_start did not capture the run id" >&2
    exit 1
  }
  [[ "$CRON_LEASE_OWNER" == "owner-token" ]] || {
    echo "cron_start did not capture the lease owner" >&2
    exit 1
  }
  cron_finish

  assert_contains '"leaseOwner"' "$FAKE_PSQL_SQL_LOG"
  assert_contains '"leaseHeartbeatAt"' "$FAKE_PSQL_SQL_LOG"
  assert_contains '"leaseExpiresAt"' "$FAKE_PSQL_SQL_LOG"
  assert_contains "'RUNNING'::\"CronJobStatus\"" "$FAKE_PSQL_SQL_LOG"
  assert_contains "gen_random_uuid()::text" "$FAKE_PSQL_SQL_LOG"
  assert_contains ":'lease_ms'::bigint * INTERVAL '1 millisecond'" "$FAKE_PSQL_SQL_LOG"
  assert_contains 'statement_timestamp()' "$FAKE_PSQL_SQL_LOG"
  assert_contains 'AND "leaseOwner"' "$FAKE_PSQL_SQL_LOG"
  assert_contains '"leaseOwner" = NULL' "$FAKE_PSQL_SQL_LOG"
  assert_contains '"leaseHeartbeatAt" = NULL' "$FAKE_PSQL_SQL_LOG"
  assert_contains '"leaseExpiresAt" = NULL' "$FAKE_PSQL_SQL_LOG"
}

run_stale_owner_cannot_finalize() {
  : >"$FAKE_PSQL_SQL_LOG"
  : >"$FAKE_PSQL_EMPTY_UPDATE_FILE"
  cron_start "stale-job"
  if (cron_finish); then
    echo "cron_finish unexpectedly succeeded after its lease update matched no row" >&2
    exit 1
  fi
  rm -f "$FAKE_PSQL_EMPTY_UPDATE_FILE"
}

run_error_contract() {
  : >"$FAKE_PSQL_SQL_LOG"
  cron_start "error-job"
  if (cron_fail "simulated job failure"); then
    echo "cron_fail unexpectedly returned success" >&2
    exit 1
  fi

  assert_contains "status = 'ERROR'" "$FAKE_PSQL_SQL_LOG"
  assert_contains 'message = :' "$FAKE_PSQL_SQL_LOG"
  assert_contains '"leaseOwner" = NULL' "$FAKE_PSQL_SQL_LOG"
  assert_contains '"leaseHeartbeatAt" = NULL' "$FAKE_PSQL_SQL_LOG"
  assert_contains '"leaseExpiresAt" = NULL' "$FAKE_PSQL_SQL_LOG"
}

run_terminal_database_failure_must_be_fatal() {
  : >"$FAKE_PSQL_SQL_LOG"
  cron_start "finish-failure"
  : >"$FAKE_PSQL_FAIL_FILE"
  if (cron_finish); then
    echo "cron_finish unexpectedly succeeded after a database failure" >&2
    exit 1
  fi
  rm -f "$FAKE_PSQL_FAIL_FILE"
}

run_error_database_failure_is_reported() {
  : >"$FAKE_PSQL_SQL_LOG"
  cron_start "error-audit-failure"
  : >"$FAKE_PSQL_FAIL_FILE"
  local output
  output=$( (cron_fail "job failure with unavailable audit database") 2>&1 || true )
  rm -f "$FAKE_PSQL_FAIL_FILE"
  [[ "$output" == *"simulated database failure"* ]] || {
    echo "cron_fail swallowed the database error" >&2
    exit 1
  }
}

run_start_failure_must_be_fatal
run_success_contract
run_stale_owner_cannot_finalize
run_error_contract
run_terminal_database_failure_must_be_fatal
run_error_database_failure_is_reported

echo "standalone cron lease contract: PASS"
