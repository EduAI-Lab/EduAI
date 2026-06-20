#!/usr/bin/env bash
# infra/cron/backup-nightly.sh
# Nightly full pg_dump of all three EduAI databases.
# Crontab: 0 2 * * *  (UTC)

set -euo pipefail
source /opt/eduai/cron/lib.sh

DATE=$(date -u '+%Y%m%d')
mkdir -p "$BACKUP_DIR"

backup_db() {
  local label=$1 port=$2 dbname=$3
  local outfile="$BACKUP_DIR/${label}_${DATE}.sql.gz"
  log "Starting backup: $label -> $outfile"
  pg_dump -h "$DB_HOST" -p "$port" -U "$DB_USER" "$dbname" \
    | gzip > "$outfile" \
    || die "pg_dump failed for $label"
  log "Backup complete: $outfile ($(du -sh "$outfile" | cut -f1))"
}

cron_start "backup-nightly"
log "=== Nightly backup run: $DATE ==="
backup_db eduai-core     "$DB_PORT_CORE"  eduai
backup_db ai-tutor       "$DB_PORT_TUTOR" ai-tutor
backup_db question-maker "$DB_PORT_QM"    question-maker
log "=== All nightly backups complete for $DATE ==="
cron_finish
