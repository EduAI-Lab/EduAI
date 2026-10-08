#!/usr/bin/env bash
# infra/cron/backup-nightly.sh
# Nightly full pg_dump of all three EduAI databases.
# Crontab: 0 2 * * *  (UTC)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

trap 'cron_fail "Script exited unexpectedly"' ERR
[[ -z "${CORE_CRON_RUN_ID:-}" ]] && cron_start "backup-nightly"

DATE=$(date -u '+%Y%m%d')
mkdir -p "$BACKUP_DIR"

# Run pg_dump for a single database, falling back to the host pg_dump when the
# database container isn't reachable. Name, user and password come from the
# per-database settings in lib.sh (#1873).
pg_dump_for() {
  local port=$1 dbname=$2 container=$3 user=$4 pass=$5
  # Prefer the database container's client. The shared dev host may have an
  # older system pg_dump than its PostgreSQL server, which PostgreSQL rejects.
  # A user without Docker access (production's eduai-cron) falls through quietly.
  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$container"; then
    docker exec -e PGPASSWORD="$pass" "$container" pg_dump -U "$user" "$dbname"
    return
  fi
  if command -v pg_dump >/dev/null 2>&1; then
    PGPASSWORD="$pass" pg_dump -h "$DB_HOST" -p "$port" -U "$user" "$dbname"
    return
  fi
  die "pg_dump not found and container '$container' is not running. Install PostgreSQL client tools or start dev DBs."
}

backup_db() {
  local label=$1 port=$2 dbname=$3 container=$4 user=$5 pass=$6
  local outfile="$BACKUP_DIR/${label}_${DATE}.sql.gz"
  log "Starting backup: $label -> $outfile"
  pg_dump_for "$port" "$dbname" "$container" "$user" "$pass" \
    | gzip > "$outfile" \
    || die "pg_dump failed for $label"
  log "Backup complete: $outfile ($(du -sh "$outfile" | cut -f1))"
}

log "=== Nightly backup run: $DATE ==="
backup_db eduai-core     "$DB_PORT_CORE"  "$DB_NAME_CORE"  "$DB_CONTAINER_CORE"  "$DB_USER_CORE"  "$DB_PASS_CORE"
backup_db ai-tutor       "$DB_PORT_TUTOR" "$DB_NAME_TUTOR" "$DB_CONTAINER_TUTOR" "$DB_USER_TUTOR" "$DB_PASS_TUTOR"
backup_db question-maker "$DB_PORT_QM"    "$DB_NAME_QM"    "$DB_CONTAINER_QM"    "$DB_USER_QM"    "$DB_PASS_QM"
log "=== All nightly backups complete for $DATE ==="

if [[ -z "${CORE_CRON_RUN_ID:-}" ]]; then
  cron_finish
fi
