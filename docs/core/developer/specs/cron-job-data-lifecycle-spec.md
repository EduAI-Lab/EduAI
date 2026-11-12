# EduAI Platform — Cron Job & Automated Data Lifecycle Specification

**Server Backups • Account Expiry Deletion • Transitory Record Purges**

University of British Columbia — COSC 499 Capstone • Summer 2026

*Derived from: EduAI Platform Data Retention & Records Management Guidelines*
*In accordance with UBC Electronic Records Management Guidelines GUI-0002 Rev1*

---

## 1. Purpose

This document specifies the automated cron job schedules, shell scripts, and operational procedures required to enforce data retention and deletion obligations across the three EduAI applications: EduAI Core, AI Tutor, and Question Maker.

Two categories of automation are defined:

- **Server backups** — scheduled PostgreSQL dumps and off-site copies that ensure recoverability within retention windows; and
- **Data lifecycle jobs** — deletion and purge scripts triggered by account expiry dates, course end dates, and retention period thresholds derived from the Data Retention & Records Management Guidelines.

> **⚠ Important:** All cron jobs that perform deletion of substantive records must write an audit log entry before executing any `DELETE` or `TRUNCATE` statement. Deletion without an audit trail violates UBC Policy #117.

---

## 2. Environment & Prerequisites

### 2.1 Target Databases

| Database | Container | Port | DB Name | User |
| --- | --- | --- | --- | --- |
| EduAI Core (pgvector) | `eduai-db` | 54320 | `eduai` | `postgres` |
| AI Tutor | `eduai-ai-tutor-db` | 54321 | `ai-tutor` | `postgres` |
| Question Maker | `eduai-question-maker-db` | 55432 | `question-maker` | `postgres` |

### 2.2 Shared Environment File

All cron scripts source a single environment file at `/etc/eduai/cron.env`. This
file must be readable only by root and the dedicated `eduai-cron` service account
(`chmod 640`, `root:eduai-cron`) and must never be committed to version control.

```bash
# /etc/eduai/cron.env
# Loaded by all EduAI cron jobs via:  source /etc/eduai/cron.env

# ── Database connections ─────────────────────────────────────────
DB_HOST=localhost
DB_PORT_CORE=54320
DB_PORT_TUTOR=54321
DB_PORT_QM=55432
DB_USER=postgres
DB_PASS=postgres          # override with vault secret in production

# ── Backup destination ───────────────────────────────────────────
BACKUP_DIR=/var/backups/eduai
BACKUP_RETAIN_DAYS=30     # rolling window kept locally
OFFSITE_BUCKET=s3://your-ubc-backup-bucket/eduai  # or sftp path

# ── Audit log ─────────────────────────────────────────────────────
AUDIT_LOG=/var/log/eduai/data-lifecycle.log

# ── Notification ─────────────────────────────────────────────────
ALERT_EMAIL=admin@eduai.local
```

### 2.3 Shared Utility Functions

All lifecycle scripts source a shared library at `/opt/eduai/cron/lib.sh` which provides logging, error handling, and `PGPASSWORD` injection.

```bash
# /opt/eduai/cron/lib.sh

source /etc/eduai/cron.env
export PGPASSWORD="$DB_PASS"

log() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*" | tee -a "$AUDIT_LOG"
}

die() {
  log "ERROR: $*"
  echo "EduAI cron FAILED: $*" | mail -s 'EduAI Cron Alert' "$ALERT_EMAIL"
  exit 1
}

psql_core()  { psql -h $DB_HOST -p $DB_PORT_CORE  -U $DB_USER -d eduai         "$@"; }
psql_tutor() { psql -h $DB_HOST -p $DB_PORT_TUTOR -U $DB_USER -d ai-tutor      "$@"; }
psql_qm()    { psql -h $DB_HOST -p $DB_PORT_QM   -U $DB_USER -d question-maker "$@"; }
```

---

## 3. Server Backup Cron Jobs

Backups serve two retention purposes: they provide recoverability during the active retention window, and they must themselves be rotated so that records are not held beyond their scheduled disposition date inside a backup that is never purged.

### 3.1 Nightly Full Database Dumps

A `pg_dump` of each database is taken nightly at 02:00 local server time. Dumps are compressed with gzip and stored under `$BACKUP_DIR` with a date-stamped filename.

