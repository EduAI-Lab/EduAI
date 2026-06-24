#!/usr/bin/env bash
# infra/cron/backup-rotate.sh
# Deletes local pg_dump files older than $BACKUP_RETAIN_DAYS days.
# Crontab: 15 3 * * *  (UTC)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

trap 'cron_fail "Script exited unexpectedly"' ERR
[[ -z "${CORE_CRON_RUN_ID:-}" ]] && cron_start "backup-rotate"

log "=== Backup rotation: removing dumps older than $BACKUP_RETAIN_DAYS days ==="

while IFS= read -r -d '' f; do
  log "Deleted local backup: $f"
done < <(find "$BACKUP_DIR" -name '*.sql.gz' -mtime +"$BACKUP_RETAIN_DAYS" -type f -print0 -delete)

log "=== Backup rotation complete ==="

[[ -z "${CORE_CRON_RUN_ID:-}" ]] && cron_finish
