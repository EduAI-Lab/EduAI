# Cron Jobs

Operational reference for EduAI's scheduled jobs: how to read them, run them, change when they fire, and add new ones.

**Related docs**
- Data lifecycle spec (retention schedules, shell script bodies): [`docs/implementations/EduAI_CronJob_DataLifecycle_Spec.md`](implementations/EduAI_CronJob_DataLifecycle_Spec.md)
- Local dry-run testing: [`docs/implementations/server-backup-cron-local-testing.md`](implementations/server-backup-cron-local-testing.md)
- Infra scripts: [`infra/cron/README.md`](../infra/cron/README.md)

---

## Job layers

There are two distinct layers of scheduled work in EduAI:

| Layer | Where it runs | Managed by | Can trigger from admin panel? |
|---|---|---|---|
| **Infra shell scripts** | Dedicated Core cron worker | Core's `node-cron` scheduler | Yes |
| **Extension in-process jobs** | Inside the AI Tutor and Question Maker Node servers | Each extension's own scheduler | No (external) |

The admin panel at **Admin → Cron Jobs** surfaces both layers in one view. Triggering an infra job records an admin run for the dedicated worker; it is dispatched during the next reconciliation cycle under `eduai-cron`. Extension-managed jobs show an "External" badge and cannot be triggered from Core.

---

## Cron expression syntax

A cron expression has five space-separated fields:

```
┌─── minute        (0–59)
│  ┌─── hour          (0–23)
│  │  ┌─── day of month  (1–31)
│  │  │  ┌─── month        (1–12)
│  │  │  │  ┌─── day of week   (0–6, Sunday = 0)
│  │  │  │  │
M  H  D  Mo W
```

### Special characters

| Character | Meaning | Example |
|---|---|---|
| `*` | Every valid value | `* * * * *` — every minute |
| `,` | List of values | `0,30 * * * *` — at :00 and :30 each hour |
| `-` | Range | `0 9-17 * * *` — every hour 09:00–17:00 |
| `/` | Step | `*/15 * * * *` — every 15 minutes |

### Common patterns

| Expression | Meaning |
|---|---|
| `0 2 * * *` | Daily at 02:00 UTC |
| `45 2 * * *` | Daily at 02:45 UTC |
| `0 9 1 * *` | Monthly on the 1st at 09:00 UTC |
| `0 9 * * 1` | Weekly on Monday at 09:00 UTC |
| `*/30 * * * *` | Every 30 minutes |
| `0 */6 * * *` | Every 6 hours (at :00) |
| `0 4 * * 1-5` | Weekdays at 04:00 UTC |

All EduAI production jobs run in UTC (enforced by the Core scheduler via `{ timezone: "UTC" }`).

---

## Viewing job status

Go to **Admin → Cron Jobs**. The panel shows:

- **Schedule** — the cron expression and its human-readable label. A yellow "custom" badge appears when the schedule has been overridden via the admin panel.
- **Script** — the shell script name (blank for extension-managed jobs).
- **Last run** — timestamp of the most recent execution.
- **Duration** — wall time of that run.
- **Status** — `Success`, `Error`, `Running` (pulsing), `Never run`, or `External`.

The panel auto-refreshes every 3 seconds while any job shows `Running`.

Click **History** on any row to see the last 10 runs with status, duration, and output message.

---

## Modifying a schedule

### Infra shell-script jobs

Schedule changes are stored in the database and picked up by the dedicated cron
worker during its next 30-second reconciliation cycle. No web-server restart is
needed.

Click **Edit** next to any infra job's schedule to open the schedule editor. Enter a valid 5-field cron expression; the human-readable label auto-fills for common patterns (daily, weekly, monthly) and can be edited freely.

Saving the schedule updates the database. The worker applies the change during
its next 30-second reconciliation cycle, so no deployment or server restart is
needed. A yellow "custom" badge appears on the row.

To restore the original schedule, re-open the editor and click **Reset to default**.

### Extension jobs

Extension jobs do not have an Edit button. To change when they fire:

- **AI Tutor:** `apps/extensions/ai-tutor/server/src/jobs/scheduler.js`
- **Question Maker:** `apps/extensions/question-maker/app/backend/src/jobs/scheduler.js`

Update the cron expression there and redeploy the extension server.

---

## Triggering a job manually

From the admin panel, click **Run now** on any infra job. The run is recorded in `cron_job_runs` and the status refreshes live.

From the command line (as `eduai-cron`):
```bash
sudo -u eduai-cron /opt/eduai/cron/backup-nightly.sh
```

---

## Adding a new cron job

### 1. Write the shell script