```bash
#!/usr/bin/env bash
# /opt/eduai/cron/backup-nightly.sh
# Runs: 02:00 daily  (see Section 6 crontab)

set -euo pipefail
source /opt/eduai/cron/lib.sh

DATE=$(date -u '+%Y%m%d')
mkdir -p "$BACKUP_DIR"

backup_db() {
  local label=$1 port=$2 dbname=$3
  local outfile="$BACKUP_DIR/${label}_${DATE}.sql.gz"
  log "Starting backup: $label -> $outfile"
  pg_dump -h $DB_HOST -p $port -U $DB_USER $dbname | gzip > "$outfile" \
    || die "pg_dump failed for $label"
  log "Backup complete: $outfile ($(du -sh $outfile | cut -f1))"
}

backup_db eduai-core      $DB_PORT_CORE  eduai
backup_db ai-tutor        $DB_PORT_TUTOR ai-tutor
backup_db question-maker  $DB_PORT_QM    question-maker

log "All nightly backups complete for $DATE"
```

### 3.2 Off-site Sync

After the nightly dump completes, a sync job pushes new dumps to the configured off-site destination (S3 bucket or SFTP). Only the current night's dump is pushed; the local rolling window is managed separately.

```bash
#!/usr/bin/env bash
# /opt/eduai/cron/backup-offsite.sh
# Runs: 02:45 daily  (after backup-nightly.sh has finished)

set -euo pipefail
source /opt/eduai/cron/lib.sh

DATE=$(date -u '+%Y%m%d')
log "Starting off-site sync for $DATE"

# Example: AWS S3.  Replace with your UBC-approved storage target.
aws s3 sync "$BACKUP_DIR" "$OFFSITE_BUCKET" \
  --exclude '*' --include "*_${DATE}.sql.gz" \
  || die "Off-site sync failed"

log "Off-site sync complete"
```

### 3.3 Local Backup Rotation

Local dumps older than `$BACKUP_RETAIN_DAYS` (default: 30 days) are deleted nightly. This prevents the local disk from becoming an unmanaged long-term record store. Off-site backups follow a separate retention schedule agreed with UBC IT.

```bash
#!/usr/bin/env bash
# /opt/eduai/cron/backup-rotate.sh
# Runs: 03:15 daily

set -euo pipefail
source /opt/eduai/cron/lib.sh

log "Rotating local backups older than $BACKUP_RETAIN_DAYS days"

find "$BACKUP_DIR" -name '*.sql.gz' \
  -mtime +$BACKUP_RETAIN_DAYS -type f \
  -print -delete \
  | while read f; do log "Deleted local backup: $f"; done

log "Local backup rotation complete"
```

---

## 4. Account Expiry & Data Deletion Jobs

The Data Retention Guidelines specify that substantive records are retained for the duration of an account or course, plus a grace period after expiry. The jobs in this section are triggered by the `account_expires_at` or `course_ends_at` date columns that must be present on the relevant tables.

> **Schema requirement:** Every table subject to account-based or course-based retention must carry an `expires_at` or `ends_at` timestamp column, and a `deleted_at` soft-delete column. Hard deletes are only performed after the retention grace period has elapsed.

### 4.1 Required Schema Columns

The following columns must be present before the deletion jobs will function correctly. Add these to your Prisma schemas if they do not already exist.

| Table (App) | Required Column | Purpose |
| --- | --- | --- |
| `user` (Core) | `account_expires_at TIMESTAMPTZ` | Marks when the UBC account is deactivated |
| `user` (Core) | `deleted_at TIMESTAMPTZ` | Soft-delete; hard delete runs after grace period |
| `CourseOffering` (AI Tutor) | `ends_at TIMESTAMPTZ` | Course end date; basis for transcript retention |
| `CourseOffering` (AI Tutor) | `deleted_at TIMESTAMPTZ` | Soft-delete |
| `Session` (AI Tutor) | `ended_at TIMESTAMPTZ` | Session end; transitory outputs purged immediately |
| `canvas_api_key` (Question Maker) | `created_at TIMESTAMPTZ` | Used to compute account+1yr deletion window |
| `question` (Question Maker) | `published_at TIMESTAMPTZ` | Null = draft; non-null = substantive record |
| `assessment_result` (QM) | `submitted_at TIMESTAMPTZ` | Basis for enrolment+5yr retention |

