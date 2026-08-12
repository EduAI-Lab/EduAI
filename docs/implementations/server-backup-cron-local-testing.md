# Server backup cron — local testing (Windows / WSL / macOS)

Validate `infra/cron/` backup scripts against dev Docker databases before deploying them to production (`/opt/eduai/cron`). Production scheduling is owned by `eduai-cron-worker.service`; the optional local crontab examples below are only for exercising the dry-run helper, never for production deployment.

**Related:**
- Spec: [`EduAI_CronJob_DataLifecycle_Spec.md`](./EduAI_CronJob_DataLifecycle_Spec.md)
- Production deploy: [`infra/cron/README.md`](../../infra/cron/README.md)
- Dev DB ports: [`windows-dev-database.md`](./windows-dev-database.md) (Windows port 54320 caveats)

---

## What you are testing

| Production script | Local equivalent | Validates |
|-------------------|------------------|-----------|
| `backup-nightly.sh` | `dry-run-local.sh nightly` | `pg_dump` + gzip for Core, AI Tutor, QM |
| `backup-offsite.sh` | `dry-run-local.sh offsite` | Copy tonight’s dumps to a local “off-site” folder (or real S3) |
| `backup-rotate.sh` | `dry-run-local.sh rotate` | Deletes local `.sql.gz` older than `BACKUP_RETAIN_DAYS` |

Production scripts hard-code `source /opt/eduai/cron/lib.sh`. **`dry-run-local.sh`** reimplements the same logic with a repo-local env file so you do not need `sudo` or `/etc/eduai/cron.env`. On s378, the worker runs these scripts as `eduai-cron`; verify a deployment with `systemctl status eduai-cron-worker.service` and `journalctl -u eduai-cron-worker.service -n 50 --no-pager`.

---

## Prerequisites (all platforms)

1. **Repo clone** with `infra/cron/` present.
2. **Dev databases running** from monorepo root:
   ```bash
   npm run docker:dev:db
   ```
