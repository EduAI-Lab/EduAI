#!/usr/bin/env bash
# infra/cron/lib.sh
# Sourced by all EduAI cron scripts. Never executed directly.
# Production: expects /etc/eduai/cron.env (chmod 640, root:eduai-cron).
# Dev: falls back to cron.env.local in the same directory as this file
#      (copy from cron.env.local.example and fill in local values).

_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f /etc/eduai/cron.env ]]; then
  source /etc/eduai/cron.env
elif [[ -f "$_LIB_DIR/cron.env.local" ]]; then
  source "$_LIB_DIR/cron.env.local"
elif [[ -f "$_LIB_DIR/cron.env.local.example" ]]; then
  cp "$_LIB_DIR/cron.env.local.example" "$_LIB_DIR/cron.env.local"
  echo "INFO: Created $_LIB_DIR/cron.env.local from example — edit it with your local values if the defaults are wrong." >&2
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
# Usage: cron_start <job_name>   → sets CRON_RUN_ID and CRON_LEASE_OWNER
#        cron_finish             → marks the owned run SUCCESS
#        cron_fail <message>     → marks the owned run ERROR and calls die
#
# Core-triggered children receive CORE_CRON_RUN_ID and deliberately skip these
# helpers. Core owns their lease and terminal transition. A direct invocation
# (for example from an OS scheduler) creates and owns its own finite lease.

CRON_RUN_ID=""
CRON_JOB_NAME=""
CRON_LEASE_OWNER=""

# Standalone jobs do not have a Core heartbeat process. Keep their lease finite
# and configurable so a crashed process can be reaped by Core later. The Core
# setting is accepted as a fallback because deployments commonly share one
# environment; the standalone-specific name wins when both are present.
cron_standalone_lease_ms() {
  local lease_ms="${CRON_STANDALONE_LEASE_MS:-${CRON_RUN_LEASE_MS:-600000}}"
  [[ "$lease_ms" =~ ^[1-9][0-9]*$ ]] || return 1
  printf '%s\n' "$lease_ms"
}

cron_start() {
  local job=${1:?"cron_start requires a job name"}
  CRON_JOB_NAME="$job"

  local lease_ms
  if ! lease_ms=$(cron_standalone_lease_ms); then
    die "Invalid standalone cron lease duration; set CRON_STANDALONE_LEASE_MS to a positive integer number of milliseconds"
  fi

  local result
  CRON_RUN_ID=""
  CRON_LEASE_OWNER=""
  if ! result=$(
    psql_core \
      -v ON_ERROR_STOP=1 \
      -v job="$job" \
      -v lease_ms="$lease_ms" \
      -t -A -F '|' <<'SQL'
      INSERT INTO cron_job_runs (
        id, "jobName", status, "startedAt", "createdAt",
        "leaseOwner", "leaseHeartbeatAt", "leaseExpiresAt"
      )
      VALUES (
        gen_random_uuid()::text,
        :'job',
        'RUNNING'::"CronJobStatus",
        statement_timestamp(),
        statement_timestamp(),
        gen_random_uuid()::text,
        statement_timestamp(),
        statement_timestamp() + (:'lease_ms'::bigint * INTERVAL '1 millisecond')
      )
      RETURNING id, "leaseOwner";
SQL
  ); then
    die "Unable to create cron audit run for [$job]"
  fi

  IFS='|' read -r CRON_RUN_ID CRON_LEASE_OWNER <<<"$result"
  if [[ -z "$CRON_RUN_ID" || -z "$CRON_LEASE_OWNER" ]]; then
    die "Core returned an incomplete cron audit run for [$job]"
  fi
  log "[$job] run started (id=${CRON_RUN_ID:-unknown})"
}

cron_finish() {
  if [[ -z "$CRON_RUN_ID" || -z "$CRON_LEASE_OWNER" ]]; then
    log "[$CRON_JOB_NAME] run finished successfully (Core owns audit state)"
    return 0
  fi

  local updated
  if ! updated=$(
    psql_core \
      -v ON_ERROR_STOP=1 \
      -v runid="$CRON_RUN_ID" \
      -v owner="$CRON_LEASE_OWNER" \
      -t -A <<'SQL'
      UPDATE cron_job_runs
      SET status = 'SUCCESS'::"CronJobStatus",
          "finishedAt" = statement_timestamp(),
          message = 'Completed successfully',
          "exitCode" = 0,
          "leaseOwner" = NULL,
          "leaseHeartbeatAt" = NULL,
          "leaseExpiresAt" = NULL
      WHERE id = :'runid'
        AND status = 'RUNNING'::"CronJobStatus"
        AND "leaseOwner" = :'owner'
        AND "leaseExpiresAt" > statement_timestamp()
      RETURNING id
SQL
  ); then
    die "Unable to record successful completion for cron run [$CRON_RUN_ID]"
  fi
  if [[ -z "$updated" ]]; then
    die "Cron run [$CRON_RUN_ID] completion rejected: lease ownership was lost or expired"
  fi
  log "[$CRON_JOB_NAME] run finished successfully"
}

cron_fail() {
  # Callers may pass upstream response bodies. Never persist, log, or email
  # that untrusted text: it can contain API keys, bearer tokens, database
  # diagnostics, or user content. The detailed command output remains in the
  # command's own restricted logs; the shared audit channel gets one stable
  # operator-safe failure message.
  local safe_job="${CRON_JOB_NAME:-unknown}"
  safe_job="${safe_job//[^[:alnum:]_.:-]/_}"
  safe_job="${safe_job:0:128}"
  local msg="Cron job [$safe_job] failed"
  if [[ -n "$CRON_RUN_ID" && -n "$CRON_LEASE_OWNER" ]]; then
    local updated
    if ! updated=$(
      psql_core \
        -v ON_ERROR_STOP=1 \
        -v runid="$CRON_RUN_ID" \
        -v owner="$CRON_LEASE_OWNER" \
        -v msg="$msg" \
        -t -A <<'SQL'
        UPDATE cron_job_runs
        SET status = 'ERROR'::"CronJobStatus",
            "finishedAt" = statement_timestamp(),
            message = :'msg',
            "exitCode" = 1,
            "leaseOwner" = NULL,
            "leaseHeartbeatAt" = NULL,
            "leaseExpiresAt" = NULL
        WHERE id = :'runid'
          AND status = 'RUNNING'::"CronJobStatus"
          AND "leaseOwner" = :'owner'
          AND "leaseExpiresAt" > statement_timestamp()
        RETURNING id
SQL
    ); then
      log "[$CRON_JOB_NAME] could not persist ERROR status for cron run [$CRON_RUN_ID]"
    elif [[ -z "$updated" ]]; then
      log "[$CRON_JOB_NAME] ERROR status rejected: lease ownership was lost or expired"
    fi
  fi
  die "$msg"
}