### 4.2 EduAI Core — User Account Expiry Deletion

Retention: account duration + 2 years (substantive), 1 year (session logs). This job runs nightly and hard-deletes user records and their associated authentication logs after the respective grace periods.

```bash
#!/usr/bin/env bash
# /opt/eduai/cron/delete-expired-users.sh
# Runs: 04:00 daily

set -euo pipefail
source /opt/eduai/cron/lib.sh

log "=== Core: expired user deletion run ==="

# ── Step 1: Soft-delete users whose account_expires_at has passed ──
# (They may still have records in grace period — do not hard-delete yet.)
psql_core -v ON_ERROR_STOP=1 <<'SQL'
  UPDATE "user"
  SET deleted_at = NOW()
  WHERE account_expires_at < NOW()
    AND deleted_at IS NULL;
SQL
log "Core: soft-deleted newly expired users"

# ── Step 2: Hard-delete users soft-deleted more than 2 years ago ──
# Grace period = 2 years (account + 2 years from retention schedule)
DELETED=$(psql_core -v ON_ERROR_STOP=1 -t -A <<'SQL'
  DELETE FROM "user"
  WHERE deleted_at < NOW() - INTERVAL '2 years'
  RETURNING id, email;
SQL
)

COUNT=$(echo "$DELETED" | grep -c '|' || true)
log "Core: hard-deleted $COUNT user records past 2-year grace period"
[ -n "$DELETED" ] && echo "$DELETED" >> "$AUDIT_LOG"

# ── Step 3: Purge session/auth logs older than 1 year ─────────────
psql_core -v ON_ERROR_STOP=1 <<'SQL'
  DELETE FROM session_log
  WHERE created_at < NOW() - INTERVAL '1 year';
SQL
log "Core: purged session logs older than 1 year"

# ── Step 4: Purge pgvector embeddings for deleted courses ──────────
# Course embeddings: duration of course + 1 year
# Assumes course_embedding table has course_id FK and course has ends_at.
psql_core -v ON_ERROR_STOP=1 <<'SQL'
  DELETE FROM course_embedding
  WHERE course_id IN (
    SELECT id FROM course
    WHERE ends_at < NOW() - INTERVAL '1 year'
  );
SQL
log "Core: purged embeddings for courses ended > 1 year ago"

log "=== Core: user deletion run complete ==="
```

### 4.3 EduAI Core — Bug Report & API Key Log Purge

Retention: bug reports 2 years after resolution; `EDUAI_API_KEY` rotation log 3 years.

```bash
#!/usr/bin/env bash
# /opt/eduai/cron/delete-core-logs.sh
# Runs: 04:15 daily

set -euo pipefail
source /opt/eduai/cron/lib.sh

log "=== Core: log purge run ==="

# Bug reports resolved more than 2 years ago
psql_core -v ON_ERROR_STOP=1 <<'SQL'
  DELETE FROM bug_report
  WHERE resolved_at IS NOT NULL
    AND resolved_at < NOW() - INTERVAL '2 years';
SQL
log "Core: purged resolved bug reports older than 2 years"

# API key rotation log older than 3 years
psql_core -v ON_ERROR_STOP=1 <<'SQL'
  DELETE FROM api_key_rotation_log
  WHERE rotated_at < NOW() - INTERVAL '3 years';
SQL
log "Core: purged API key rotation logs older than 3 years"

log "=== Core: log purge complete ==="
```

### 4.4 AI Tutor — Course & Session Deletion

Retention: CourseOffering hierarchy (course + 3 years), student session transcripts (enrolment end + 2 years), role assignments (enrolment end + 2 years), supervisor review outcomes (course end + 1 year). Transitory intermediate agent outputs are purged as soon as a session ends.

