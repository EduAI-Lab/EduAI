#!/usr/bin/env bash
# infra/cron/cleanup-invitations.sh
# Hard-deletes invitations that have sat revoked or expired for more than 30
# days. Keeps the invitations table from growing unboundedly while leaving a
# grace window for an admin to still see a recently revoked/expired invite.
# Crontab: 30 3 * * *  (UTC)

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

trap 'cron_fail "Script exited unexpectedly"' ERR
[[ -z "${CORE_CRON_RUN_ID:-}" ]] && cron_start "cleanup-invitations"

log "=== Invitation cleanup: removing stale revoked/expired invitations ==="

DELETED=$(psql_core -v ON_ERROR_STOP=1 -t -A <<'SQL'
  DELETE FROM invitations
  WHERE (status = 'REVOKED' AND "updatedAt" < NOW() - INTERVAL '30 days')
     OR (status = 'PENDING' AND "expiresAt" < NOW() - INTERVAL '30 days')
  RETURNING id, status;
SQL
)

COUNT=$(echo "$DELETED" | grep -c '|' || true)
log "Invitation cleanup: deleted $COUNT stale invitation(s)"
[ -n "$DELETED" ] && echo "$DELETED" >> "$AUDIT_LOG"

log "=== Invitation cleanup complete ==="

if [[ -z "${CORE_CRON_RUN_ID:-}" ]]; then
  cron_finish
fi
