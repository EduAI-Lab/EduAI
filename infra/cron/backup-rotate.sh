#!/usr/bin/env bash
# infra/cron/backup-rotate.sh
# Deletes local pg_dump files older than $BACKUP_RETAIN_DAYS days.
# Crontab: 15 3 * * *  (UTC)

set -euo pipefail
source /opt/eduai/cron/lib.sh

cron_start "backup-rotate"
log "=== Backup rotation: removing dumps older than $BACKUP_RETAIN_DAYS days ==="

while IFS= read -r -d '' f; do
  log "Deleted local backup: $f"
done < <(find "$BACKUP_DIR" -name '*.sql.gz' -mtime +"$BACKUP_RETAIN_DAYS" -type f -print0 -delete)

log "=== Backup rotation complete ==="
cron_finish