```bash
#!/usr/bin/env bash
# /opt/eduai/cron/delete-tutor-records.sh
# Runs: 04:30 daily

set -euo pipefail
source /opt/eduai/cron/lib.sh

log "=== AI Tutor: data lifecycle run ==="

# ── Transitory: intermediate agent outputs (purge on session end) ──
psql_tutor -v ON_ERROR_STOP=1 <<'SQL'
  DELETE FROM agent_intermediate_output
  WHERE session_id IN (
    SELECT id FROM session WHERE ended_at IS NOT NULL
  );
SQL
log "AI Tutor: purged intermediate agent outputs for ended sessions"

# ── Supervisor review outcomes: course end + 1 year ───────────────
psql_tutor -v ON_ERROR_STOP=1 <<'SQL'
  DELETE FROM supervisor_review_outcome
  WHERE course_offering_id IN (
    SELECT id FROM course_offering
    WHERE ends_at < NOW() - INTERVAL '1 year'
  );
SQL
log "AI Tutor: purged supervisor outcomes for courses ended > 1 year ago"

# ── Session transcripts: enrolment end + 2 years ─────────────────
# enrolment ends when course ends; use course ends_at as proxy.
psql_tutor -v ON_ERROR_STOP=1 <<'SQL'
  DELETE FROM session_transcript
  WHERE session_id IN (
    SELECT s.id FROM session s
    JOIN enrolment e ON e.id = s.enrolment_id
    JOIN course_offering co ON co.id = e.course_offering_id
    WHERE co.ends_at < NOW() - INTERVAL '2 years'
  );
SQL
log "AI Tutor: purged session transcripts for enrolments ended > 2 years ago"

# ── Role assignment records: enrolment end + 2 years ─────────────
psql_tutor -v ON_ERROR_STOP=1 <<'SQL'
  DELETE FROM role_assignment
  WHERE enrolment_id IN (
    SELECT e.id FROM enrolment e
    JOIN course_offering co ON co.id = e.course_offering_id
    WHERE co.ends_at < NOW() - INTERVAL '2 years'
  );
SQL
log "AI Tutor: purged role assignments for enrolments ended > 2 years ago"

# ── CourseOffering hierarchy: course end + 3 years ───────────────
# Delete in dependency order: Activity → Lesson → Module → CourseOffering
psql_tutor -v ON_ERROR_STOP=1 <<'SQL'
  DELETE FROM activity
  WHERE lesson_id IN (
    SELECT l.id FROM lesson l
    JOIN module m ON m.id = l.module_id
    JOIN course_offering co ON co.id = m.course_offering_id
    WHERE co.ends_at < NOW() - INTERVAL '3 years'
  );

  DELETE FROM lesson
  WHERE module_id IN (
    SELECT m.id FROM module m
    JOIN course_offering co ON co.id = m.course_offering_id
    WHERE co.ends_at < NOW() - INTERVAL '3 years'
  );

  DELETE FROM module
  WHERE course_offering_id IN (
    SELECT id FROM course_offering
    WHERE ends_at < NOW() - INTERVAL '3 years'
  );

  DELETE FROM course_offering
  WHERE ends_at < NOW() - INTERVAL '3 years';
SQL
log "AI Tutor: purged course hierarchy for courses ended > 3 years ago"

log "=== AI Tutor: data lifecycle run complete ==="
```

### 4.5 Question Maker — Assessment, Question Bank & Canvas Key Deletion

Retention: published questions (course end + 5 years), assessment results (enrolment end + 5 years), Canvas import/export audit logs (3 years absolute), per-user Canvas API keys (account expiry + 1 year), draft questions (on demand / when superseded), raw OCR artefacts (once question authored).