Place it in `infra/cron/`. Follow the pattern of existing scripts:

```bash
#!/usr/bin/env bash
# /opt/eduai/cron/my-new-job.sh
set -euo pipefail
source /opt/eduai/cron/lib.sh

log "=== my-new-job: start ==="
# ... do work ...
log "=== my-new-job: complete ==="
```

`lib.sh` provides `log()`, `die()`, and the `psql_core` / `psql_tutor` / `psql_qm` helpers. See the spec for full details.

### 2. Register it in Core

Add an entry to `KNOWN_CRON_JOBS` in `apps/core/app/lib/db.cron-jobs.server.ts`:

```ts
{
  name: "my-new-job",          // unique key; matches jobName in cron_job_runs
  description: "What it does",
  schedule: "0 5 * * *",
  scheduleLabel: "Daily at 05:00 UTC",
  script: "my-new-job.sh",
},
```

The cron worker discovers it during the next 30-second reconciliation cycle. The
job will appear in the admin panel, can be triggered manually (and dispatched
under `eduai-cron`), and has its schedule editable via the UI.

### 3. Deploy

```bash
# Copy scripts
sudo cp infra/cron/my-new-job.sh /opt/eduai/cron/
sudo chown eduai-cron:eduai-cron /opt/eduai/cron/my-new-job.sh
sudo chmod 750 /opt/eduai/cron/my-new-job.sh

# Smoke test
sudo -u eduai-cron /opt/eduai/cron/my-new-job.sh
```

### Adding an extension in-process job

If the job runs inside an extension server (no shell script):

1. Add the job logic in the extension's scheduler.
2. Register it in `KNOWN_CRON_JOBS` with `triggerEnabled: false` and `script: ""`:

```ts
{
  name: "my-extension-job",
  description: "Runs inside the extension server",
  schedule: "0 3 * * *",
  scheduleLabel: "Daily at 03:00 UTC (extension server)",
  script: "",
  triggerEnabled: false,
},
```

---

## Checking logs

### Admin panel run history

Click **History** on any row. Shows the last 10 runs stored in `cron_job_runs` (only captures runs that go through Core's trigger mechanism or are manually started from the panel).

### Server log

All infra jobs append to `/var/log/eduai/cron.log`:
```bash
tail -100 /var/log/eduai/cron.log
```

The data lifecycle log (deletions, audit trail) is separate:
```bash
tail -100 /var/log/eduai/data-lifecycle.log
```

Log rotation keeps both files for up to 3 years. See spec Section 7 for the logrotate config.

### Database

Query run history directly:
```sql
-- Last 20 runs across all jobs
SELECT "jobName", status, "startedAt", "finishedAt", message
FROM cron_job_runs
ORDER BY "startedAt" DESC
LIMIT 20;

-- All runs for a specific job
SELECT * FROM cron_job_runs
WHERE "jobName" = 'backup-nightly'
ORDER BY "startedAt" DESC;

-- Any job still marked RUNNING (may indicate a stuck run)
SELECT * FROM cron_job_runs WHERE status = 'RUNNING';
```

---

## Current job registry

| Job | Schedule | Type | Purpose |
|---|---|---|---|
| `backup-nightly` | `0 2 * * *` (02:00 UTC) | Infra | pg_dump all three databases |
| `backup-offsite` | `45 2 * * *` (02:45 UTC) | Infra | Sync dumps to off-site storage |
| `backup-rotate` | `15 3 * * *` (03:15 UTC) | Infra | Delete local dumps past retention window |
| `cleanup-invitations` | `30 3 * * *` (03:30 UTC) | Infra | Delete revoked/expired invitations past a 30-day grace period |
| `notify-api-key-expiry` | `0 4 * * *` (04:00 UTC) | Core handler | Email users whose provider API keys expire in exactly 7 days |
| `ai-tutor-reconcile` | `0 2 * * *` (02:00 UTC) | Extension | Nullify stale Core references in AI Tutor |
| `qm-reconcile` | `0 2 * * *` (02:00 UTC) | Extension | Nullify stale Core references in Question Maker |

For data lifecycle jobs (user expiry, course deletion, etc.) see the [spec](implementations/EduAI_CronJob_DataLifecycle_Spec.md) — those scripts are defined there and are not yet registered in `KNOWN_CRON_JOBS`.
## Scheduler worker deployment

Run exactly one worker per environment with `npm run cron:worker -w edu-ai`.
The worker loads database-backed schedule overrides at startup and reconciles them every 30 seconds. Web server instances never create cron timers, so scheduled work does not depend on web traffic. Monitor the worker process and its `[cron-worker]` logs; restart it if it exits unexpectedly.
