#!/usr/bin/env bash
# infra/cron/backup-nightly.sh
# Nightly full pg_dump of all three EduAI databases.
# Crontab: 0 2 * * *  (UTC)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

DATE=$(date -u '+%Y%m%d')
mkdir -p "$BACKUP_DIR"

# Run pg_dump for a single database, falling back to docker exec when the
# pg_dump client isn't installed locally. Accepts an optional per-db password
# override (5th arg) so the QM container's different password is handled.
pg_dump_for() {
  local port=$1 dbname=$2 container=$3 pass="${4:-$PGPASSWORD}"
  if command -v pg_dump >/dev/null 2>&1; then
    PGPASSWORD="$pass" pg_dump -h "$DB_HOST" -p "$port" -U "$DB_USER" "$dbname"
    return
  fi
  if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -qx "$container"; then
    docker exec -e PGPASSWORD="$pass" "$container" pg_dump -U "$DB_USER" "$dbname"
    return
  fi
  die "pg_dump not found and container '$container' is not running. Install PostgreSQL client tools or start dev DBs."
}

backup_db() {
  local label=$1 port=$2 dbname=$3 container=$4 pass="${5:-$PGPASSWORD}"
  local outfile="$BACKUP_DIR/${label}_${DATE}.sql.gz"
  log "Starting backup: $label -> $outfile"
  pg_dump_for "$port" "$dbname" "$container" "$pass" \
    | gzip > "$outfile" \
    || die "pg_dump failed for $label"
  log "Backup complete: $outfile ($(du -sh "$outfile" | cut -f1))"
}

log "=== Nightly backup run: $DATE ==="
backup_db eduai-core     "$DB_PORT_CORE"  eduai           eduai-db
backup_db ai-tutor       "$DB_PORT_TUTOR" ai-tutor        eduai-ai-tutor-db
backup_db question-maker "$DB_PORT_QM"    question-maker  eduai-question-maker-db "${DB_PASS_QM:-$PGPASSWORD}"
log "=== All nightly backups complete for $DATE ==="