```bash
#!/usr/bin/env bash
# /opt/eduai/cron/delete-qm-records.sh
# Runs: 04:45 daily

set -euo pipefail
source /opt/eduai/cron/lib.sh

log "=== Question Maker: data lifecycle run ==="

# ── Transitory: raw OCR artefacts (once question has been authored) ─
psql_qm -v ON_ERROR_STOP=1 <<'SQL'
  DELETE FROM ocr_artefact
  WHERE question_id IS NOT NULL;
SQL
log "QM: purged OCR artefacts linked to authored questions"

# ── Transitory: draft questions older than 90 days with no activity ─
# (unpublished questions with no update in 90 days are considered abandoned)
psql_qm -v ON_ERROR_STOP=1 <<'SQL'
  DELETE FROM question
  WHERE published_at IS NULL
    AND updated_at < NOW() - INTERVAL '90 days';
SQL
log "QM: purged abandoned draft questions (>90 days, unpublished)"

# ── Per-user Canvas API keys: account expiry + 1 year ────────────
# canvas_api_key links to user; user has account_expires_at in Core DB.
# Here we assume a local user_account_expires_at column is synced from Core.
psql_qm -v ON_ERROR_STOP=1 <<'SQL'
  UPDATE canvas_api_key
  SET key_value = NULL,           -- overwrite key before deletion
      deleted_at = NOW()
  WHERE user_account_expires_at < NOW() - INTERVAL '1 year'
    AND deleted_at IS NULL;
SQL
log "QM: soft-deleted and nulled Canvas API keys past account+1yr window"

psql_qm -v ON_ERROR_STOP=1 <<'SQL'
  DELETE FROM canvas_api_key
  WHERE deleted_at < NOW() - INTERVAL '1 year';
SQL
log "QM: hard-deleted Canvas API key records past retention window"

# ── Canvas audit logs: 3 years absolute ──────────────────────────
psql_qm -v ON_ERROR_STOP=1 <<'SQL'
  DELETE FROM canvas_audit_log
  WHERE created_at < NOW() - INTERVAL '3 years';
SQL
log "QM: purged Canvas audit logs older than 3 years"

# ── Assessment results: enrolment end + 5 years ──────────────────
psql_qm -v ON_ERROR_STOP=1 <<'SQL'
  DELETE FROM assessment_result
  WHERE course_ends_at < NOW() - INTERVAL '5 years';
SQL
log "QM: purged assessment results for courses ended > 5 years ago"

# ── Published question bank entries: course end + 5 years ─────────
psql_qm -v ON_ERROR_STOP=1 <<'SQL'
  DELETE FROM question
  WHERE published_at IS NOT NULL
    AND course_ends_at < NOW() - INTERVAL '5 years';
SQL
log "QM: purged published questions for courses ended > 5 years ago"

log "=== Question Maker: data lifecycle run complete ==="
```

---

## 5. EDUAI_API_KEY Rotation & Log Maintenance

The shared `EDUAI_API_KEY` is used for server-to-server calls between Core, AI Tutor, and Question Maker. The rotation log must be retained for 3 years. This job reminds administrators when a rotation is due and verifies that the log is being written correctly.

```bash
#!/usr/bin/env bash
# /opt/eduai/cron/check-api-key-rotation.sh
# Runs: 09:00 on the first day of each month

set -euo pipefail
source /opt/eduai/cron/lib.sh

log "=== API key rotation check ==="

# Query when the key was last rotated
LAST_ROTATED=$(psql_core -t -A <<'SQL'
  SELECT rotated_at FROM api_key_rotation_log
  ORDER BY rotated_at DESC LIMIT 1;
SQL
)

if [ -z "$LAST_ROTATED" ]; then
  die "No API key rotation record found. Rotate EDUAI_API_KEY immediately."
fi

DAYS_SINCE=$(psql_core -t -A -c "SELECT EXTRACT(DAY FROM NOW() - '$LAST_ROTATED'::timestamptz)::int")
log "EDUAI_API_KEY last rotated $DAYS_SINCE days ago ($LAST_ROTATED)"

if [ "$DAYS_SINCE" -gt 90 ]; then
  log "WARNING: API key has not been rotated in > 90 days. Action required."
  echo "EDUAI_API_KEY last rotated $DAYS_SINCE days ago. Please rotate." \
    | mail -s '[EduAI] API Key Rotation Due' "$ALERT_EMAIL"
fi

log "=== API key rotation check complete ==="
```

---

## 6. Legacy Crontab Reference (Superseded)

The schedule below is retained as a historical reference. Do **not** install it
with `crontab -e` or `/etc/cron.d/eduai`: the dedicated
`eduai-cron-worker.service` now owns scheduling and reconciles these jobs from
the database. All times shown remain UTC.

