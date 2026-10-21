# Backup and scheduled-maintenance scripts

Last verified: 2026-08-31

This directory contains the shell jobs used for database backups, off-site copy,
retention, invitation cleanup, API-key expiry notification, and Core cron-run
auditing. It is not a system crontab. The scripts can be called by the Core
in-process scheduler or invoked directly by an approved operator.

For the s378 installation, use [`../s378/GO-LIVE.md`](../s378/GO-LIVE.md). The
s378 installer places the scripts under `/opt/eduai/cron` and configures the
dedicated `eduai-cron-worker` service. Do not separately create competing user
units or a system crontab for the same jobs.

On production, install the root-owned worker template from
`infra/production/systemd/eduai-cron-worker.service`, create
`/etc/eduai/cron.env`, and use the production helper's `install-cron-worker`,
`enable-cron-worker`, and `restart-cron-worker` actions before relying on the
worker.

## Script inventory

| Script | Responsibility |
| --- | --- |
| `backup-nightly.sh` | Dump Core, AI Tutor, and Question Maker databases |
| `backup-offsite.sh` | Copy the backup set to S3 or configured local off-site storage |
| `backup-rotate.sh` | Remove local backup data outside the retention window |
| `cleanup-invitations.sh` | Remove expired invitation data through the Core database |
| `notify-api-key-expiry.sh` | Ask the Core API to notify about expiring keys |
| `dry-run-local.sh` | Run local backup exercises without installing a service |
| `lib.sh` | Shared configuration, logging, alerts, and lease/audit handling |

Disk-usage alerts (#1869) are not a script here: `disk-usage-check` is a Core-handler
job that emails the admins through Core's mailer when a disk passes 85% or 95%. See
[`docs/CRON_JOBS.md`](../../docs/CRON_JOBS.md#disk-usage-alerts-1869).

Every production script records a lifecycle row in Core's `cron_job_runs` table.
Standalone invocation creates and owns a finite lease; the Core scheduler passes
its own run context. This prevents overlapping runs from being treated as
independent work.

## Scheduler contract

The normal scheduler is Core's in-process scheduler. Its schedule is managed from
the Core Admin → Cron Jobs panel and persisted in the database. The script
directory is supplied through `CRON_SCRIPT_DIR`. There should be no `/etc/cron.d`
entry for these jobs.

The default schedule currently documented by the application is:

| Job | Default UTC time |
| --- | ---: |
| `backup-nightly` | 02:00 |
| `backup-offsite` | 02:45 |
| `backup-rotate` | 03:15 |
| `cleanup-invitations` | 03:30 |
| `notify-api-key-expiry` | application-configured |

Treat these as defaults, not immutable infrastructure. Check the Admin panel and
the `cron_jobs` table before relying on a time window.

## Environment files

Production scripts source `/etc/eduai/cron.env`. Local development uses
`infra/cron/cron.env.local`, normally copied from
`cron.env.local.example`. The shared examples define:

- `DB_HOST`, `DB_PORT_CORE`, `DB_PORT_TUTOR`, `DB_PORT_QM`;
- `DB_USER`, `DB_PASS`, and the separate Question Maker password when required;
- optional per-database `DB_NAME_*`, `DB_USER_*`, `DB_PASS_*` and `DB_CONTAINER_*`
  (`CORE`, `TUTOR`, `QM`), which production needs because its databases differ in name,
  user and password; unset values fall back to the shared `DB_USER` / `DB_PASS` and the
  development names;
- `BACKUP_DIR`, `BACKUP_RETAIN_DAYS`, and either `OFFSITE_BUCKET` or
  `LOCAL_OFFSITE_DIR`;
- `AUDIT_LOG` and `ALERT_EMAIL`;
- `CORE_URL` and `EDUAI_API_KEY` for API-key expiry notification;
- `CRON_STANDALONE_LEASE_MS` for direct invocation.

The development database host ports are Core `54320`, AI Tutor `54321`, Question
Maker `55432`, and Redis `63790`. Production values must match the host-managed
services and must not copy local passwords or paths.

Protect the production environment file:

```bash
sudo chown root:eduai-cron /etc/eduai/cron.env
sudo chmod 0640 /etc/eduai/cron.env
```

Do not place credentials in Git, shell history, logs, S3 object names, or command
output. The scripts redact sensitive values in failure messages, but operators
should still avoid passing secrets as command-line arguments.

## Local validation

From the repository root:

```bash
cp infra/cron/cron.env.local.example infra/cron/cron.env.local
# edit only the local file with local database/test values
bash infra/cron/dry-run-local.sh all
```

The local dry-run requires the development databases or PostgreSQL client tools.
It writes to the configured local backup paths and can use
`LOCAL_OFFSITE_DIR` instead of performing an S3 copy.

The contract tests are:

```bash
bash infra/cron/tests/standalone-lease-contract.test.sh
bash infra/cron/tests/per-db-settings.test.sh
```

## Installation on a non-s378 host

A host that is not managed by the s378 installer must still provide:

- the scripts and `lib.sh` in a root-controlled directory;
- an `eduai-cron` account with access only to the intended backup/log paths;
- `/etc/eduai/cron.env` owned by root and readable by that account;
- PostgreSQL client tooling or the expected database containers;
- a mail command if failure alerts are required (see "Failure alerts" below);
- AWS credentials or an explicit local off-site destination.

The repository does not install an operating-system scheduler for these scripts.
Connect them to an approved scheduler only after confirming that the Core
in-process scheduler is not also running the same jobs.

## Failure alerts

When a script fails, `lib.sh` emails `ALERT_EMAIL` with the host's `mail`
command. That is separate from Core's own email (`SMTP_*` in the Core env), so
the host needs its own mail client. On s348 (#1874):

- `msmtp-mta` and `bsd-mailx` are installed, and `/etc/msmtprc` relays through
  `smtp.mail-relay.ubc.ca:25` with no login (STARTTLS).
- The `from` address is `noreply.eduai@ubc.ca`, the same as Core's `EMAIL_FROM`.
  Use an @ubc.ca sender rather than @eduai.ok.ubc.ca, which has no SPF/DKIM/MX
  records; UBC IT confirmed it needs no mailbox.
- `ALERT_EMAIL` in `/etc/eduai/cron.env` is the team alert list, which accepts
  mail from any @ubc.ca address. Keep the list address out of this public repo.

Test after any change: `echo test | mail -s "EduAI cron alert test" "$ALERT_EMAIL"`
should print nothing and arrive for every list member. Changing `ALERT_EMAIL`
needs no restart; scripts read `cron.env` on every run. Core's disk-usage alert
(#1869) goes through Core's mailer to the same list via `DISK_ALERT_EMAILS`.

## Backup and restore expectations

Before migrations or a release:

1. Confirm the backup destination is writable.
2. Run or inspect the latest `backup-nightly` result.
3. Confirm the off-site copy and retention jobs are succeeding.
4. Record the backup timestamp and destination in the deployment handoff.
5. Keep a tested restore procedure for each database.

A successful `pg_dump`, an S3 upload, or a green cron audit row does not prove a
restore will work. Test restoration into an isolated database and document the
owner before declaring backup readiness.
