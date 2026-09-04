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

The standalone lease contract test is:

```bash
bash infra/cron/tests/standalone-lease-contract.test.sh
```

## Installation on a non-s378 host

A host that is not managed by the s378 installer must still provide:

- the scripts and `lib.sh` in a root-controlled directory;
- an `eduai-cron` account with access only to the intended backup/log paths;
- `/etc/eduai/cron.env` owned by root and readable by that account;
- PostgreSQL client tooling or the expected database containers;
- a mail command if failure alerts are required;
- AWS credentials or an explicit local off-site destination.

The repository does not install an operating-system scheduler for these scripts.
Connect them to an approved scheduler only after confirming that the Core
in-process scheduler is not also running the same jobs.

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