```cron
# /etc/cron.d/eduai
# EduAI Platform — automated backup and data lifecycle jobs
# All times UTC.  Scripts source /opt/eduai/cron/lib.sh

SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# ── Nightly backups ──────────────────────────────────────────────
0  2  * * *   eduai-cron  /opt/eduai/cron/backup-nightly.sh  >> /var/log/eduai/cron.log 2>&1
45 2  * * *   eduai-cron  /opt/eduai/cron/backup-offsite.sh  >> /var/log/eduai/cron.log 2>&1
15 3  * * *   eduai-cron  /opt/eduai/cron/backup-rotate.sh   >> /var/log/eduai/cron.log 2>&1

# ── Core: user expiry + log purges ───────────────────────────────
0  4  * * *   eduai-cron  /opt/eduai/cron/delete-expired-users.sh  >> /var/log/eduai/cron.log 2>&1
15 4  * * *   eduai-cron  /opt/eduai/cron/delete-core-logs.sh      >> /var/log/eduai/cron.log 2>&1

# ── AI Tutor: course & session lifecycle ─────────────────────────
30 4  * * *   eduai-cron  /opt/eduai/cron/delete-tutor-records.sh  >> /var/log/eduai/cron.log 2>&1

# ── Question Maker: assessments, questions, Canvas keys ───────────
45 4  * * *   eduai-cron  /opt/eduai/cron/delete-qm-records.sh     >> /var/log/eduai/cron.log 2>&1

# ── Monthly: API key rotation reminder ───────────────────────────
0  9  1 * *   eduai-cron  /opt/eduai/cron/check-api-key-rotation.sh >> /var/log/eduai/cron.log 2>&1
```

### 6.1 Job Schedule Summary

| UTC Time | Script | Frequency | Purpose |
| --- | --- | --- | --- |
| 02:00 | `backup-nightly.sh` | Daily | Full pg_dump of all three databases |
| 02:45 | `backup-offsite.sh` | Daily | Push tonight's dumps to off-site storage |
| 03:15 | `backup-rotate.sh` | Daily | Remove local dumps older than 30 days |
| 04:00 | `delete-expired-users.sh` | Daily | Core: user account + auth log + embedding expiry |
| 04:15 | `delete-core-logs.sh` | Daily | Core: bug reports + API key rotation log purge |
| 04:30 | `delete-tutor-records.sh` | Daily | AI Tutor: course hierarchy, transcripts, roles, agent outputs |
| 04:45 | `delete-qm-records.sh` | Daily | QM: questions, assessments, Canvas keys, audit logs, OCR |
| 09:00 (1st) | `check-api-key-rotation.sh` | Monthly | Alert if EDUAI_API_KEY not rotated in >90 days |

---

## 7. Audit Log & Monitoring

Every deletion event is appended to `$AUDIT_LOG` (`/var/log/eduai/data-lifecycle.log`). This log is itself a substantive record and must be retained for 3 years to satisfy UBC Policy #117's requirement that destruction took place in the "ordinary course of business" (Evidence Act [RSBC 1996], Chapter 124).

### 7.1 Log Format

```
[2026-08-01T04:00:12Z] === Core: expired user deletion run ===
[2026-08-01T04:00:13Z] Core: soft-deleted newly expired users
[2026-08-01T04:00:14Z] Core: hard-deleted 3 user records past 2-year grace period
[2026-08-01T04:00:14Z] u001|alice@ubc.ca
[2026-08-01T04:00:14Z] u002|bob@ubc.ca
[2026-08-01T04:00:14Z] u003|charlie@ubc.ca
[2026-08-01T04:00:15Z] Core: purged session logs older than 1 year
[2026-08-01T04:00:16Z] === Core: user deletion run complete ===
```

### 7.2 Log Rotation

```
# /etc/logrotate.d/eduai-cron
/var/log/eduai/data-lifecycle.log {
    daily
    rotate 1095      # keep 3 years of daily logs (365 * 3)
    compress
    delaycompress
    missingok
    notifempty
    create 640 eduai-cron adm
}
```

> The 3-year logrotate retention window aligns with the `EDUAI_API_KEY` rotation log retention period, the longest fixed-period record class in the retention schedule.

---

## 8. Operational Procedures

### 8.1 Deploying the Cron Scripts

1. Create the system user:
   ```bash
   useradd -r -s /bin/false eduai-cron
   ```
2. Copy scripts to `/opt/eduai/cron/` and set permissions:
   ```bash
   chown eduai-cron:eduai-cron /opt/eduai/cron/*.sh && chmod 750 /opt/eduai/cron/*.sh
   ```
3. Create and populate `/etc/eduai/cron.env` with production values. Set permissions:
   ```bash
   chmod 640 /etc/eduai/cron.env && chown root:eduai-cron /etc/eduai/cron.env
   ```