3. **Bash** — production scripts are bash; use one of:
   - **macOS:** Terminal (bash or zsh calling bash)
   - **WSL:** Ubuntu (or similar) with Docker Desktop WSL integration
   - **Windows (native):** [Git Bash](https://gitforwindows.org/) or WSL — **not** PowerShell alone
4. **`pg_dump`** — one of:
   - PostgreSQL client tools on the host (`psql` / `pg_dump` on `PATH`), or
   - Docker only: `dry-run-local.sh` falls back to `docker exec` on `eduai-db`, `eduai-ai-tutor-db`, `eduai-question-maker-db`

### Dev DB credentials (`docker-compose.dev.yml`)

| DB | Port | Password |
|----|------|----------|
| Core (`eduai`) | 54320 | `postgres` |
| AI Tutor (`ai-tutor`) | 54321 | `postgres` |
| Question Maker (`question-maker`) | 55432 | `password` |

Local env uses `DB_PASS=postgres` and `DB_PASS_QM=password` (see `cron.env.local.example`).

---

## Quick start (macOS / WSL / Git Bash)

From **repo root** (`EduAICore/`):

```bash
# 1. Config (gitignored)
cp infra/cron/cron.env.local.example infra/cron/cron.env.local

# 2. Start DBs if needed
npm run docker:dev:db

# 3. Full dry-run: nightly → off-site copy → rotation
bash infra/cron/dry-run-local.sh all
```

**Expected:**
- Three files under `.local-backup-test/dumps/`, e.g. `eduai-core_20260618.sql.gz`
- Copies in `.local-backup-test/offsite/`
- Lines appended to `.local-backup-test/data-lifecycle.log`
- Exit code `0`

**Inspect:**

```bash
ls -lh .local-backup-test/dumps/
ls -lh .local-backup-test/offsite/
tail -20 .local-backup-test/data-lifecycle.log

# Sanity-check a dump restores (optional, destructive to a throwaway DB only)
gunzip -c .local-backup-test/dumps/eduai-core_*.sql.gz | head -30
```

---

## Platform notes

### macOS

1. Install client tools if you want host `pg_dump` (optional; Docker fallback works):
   ```bash
   brew install libpq
   brew link --force libpq   # or add $(brew --prefix libpq)/bin to PATH
   ```
2. Ensure Docker Desktop is running; `docker ps` shows the three `eduai-*-db` containers.
3. Run the quick start above.

**Optional — exercise a local dry-run schedule (macOS; not production):**

```bash
# One-shot in 2 minutes (user crontab, not system-wide)
(crontab -l 2>/dev/null; echo "$(date -u -v+2M '+%M %H %d %m *') cd $(pwd) && bash infra/cron/dry-run-local.sh nightly >> .local-backup-test/cron.log 2>&1") | crontab -
crontab -l
# Remove the line after it fires once
```

### WSL (Windows)

1. Clone repo inside WSL (`~/.../EduAICore`), not only on `C:\` — fewer path/permission issues.
2. Enable **Docker Desktop → Settings → Resources → WSL integration** for your distro.
3. From WSL:
   ```bash
   cd ~/path/to/EduAICore
   npm run docker:dev:db
   bash infra/cron/dry-run-local.sh all
   ```
4. Install `postgresql-client` if host `pg_dump` is preferred:
   ```bash
   sudo apt update && sudo apt install -y postgresql-client
   ```

**WSL local cron (optional; not production):**

```bash
sudo apt install -y cron
sudo service cron start
# Edit user crontab — same pattern as macOS, use WSL paths
crontab -e
```

### Windows (native — Git Bash)

1. Open **Git Bash** at repo root (not PowerShell).
2. Docker Desktop must expose DB ports to Windows (`localhost:54320` etc.).
3. If `pg_dump` is missing, rely on Docker fallback (containers must be running).
4. Run:
   ```bash
   bash infra/cron/dry-run-local.sh all
   ```

**Port 54320 blocked on Windows:** See [`windows-dev-database.md`](./windows-dev-database.md). If Core DB is on another host port, set `DB_PORT_CORE` in `cron.env.local` to match your `CORE_DB_PORT`.

**Windows Task Scheduler (optional):** Schedule Git Bash:
```
"C:\Program Files\Git\bin\bash.exe" -lc "cd /c/CS/EduAI/EduAICore && bash infra/cron/dry-run-local.sh nightly"
```

PowerShell cannot run the `.sh` scripts directly; always invoke `bash`.

---

## Step-by-step test matrix

### 1. Nightly backup (`nightly`)

```bash
bash infra/cron/dry-run-local.sh nightly
```

| Check | Pass criteria |
|-------|----------------|
| Files created | `eduai-core_*.sql.gz`, `ai-tutor_*.sql.gz`, `question-maker_*.sql.gz` |
| Non-empty | Each file size > 1 KB |
| Log | `All nightly backups complete` in `data-lifecycle.log` |
| QM auth | Uses `DB_PASS_QM=password`; failure here usually means wrong QM password |

**Simulate production path (optional):** After a successful dry-run, symlink or copy scripts to a fake production tree and run with a temp env:

```bash
sudo mkdir -p /opt/eduai/cron
sudo cp infra/cron/lib.sh infra/cron/backup-nightly.sh /opt/eduai/cron/
# Create /etc/eduai/cron.env from cron.env.local (adjust paths to absolute)
# DB_PASS must be single value — align QM container password to postgres for this test only
sudo bash /opt/eduai/cron/backup-nightly.sh
```

Use this only on a dev machine where creating `/opt/eduai` is acceptable.

### 2. Off-site sync (`offsite`)

Default local config copies dumps to `.local-backup-test/offsite/` (no AWS).

```bash
bash infra/cron/dry-run-local.sh offsite
ls .local-backup-test/offsite/
```

**Real S3 test (optional):** In `cron.env.local`, comment out `LOCAL_OFFSITE_DIR`, set `OFFSITE_BUCKET`, configure AWS CLI (`aws configure`), then run `offsite`. Use a dev/test bucket only.

### 3. Rotation (`rotate`)

```bash
# Create a “stale” dump (BACKUP_RETAIN_DAYS=1 in cron.env.local.example)
touch -t 202001010000 .local-backup-test/dumps/eduai-core_stale.sql.gz

bash infra/cron/dry-run-local.sh rotate
# stale file should be gone; today's dumps remain
ls .local-backup-test/dumps/
```

On **Git Bash / macOS**, `touch -t YYYYMMDDhhmm` works. On some systems use:
```bash
touch -d '2020-01-01' .local-backup-test/dumps/eduai-core_stale.sql.gz
```

### 4. Failure paths

| Scenario | How to trigger | Expected |
|----------|----------------|----------|
| DB down | `docker stop eduai-db` then `nightly` | Script exits non-zero; ERROR in log |
| Missing env | Rename `cron.env.local` | Clear error about missing file |
| No dumps before offsite | Delete dumps, run `offsite` | Error: no files matching tonight’s date |

---

## Restore smoke test (optional)

Prove a dump is usable (run against a **throwaway** local DB, not production):

```bash
# Example: Core dump → temporary database on same instance
gunzip -c .local-backup-test/dumps/eduai-core_*.sql.gz | \
  psql -h localhost -p 54320 -U postgres -d postgres -c "CREATE DATABASE eduai_restore_test;"
gunzip -c .local-backup-test/dumps/eduai-core_*.sql.gz | \
  psql -h localhost -p 54320 -U postgres -d eduai_restore_test

psql -h localhost -p 54320 -U postgres -d eduai_restore_test -c "\dt"
psql -h localhost -p 54320 -U postgres -d postgres -c "DROP DATABASE eduai_restore_test;"
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `pg_dump failed for question-maker` | Set `DB_PASS_QM=password` in `cron.env.local` |
| `pg_dump failed for eduai-core` | DB not listening — `npm run docker:dev:db`, check port 54320 (Windows: see windows-dev-database.md) |
| `container eduai-db is not running` | Start Docker; run `docker ps` |
| `Permission denied` on `.local-backup-test` | Run from repo root; check directory is writable |
| `aws s3 sync` fails | Use `LOCAL_OFFSITE_DIR` for local tests; configure AWS only when testing real off-site |
| `mail` / alert noise | Expected in production only; `die()` still logs locally; mail failure is ignored (`2>/dev/null`) |

---

## Cleanup

```bash
rm -rf .local-backup-test
rm -f infra/cron/cron.env.local
```

Both paths are gitignored.

---

## CI / automation (future)

A lightweight check could run in Linux CI:

```bash
npm run docker:dev:db
bash infra/cron/dry-run-local.sh nightly
test -f .local-backup-test/dumps/eduai-core_*.sql.gz
```

Not wired in CI today; this doc is the manual validation path for developers on Windows, WSL, and macOS.

---

## Production handoff

When local dry-runs pass:

1. Deploy scripts per [`infra/cron/README.md`](../../infra/cron/README.md)
2. Use **one** `DB_PASS` in `/etc/eduai/cron.env` (production typically uses one credential for all DBs)
3. Verify with `sudo -u eduai-cron /opt/eduai/cron/backup-nightly.sh` — scheduling is handled by the Core in-process scheduler
4. Retire per-app QM-only backup cron if the platform job covers all three databases
