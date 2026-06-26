#!/usr/bin/env bash
# infra/cron/backup-offsite.sh
# Syncs tonight's pg_dump files to the configured off-site bucket or SFTP.
# Runs after backup-nightly.sh has finished.
# Crontab: 45 2 * * *  (UTC)
#
# For S3: requires AWS CLI configured with credentials (IAM role or ~/.aws/credentials).
# For SFTP: replace the `aws s3 sync` command with an appropriate sftp/rsync call.

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

trap 'cron_fail "Script exited unexpectedly"' ERR
[[ -z "${CORE_CRON_RUN_ID:-}" ]] && cron_start "backup-offsite"

DATE=$(date -u '+%Y%m%d')
pattern="*_${DATE}.sql.gz"
log "=== Off-site sync for $DATE ==="

if [[ -n "${LOCAL_OFFSITE_DIR:-}" ]]; then
  mkdir -p "$LOCAL_OFFSITE_DIR"
  shopt -s nullglob
  files=("$BACKUP_DIR"/$pattern)
  [[ ${#files[@]} -eq 0 ]] && die "No dumps matching $pattern in $BACKUP_DIR — run backup-nightly first"
  for f in "${files[@]}"; do
    cp -f "$f" "$LOCAL_OFFSITE_DIR/"
    log "Copied to off-site dir: $f"
  done
else
  command -v aws >/dev/null 2>&1 \
    || die "Set LOCAL_OFFSITE_DIR in cron.env.local or install the AWS CLI for real S3 sync"
  : "${OFFSITE_BUCKET:?OFFSITE_BUCKET not set}"
  aws s3 sync "$BACKUP_DIR" "$OFFSITE_BUCKET" \
    --exclude '*' --include "$pattern" \
    || die "Off-site sync failed for $DATE"
fi

log "=== Off-site sync complete for $DATE ==="

[[ -z "${CORE_CRON_RUN_ID:-}" ]] && cron_finish
