#!/usr/bin/env bash
# infra/cron/lib.sh
# Sourced by all EduAI cron scripts. Never executed directly.
# Production: expects /etc/eduai/cron.env (chmod 600, root:root).
# Dev: falls back to cron.env.local in the same directory as this file
#      (copy from cron.env.local.example and fill in local values).

_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f /etc/eduai/cron.env ]]; then
  source /etc/eduai/cron.env
elif [[ -f "$_LIB_DIR/cron.env.local" ]]; then
  source "$_LIB_DIR/cron.env.local"
else
  echo "ERROR: No cron.env found. Expected /etc/eduai/cron.env (production) or $_LIB_DIR/cron.env.local (dev)." >&2
  exit 1
fi
unset _LIB_DIR
export PGPASSWORD="$DB_PASS"

log() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" | tee -a "$AUDIT_LOG"
}

die() {
  log "ERROR: $*"
  echo "EduAI cron FAILED: $*" | mail -s 'EduAI Cron Alert' "$ALERT_EMAIL" 2>/dev/null || true
  exit 1
}

psql_core()  { psql -h "$DB_HOST" -p "$DB_PORT_CORE"  -U "$DB_USER" -d eduai           "$@"; }
psql_tutor() { psql -h "$DB_HOST" -p "$DB_PORT_TUTOR" -U "$DB_USER" -d ai-tutor        "$@"; }
psql_qm()    { psql -h "$DB_HOST" -p "$DB_PORT_QM"    -U "$DB_USER" -d question-maker  "$@"; }

# ── Cron status reporting ────────────────────────────────────────────────────
# Usage: cron_start <job_name>   → sets CRON_RUN_ID
#        cron_finish             → marks last run SUCCESS
#        cron_fail <message>     → marks last run ERROR and calls die

CRON_RUN_ID=""
CRON_JOB_NAME=""

cron_start() {
  local job=$1
  CRON_JOB_NAME="$job"
  local now
  now=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  CRON_RUN_ID=$(psql_core -t -A -c "
    INSERT INTO cron_job_runs (id, \"jobName\", status, \"startedAt\", \"createdAt\")
    VALUES (gen_random_uuid(), '$job', 'RUNNING', '$now', '$now')
    RETURNING id;
  " 2>/dev/null || true)
  log "[$job] run started (id=${CRON_RUN_ID:-unknown})"
}

cron_finish() {
  local now
  now=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  if [ -n "$CRON_RUN_ID" ]; then
    psql_core -c "
      UPDATE cron_job_runs
      SET status = 'SUCCESS', \"finishedAt\" = '$now',
          message = 'Completed successfully'
      WHERE id = '$CRON_RUN_ID';
    " 2>/dev/null || true
  fi
  log "[$CRON_JOB_NAME] run finished successfully"
}

cron_fail() {
  local msg="${1:-unknown error}"
  local now
  now=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  if [ -n "$CRON_RUN_ID" ]; then
    local escaped
    escaped="${msg//\'/\'\'}"
    psql_core -c "
      UPDATE cron_job_runs
      SET status = 'ERROR', \"finishedAt\" = '$now',
          message = '$escaped', \"exitCode\" = 1
      WHERE id = '$CRON_RUN_ID';
    " 2>/dev/null || true
  fi
  die "$msg"
}
