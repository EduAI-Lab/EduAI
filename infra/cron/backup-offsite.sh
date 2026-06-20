#!/usr/bin/env bash
# infra/cron/backup-offsite.sh
# Syncs tonight's pg_dump files to the configured off-site bucket or SFTP.
# Runs after backup-nightly.sh has finished.
# Crontab: 45 2 * * *  (UTC)
#
# For S3: requires AWS CLI configured with credentials (IAM role or ~/.aws/credentials).
# For SFTP: replace the `aws s3 sync` command with an appropriate sftp/rsync call.

set -euo pipefail
source /opt/eduai/cron/lib.sh

DATE=$(date -u '+%Y%m%d')
cron_start "backup-offsite"
log "=== Off-site sync for $DATE ==="

aws s3 sync "$BACKUP_DIR" "$OFFSITE_BUCKET" \
  --exclude '*' --include "*_${DATE}.sql.gz" \
  || cron_fail "Off-site sync failed for $DATE"

log "=== Off-site sync complete for $DATE ==="
cron_finish
