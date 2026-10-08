#!/usr/bin/env bash
# Contract tests for the per-database connection settings in lib.sh and
# backup-nightly.sh (#1873). Run from the repository root with:
#   bash infra/cron/tests/per-db-settings.test.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TEST_DIR="$(mktemp -d "${TMPDIR:-/tmp}/eduai-cron-perdb.XXXXXX")"
trap 'rm -rf "$TEST_DIR"' EXIT

mkdir -p "$TEST_DIR/bin" "$TEST_DIR/shared" "$TEST_DIR/perdb"

# Fake clients record their arguments and the password they were given.
cat >"$TEST_DIR/bin/psql" <<'EOF'
#!/usr/bin/env bash
printf 'psql PGPASSWORD=%s' "${PGPASSWORD:-}" >>"$FAKE_LOG"
printf ' %q' "$@" >>"$FAKE_LOG"
printf '\n' >>"$FAKE_LOG"
EOF
cat >"$TEST_DIR/bin/pg_dump" <<'EOF'
#!/usr/bin/env bash
printf 'pg_dump PGPASSWORD=%s' "${PGPASSWORD:-}" >>"$FAKE_LOG"
printf ' %q' "$@" >>"$FAKE_LOG"
printf '\n' >>"$FAKE_LOG"
echo "-- fake dump"
EOF
# Production's cron user has no Docker access: `docker ps` fails.
cat >"$TEST_DIR/bin/docker" <<'EOF'
#!/usr/bin/env bash
echo "permission denied while trying to connect to the Docker daemon socket" >&2
exit 1
EOF
chmod +x "$TEST_DIR/bin/"*
export PATH="$TEST_DIR/bin:$PATH"
export FAKE_LOG="$TEST_DIR/fake.log"

base_env() {
  cat <<EOF
DB_HOST=localhost
DB_PORT_CORE=5432
DB_PORT_TUTOR=54321
DB_PORT_QM=54322
BACKUP_DIR=$1/backups
AUDIT_LOG=$1/audit.log
ALERT_EMAIL=test@example.invalid
EOF
}

# Shared settings only: the original single-user layout keeps working.
base_env "$TEST_DIR/shared" >"$TEST_DIR/shared/cron.env.local"
cat >>"$TEST_DIR/shared/cron.env.local" <<'EOF'
DB_USER=postgres
DB_PASS=shared-pass
DB_PASS_QM=qm-pass
EOF

# Production-style settings: every database has its own name, user and password.
base_env "$TEST_DIR/perdb" >"$TEST_DIR/perdb/cron.env.local"
cat >>"$TEST_DIR/perdb/cron.env.local" <<'EOF'
DB_NAME_CORE=eduai_prod
DB_USER_CORE=eduai_prod_app
DB_PASS_CORE=core-pass
DB_NAME_TUTOR=tutor_db
DB_USER_TUTOR=tutor_user
DB_PASS_TUTOR=tutor-pass
DB_NAME_QM=qm_db
DB_USER_QM=qm_user
DB_PASS_QM=qm-pass
EOF

for dir in shared perdb; do
  cp "$ROOT_DIR/infra/cron/lib.sh" "$ROOT_DIR/infra/cron/backup-nightly.sh" "$TEST_DIR/$dir/"
done

fail() {
  echo "FAIL: $*" >&2
  echo "--- fake log ---" >&2
  cat "$FAKE_LOG" >&2 || true
  exit 1
}

assert_logged() {
  grep -qF -- "$1" "$FAKE_LOG" || fail "expected log line containing: $1"
}

run_psql_helpers() {
  local dir=$1
  : >"$FAKE_LOG"
  (
    cd "$TEST_DIR/$dir"
    # shellcheck source=/dev/null
    source ./lib.sh
    psql_core -c 'select 1'
    psql_tutor -c 'select 1'
    psql_qm -c 'select 1'
  )
}

run_backup() {
  local dir=$1
  : >"$FAKE_LOG"
  (cd "$TEST_DIR/$dir" && CORE_CRON_RUN_ID=test-run bash ./backup-nightly.sh >/dev/null) ||
    fail "backup-nightly.sh exited non-zero for $dir settings"
  local count
  count=$(find "$TEST_DIR/$dir/backups" -name '*.sql.gz' | wc -l | tr -d ' ')
  [[ "$count" == 3 ]] || fail "expected 3 backup files for $dir, found $count"
}

run_psql_helpers shared
assert_logged "psql PGPASSWORD=shared-pass -h localhost -p 5432 -U postgres -d eduai"
assert_logged "psql PGPASSWORD=shared-pass -h localhost -p 54321 -U postgres -d ai-tutor"
assert_logged "psql PGPASSWORD=qm-pass -h localhost -p 54322 -U postgres -d question-maker"

run_psql_helpers perdb
assert_logged "psql PGPASSWORD=core-pass -h localhost -p 5432 -U eduai_prod_app -d eduai_prod"
assert_logged "psql PGPASSWORD=tutor-pass -h localhost -p 54321 -U tutor_user -d tutor_db"
assert_logged "psql PGPASSWORD=qm-pass -h localhost -p 54322 -U qm_user -d qm_db"

run_backup shared
assert_logged "pg_dump PGPASSWORD=shared-pass -h localhost -p 5432 -U postgres eduai"
assert_logged "pg_dump PGPASSWORD=qm-pass -h localhost -p 54322 -U postgres question-maker"

run_backup perdb
assert_logged "pg_dump PGPASSWORD=core-pass -h localhost -p 5432 -U eduai_prod_app eduai_prod"
assert_logged "pg_dump PGPASSWORD=tutor-pass -h localhost -p 54321 -U tutor_user tutor_db"
assert_logged "pg_dump PGPASSWORD=qm-pass -h localhost -p 54322 -U qm_user qm_db"

echo "per-db cron settings contract: PASS"
