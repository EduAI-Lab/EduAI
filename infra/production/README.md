# Production deployment

Last verified: 2026-09-02

This directory describes the production release contract for `s348.ok.ubc.ca`.
The production host is separate from shared development and uses a release
symlink, host-managed PostgreSQL/Redis, systemd, and Apache. The checklist is the
preflight companion; this file is the deployment procedure and architecture index.

## Production layout

The live release layout is:

```text
/srv/www/eduai-production/releases/<release-id>
/srv/www/eduai-production/current -> /srv/www/eduai-production/releases/<release-id>
```

The supported application units are:

| Unit | Component | Expected port |
| --- | --- | ---: |
| `eduai-core` | Core web application | `127.0.0.1:3000` |
| `eduai-aitutor-server` | AI Tutor API | `127.0.0.1:4000` |
| `eduai-qm-backend` | Question Maker backend | `0.0.0.0:8000` in the current deployment |
| `eduai-cron-worker` | Core scheduled-maintenance worker | none |

Apache terminates public HTTPS and proxies or serves the configured vhosts. The
production database and Redis are normally host-managed on `127.0.0.1:5432` and
`127.0.0.1:6379`. The production queue is currently disabled; enabling it requires
an explicit configuration and operational review.

The public hostnames are:

- Core: `https://my.eduai.ok.ubc.ca`
- AI Tutor: `https://aitutor.eduai.ok.ubc.ca`
- Question Maker: `https://questionmaker.eduai.ok.ubc.ca`

## Verified host snapshot

The 2026-08-31 audit found the current symlink resolving to release
`ec9036dda` (short commit `ec9036d` on `main`). Core, AI Tutor, and Question
Maker units were enabled on the host; Apache2 and Docker were active, with the
expected PostgreSQL and Redis listeners on ports 5432 and 6379. Re-run the
preflight and health checks before treating any later release as ready.

## What the repository currently manages

The repository includes production templates and a restricted helper for Core,
AI Tutor, Question Maker, and the Core cron worker:

- `infra/production/core.env.example`
- `infra/production/ai-tutor.env.example`
- `infra/production/systemd/`
- `infra/production/apache/`
- `infra/production/admin-helper.sh`
- `infra/production/preflight.sh`
- `infra/cron/`

The current `eduai-production-admin` allow-list manages Core, AI Tutor, Question
Maker's narrowly scoped install/enable/restart actions, Redis, release
activation, Apache reload, and the cron worker. It does not provide a general
Question Maker provisioning shell or a `provision-qm` action. Question Maker's
application deployment documentation remains authoritative for its database and
build procedure:
[`apps/extensions/question-maker/docs/deployment/README.md`](../../apps/extensions/question-maker/docs/deployment/README.md).

The old PM2-oriented application scripts are not the production runbook. Do not
use `apps/core/deploy.sh` or `apps/extensions/ai-tutor/deploy.sh` against the
release symlink.

## Read-only preflight

Run the repository preflight on the production host before changing privileged
configuration:

```bash
cd /srv/www/eduai-production/current
bash infra/production/preflight.sh
```

Also confirm:

```bash
readlink -f /srv/www/eduai-production/current
git -C /srv/www/eduai-production/current log -1 --oneline
systemctl --no-pager --full status eduai-core eduai-aitutor-server eduai-qm-backend
systemctl --no-pager --full status apache2 docker
ss -lntp
```

Do not print environment files while inspecting them. Verify the presence,
ownership, and permissions of `/etc/eduai/eduai-core.env` and the AI Tutor
environment files without exposing their values.

## Application cron worker

The Admin → Cron Jobs page is backed by the dedicated
`eduai-cron-worker.service`; it is not driven by the web process and does not
use a user crontab. The worker reads Core's database environment, dispatches
allow-listed jobs, and runs shell jobs as the unprivileged `eduai-cron` user.
`Restart=always` keeps the worker itself running, while the application services
retain their own systemd restart policies.

Before enabling it on production, create `/etc/eduai/cron.env`, create the
`eduai-cron` user and its backup/log directories, and install the root-owned
worker template through [`SUDOERS_SETUP.md`](./SUDOERS_SETUP.md). Then run:

```bash
sudo -n /usr/local/sbin/eduai-production-admin install-cron-worker
sudo -n /usr/local/sbin/eduai-production-admin enable-cron-worker
sudo -n /usr/local/sbin/eduai-production-admin restart-cron-worker
```

Review stale `RUNNING` records in Admin → Cron Jobs before restarting the worker;
it dispatches pending admin-triggered runs when it starts.

## Provisioning prerequisites

Complete [`PROVISIONING_CHECKLIST.md`](./PROVISIONING_CHECKLIST.md) before the
first release or any host rebuild. It covers:

- service account and release-directory ownership;
- native PostgreSQL and optional Redis;
- root-owned environment files and API-key handling;
- Prisma client generation and migration preflight;
- Apache modules, certificates, and vhosts;
- approved inference endpoints and model IDs;
- queue-disabled behavior;
- backup and restore readiness.

The application must be able to generate its Prisma clients from the release
before a service is enabled. A successful `npm ci` alone is not proof that every
workspace client required by systemd exists.

## Release procedure

Use a new release directory for every production change:

1. Create or obtain the reviewed release checkout under
   `/srv/www/eduai-production/releases/<release-id>`.
