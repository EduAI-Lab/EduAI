#!/usr/bin/env bash
# infra/cron/lib.sh
# Sourced by all EduAI cron scripts. Never executed directly.
# Expects /etc/eduai/cron.env to exist and be readable by the running user.

source /etc/eduai/cron.env
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