4. Do not install a system crontab for these jobs. Install and enable
   `eduai-cron-worker.service` with `infra/s378/go-live-systemd-install.sh`;
   the dedicated Core worker is the scheduler and runs the scripts from
   `/opt/eduai/cron` using `CRON_SCRIPT_DIR=/opt/eduai/cron`.
5. Create the worker-owned directories:
   ```bash
   install -d -m 0750 -o eduai-cron -g eduai-cron /var/backups/eduai
   install -d -m 0750 -o eduai-cron -g adm /var/log/eduai
   ```
6. Install `/etc/logrotate.d/eduai-cron` (see Section 7.2).
7. Perform a dry run of each deletion script using a test database before enabling in production.

### 8.2 Manual Disposition (Out-of-Schedule)

If a student withdrawal, legal hold release, or administrative request requires deletion outside the automated schedule, the Unit Recordkeeper must:

- Document the reason for out-of-schedule deletion in the audit log before executing;
- Run the affected script manually as `eduai-cron` after verifying the grace period has elapsed;
- Notify the UBC Records Management Office if the disposal involves more than 100 records or any record class not covered by these scripts.

### 8.3 Legal Holds

If a legal hold is placed on records that would otherwise be deleted by a scheduled job, those records must be excluded from deletion until the hold is lifted. Implement holds by setting a `legal_hold = true` flag on the affected rows. All deletion scripts must be updated to add `AND legal_hold IS NOT TRUE` to their `WHERE` clauses before a hold is active.

> **⚠ Warning:** Deleting records under a legal hold exposes the University to serious legal liability. Contact UBC Legal Counsel and the Records Management Office immediately upon notice of any legal hold.

---

## 9. Retention Schedule Reference

Quick reference derived from the Data Retention & Records Management Guidelines. All periods are minimums.

| App | Record Class | Delete Trigger | Grace Period | Script |
| --- | --- | --- | --- | --- |
| Core | User account & role records | `account_expires_at` | + 2 years | `delete-expired-users.sh` |
| Core | Session / auth logs | `created_at` | 1 year | `delete-expired-users.sh` |
| Core | Course embeddings (pgvector) | `course.ends_at` | + 1 year | `delete-expired-users.sh` |
| Core | AI provider routing config | `superseded_at` | + 2 years | Manual |
| Core | EDUAI_API_KEY rotation log | `rotated_at` | 3 years | `delete-core-logs.sh` |
| Core | Bug reports | `resolved_at` | + 2 years | `delete-core-logs.sh` |
| Tutor | CourseOffering hierarchy | `course_offering.ends_at` | + 3 years | `delete-tutor-records.sh` |
| Tutor | Session transcripts | `course_offering.ends_at` | + 2 years | `delete-tutor-records.sh` |
| Tutor | Role assignments | `course_offering.ends_at` | + 2 years | `delete-tutor-records.sh` |
| Tutor | Supervisor review outcomes | `course_offering.ends_at` | + 1 year | `delete-tutor-records.sh` |
| Tutor | Intermediate agent outputs | `session.ended_at` | Immediate | `delete-tutor-records.sh` |
| QM | Published question bank entries | `course_ends_at` | + 5 years | `delete-qm-records.sh` |
| QM | Assessment results | `course_ends_at` | + 5 years | `delete-qm-records.sh` |
| QM | Canvas audit logs | `created_at` | 3 years | `delete-qm-records.sh` |
| QM | Per-user Canvas API keys | `user_account_expires_at` | + 1 year | `delete-qm-records.sh` |
| QM | Draft questions | `updated_at` | 90 days | `delete-qm-records.sh` |
| QM | Raw OCR artefacts | `question_id IS NOT NULL` | Immediate | `delete-qm-records.sh` |

---

## 10. References

- EduAI Platform Data Retention & Records Management Guidelines (this project, derived document).
- UBC Electronic Records Management Guidelines, GUI-0002 Rev1. University Archives, Records Management Office.
- UBC University Policy #117 — Records Management.
- Evidence Act [RSBC 1996], Chapter 124.
- PostgreSQL pg_dump documentation: <https://www.postgresql.org/docs/current/app-pgdump.html>
- EduAI Monorepo README.md — database container names, ports, credentials.

---

*For records management queries: alan.doyle@ubc.ca • 604 827 3952 • Irving K. Barber Learning Centre, 1961 East Mall, Vancouver, BC V6T 1Z1*

*Confidential — Internal Use Only*
