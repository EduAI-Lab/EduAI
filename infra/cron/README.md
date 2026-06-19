# infra/cron — EduAI Server Backup Cron Jobs

Bash scripts for nightly PostgreSQL backups of all three EduAI databases.
See `docs/implementations/EduAI_CronJob_DataLifecycle_Spec.md` for the full spec.

**Local testing (Windows / WSL / macOS):** [`docs/implementations/server-backup-cron-local-testing.md`](../../docs/implementations/server-backup-cron-local-testing.md) — use `bash infra/cron/dry-run-local.sh all` from repo root.

## Scripts

| Script | UTC Schedule | Purpose |
|---|---|---|
| `backup-nightly.sh` | `0 2 * * *` | pg_dump all three databases |
| `backup-offsite.sh` | `45 2 * * *` | Push tonight's dumps to S3/SFTP |
| `backup-rotate.sh` | `15 3 * * *` | Delete local dumps > `$BACKUP_RETAIN_DAYS` days old |

## First-time deployment

```bash
# 1. Create system user
sudo useradd -r -s /bin/false eduai-cron

# 2. Copy scripts to production path
sudo mkdir -p /opt/eduai/cron
sudo cp infra/cron/lib.sh infra/cron/backup-*.sh /opt/eduai/cron/
sudo chown eduai-cron:eduai-cron /opt/eduai/cron/*.sh
sudo chmod 750 /opt/eduai/cron/*.sh

# 3. Create env file (fill in real values, never commit)
sudo mkdir -p /etc/eduai
sudo cp infra/cron/cron.env.example /etc/eduai/cron.env
sudo nano /etc/eduai/cron.env          # set DB_PASS, OFFSITE_BUCKET, ALERT_EMAIL
sudo chmod 600 /etc/eduai/cron.env
sudo chown root:root /etc/eduai/cron.env

# 4. Create log directory
sudo mkdir -p /var/log/eduai
sudo chown eduai-cron:adm /var/log/eduai
sudo chmod 750 /var/log/eduai

# 5. Install crontab and logrotate
sudo cp infra/cron/eduai.crontab /etc/cron.d/eduai
sudo chmod 644 /etc/cron.d/eduai
sudo cp infra/cron/logrotate.conf /etc/logrotate.d/eduai-cron

# 6. Dry-run the nightly backup to verify connectivity before the first scheduled run
sudo -u eduai-cron /opt/eduai/cron/backup-nightly.sh
```

## Off-site storage

`backup-offsite.sh` uses `aws s3 sync`. To use SFTP or rsync instead, replace
the `aws s3 sync` call in that script with the appropriate command — the rest
of the error handling and logging stays the same.

AWS credentials must be accessible to the `eduai-cron` user. An EC2 IAM role
is preferred over static keys; if using static keys, place them in
`/home/eduai-cron/.aws/credentials` with `chmod 600`.

## Legal hold

If a legal hold is placed on records, backup scripts are unaffected (they
dump the full database and do not perform deletion). The data lifecycle
deletion scripts (not yet in this directory) must add `AND legal_hold IS NOT TRUE`
to their WHERE clauses before a hold is active — see spec Section 8.3.