2. Confirm the intended branch/commit and keep the release checkout clean.
3. Install dependencies from the repository root with `npm ci`.
4. Generate the Prisma clients using the package scripts used by the release.
5. Run the Core migration preflight and deploy migrations; run the corresponding
   AI Tutor and Question Maker migrations when their release requires them.
6. Run only the approved reference/extension seed steps. Do not use fixture or
   performance seeds as a normal production release step.
7. Build the Core and extension browser assets.
8. Install or update root-owned environment, unit, and Apache templates through the
   restricted helper where applicable.
9. Activate the reviewed release with the helper:
   ```bash
   sudo -n /usr/local/sbin/eduai-production-admin activate-release <release-id>
   ```
10. Reload systemd/Apache as needed, enable the intended units, and restart only
    the components included in the release.
11. Run the local and public health checks below and record the release ID,
    commit, timestamp, and result.

The exact package scripts can change with the code. Read the package manifests and
the deployment helper in the release you are deploying instead of copying an old
command sequence.

### Frontend routing environment (important)

AI Tutor and Question Maker are static browser frontends. Their public `VITE_*`
URLs are compiled into the bundles at build time; they are not read from the
server environment when Apache serves the files. If the production env files are
not loaded before the build, the bundles can fall back to localhost URLs even
though the backend services and Apache vhosts are configured correctly.

For every production release that changes either frontend, load the reviewed
public-only env file immediately before its build:

```bash
cd /srv/www/eduai-production/releases/<release-id>

set -a
. infra/production/ai-tutor-frontend.env
set +a
npm run build --workspace ai-tutor

set -a
. infra/production/question-maker-frontend.env
set +a
npm run build --workspace question-maker-frontend
```

Then activate the release and reload Apache:

```bash
sudo -n /usr/local/sbin/eduai-production-admin activate-release <release-id>
sudo systemctl reload apache2
```

Before declaring the release live, check the built assets for accidental local
URLs and confirm the public hosts respond:

```bash
cd /srv/www/eduai-production/current
rg -n 'localhost:(3000|3001|4000|5173)' \
  apps/extensions/ai-tutor/build/client \
  apps/extensions/question-maker/app/frontend/dist
curl -fsSI https://aitutor.eduai.ok.ubc.ca/
curl -fsSI https://questionmaker.eduai.ok.ubc.ca/
```

The env files above contain routing values intended for the browser. Never place
API keys, database credentials, or other secrets in a `VITE_*` variable or in a
frontend bundle.

## Health checks

Use the service-specific paths:

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:4000/api/health
curl -fsS http://127.0.0.1:8000/healthz
curl -fsSI https://my.eduai.ok.ubc.ca/
curl -fsSI https://aitutor.eduai.ok.ubc.ca/
curl -fsSI https://questionmaker.eduai.ok.ubc.ca/
```

Core and AI Tutor expose `/api/health`. The Question Maker backend exposes
`/healthz`; `/api/health` is not its health route. Treat a health response as
reachability evidence only. Also verify the active unit journal, database
connectivity, migrations, browser asset markers, and approved inference model IDs.

## Inference configuration

Production should use only endpoints that pass the authenticated port-8001 edge
check and have an operational owner. The current fleet model IDs are:

- small: `qwen3.5-2b-instruct`;
- large: `qwen3.5-9b-instruct` where installed;
- Assist Auto: `qwen3.8-27b-instruct` on CMPS02.

CMPS02 intentionally does not expose the standard 9B model; its 27B model is a
separate Assist Auto capability. CMPS03 has the standard small/large pair and
may be used in production after the authenticated edge check succeeds on the
production host. See
[`../cmps01/README.md`](../cmps01/README.md) for the CMPS contract and current
dated inventory.

**Auto routing tier assignment is a manual step on production.** Unlike
`eduai-dev`/s378 (`infra/s378/go-live-build.sh` runs
`npm run db:seed:reference`, which includes `applyRoutingTierAssignments` in
`apps/core/prisma/seed.ts`), production intentionally does not auto-seed. A
newly created or newly active `AIModel` row therefore starts with
`routerTier: null` and is invisible to Auto routing until an admin sets a
tier via Admin → AI Models → edit the model → Auto Routing Tier. There is no
implicit default — verify this after every fleet change (new model version,
provider swap) that should participate in Auto.

## Rollback

The release symlink is the rollback boundary:

```bash
readlink -f /srv/www/eduai-production/current
sudo -n /usr/local/sbin/eduai-production-admin activate-release <previous-release-id>
sudo -n /usr/local/sbin/eduai-production-admin restart-core
```

Restart the other components only if they are part of the rolled-back release.
Repeat all local/public checks and inspect the journals. Database migrations are
not automatically reversible; consult the migration and backup owner before
attempting a schema rollback.

## Operational notes

- Back up the databases before migrations; a completed backup job is not a
  restore test.
- Keep API keys, database credentials, cookies, and model credentials out of Git,
  shell history, logs, and browser bundles.
- Preserve release directories until the rollback/retention policy allows removal.
- Use [`SUDOERS_SETUP.md`](./SUDOERS_SETUP.md) for the exact privilege boundary.
- Use [`infra/cron/README.md`](../cron/README.md) for backup scripts and the
  s378 cron-worker installation; do not invent a production system crontab from
  the standalone scripts.
