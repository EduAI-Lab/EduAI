#!/usr/bin/env bash
# infra/cron/dry-run-local.sh
# Local validation for backup-nightly / backup-offsite / backup-rotate without
# installing to /opt/eduai or /etc/cron.d. Run from repo root:
#
#   bash infra/cron/dry-run-local.sh all
#   bash infra/cron/dry-run-local.sh nightly
#   bash infra/cron/dry-run-local.sh offsite
#   bash infra/cron/dry-run-local.sh rotate
#
# See docs/implementations/server-backup-cron-local-testing.md

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${EDUAI_CRON_ENV:-$SCRIPT_DIR/cron.env.local}"

usage() {
  echo "Usage: bash infra/cron/dry-run-local.sh [nightly|offsite|rotate|all]"
  exit 1
}

require_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "Missing $ENV_FILE"
    echo "Copy infra/cron/cron.env.local.example to infra/cron/cron.env.local and adjust ports/passwords."
    exit 1
  fi
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  : "${DB_HOST:?}" "${DB_PORT_CORE:?}" "${DB_PORT_TUTOR:?}" "${DB_PORT_QM:?}"
  : "${DB_USER:?}" "${DB_PASS:?}" "${BACKUP_DIR:?}" "${BACKUP_RETAIN_DAYS:?}"
  : "${AUDIT_LOG:?}" "${ALERT_EMAIL:?}"
  DB_PASS_QM="${DB_PASS_QM:-$DB_PASS}"

  BACKUP_DIR="$REPO_ROOT/$BACKUP_DIR"
  AUDIT_LOG="$REPO_ROOT/$AUDIT_LOG"
  if [[ -n "${LOCAL_OFFSITE_DIR:-}" ]]; then
    LOCAL_OFFSITE_DIR="$REPO_ROOT/$LOCAL_OFFSITE_DIR"
  fi
  mkdir -p "$BACKUP_DIR" "$(dirname "$AUDIT_LOG")"
  [[ -n "${LOCAL_OFFSITE_DIR:-}" ]] && mkdir -p "$LOCAL_OFFSITE_DIR"
}

log() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" | tee -a "$AUDIT_LOG"
}

die() {
  log "ERROR: $*"
  exit 1
}

pg_dump_for() {
  local port=$1 dbname=$2 password=$3 container=$4
  export PGPASSWORD="$password"

  if command -v pg_dump >/dev/null 2>&1; then
    pg_dump -h "$DB_HOST" -p "$port" -U "$DB_USER" "$dbname"
    return
  fi

  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx "$container"; then
    docker exec -e PGPASSWORD="$password" "$container" pg_dump -U "$DB_USER" "$dbname"
    return
  fi

  die "pg_dump not found and container $container is not running. Install PostgreSQL client tools or start dev DBs (npm run docker:dev:db)."
}

run_nightly() {
  local DATE
  DATE="$(date -u '+%Y%m%d')"

  backup_db() {
    local label=$1 port=$2 dbname=$3 password=$4 container=$5
    local outfile="$BACKUP_DIR/${label}_${DATE}.sql.gz"
    log "Starting backup: $label -> $outfile"
    pg_dump_for "$port" "$dbname" "$password" "$container" | gzip > "$outfile" \
      || die "pg_dump failed for $label"
    log "Backup complete: $outfile ($(du -sh "$outfile" | cut -f1))"
  }

  log "=== Local nightly backup run: $DATE ==="
  backup_db eduai-core     "$DB_PORT_CORE"  eduai           "$DB_PASS"     eduai-db
  backup_db ai-tutor       "$DB_PORT_TUTOR" ai-tutor        "$DB_PASS"     eduai-ai-tutor-db
  backup_db question-maker "$DB_PORT_QM"    question-maker  "$DB_PASS_QM"  eduai-question-maker-db
  log "=== All nightly backups complete for $DATE ==="
}

run_offsite() {
  local DATE pattern
  DATE="$(date -u '+%Y%m%d')"
  pattern="*_${DATE}.sql.gz"
  log "=== Local off-site sync for $DATE ==="

  if [[ -n "${LOCAL_OFFSITE_DIR:-}" ]]; then
    shopt -s nullglob
    local files=("$BACKUP_DIR"/$pattern)
    if [[ ${#files[@]} -eq 0 ]]; then
      die "No dumps matching $pattern in $BACKUP_DIR — run nightly first"
    fi
    for f in "${files[@]}"; do
      cp -f "$f" "$LOCAL_OFFSITE_DIR/"
      log "Copied to off-site dir: $f"
    done
    log "=== Local off-site sync complete ($LOCAL_OFFSITE_DIR) ==="
    return
  fi

  if ! command -v aws >/dev/null 2>&1; then
    die "Set LOCAL_OFFSITE_DIR in cron.env.local or install AWS CLI for real S3 sync"
  fi
  : "${OFFSITE_BUCKET:?}"
  aws s3 sync "$BACKUP_DIR" "$OFFSITE_BUCKET" \
    --exclude '*' --include "$pattern" \
    || die "Off-site sync failed for $DATE"
  log "=== Off-site sync complete for $DATE ==="
}

run_rotate() {
  log "=== Backup rotation: removing dumps older than $BACKUP_RETAIN_DAYS days ==="
  while IFS= read -r -d '' f; do
    log "Deleted local backup: $f"
  done < <(find "$BACKUP_DIR" -name '*.sql.gz' -mtime +"$BACKUP_RETAIN_DAYS" -type f -print0 -delete)
  log "=== Backup rotation complete ==="
}

main() {
  local cmd="${1:-all}"
  cd "$REPO_ROOT"
  require_env

  case "$cmd" in
    nightly) run_nightly ;;
    offsite) run_offsite ;;
    rotate)  run_rotate ;;
    all)
      run_nightly
      run_offsite
      run_rotate
      ;;
    -h|--help|help) usage ;;
    *) usage ;;
  esac

  echo ""
  echo "Artifacts:"
  echo "  dumps:  $BACKUP_DIR"
  [[ -n "${LOCAL_OFFSITE_DIR:-}" ]] && echo "  offsite: $LOCAL_OFFSITE_DIR"
  echo "  log:    $AUDIT_LOG"
}

main "$@"
