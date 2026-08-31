# EduAI Core production bootstrap

This directory contains the production Core deployment templates. They are intentionally separate from the existing legacy checkout on `s348`:

`/srv/www/my.eduai.ok.ubc.ca`

Do not reset, clean, or pull over that directory until it has been backed up and the replacement deployment has passed validation.

## Read-only preflight

Run [`preflight.sh`](./preflight.sh) on the production host before any privileged provisioning:

```bash
bash infra/production/preflight.sh
```

The script checks installed tools, runtime versions, filesystem paths, the legacy checkout state, service/listener state, release artifacts, PostgreSQL/Redis, local health endpoints, cmps01–03 reachability, and the public URLs. It does not modify files, services, databases, or environment values.

## Target layout

The replacement deployment uses a release layout:

```text
/srv/www/eduai-production/
├── current -> releases/<commit>
├── releases/<commit>/
└── shared/
```

The application service runs from `current`. The old checkout remains available until the new deployment is accepted.

## Application cron worker

The Admin → Cron Jobs page is backed by the dedicated
`eduai-cron-worker.service`; it is not driven by the web process and does not
use a user crontab. The worker reads Core's database environment, dispatches
the allow-listed jobs, and runs shell jobs as the unprivileged `eduai-cron`
user. `Restart=always` keeps the worker itself running, while the application
services retain their own systemd restart policies.

Before enabling it on production, an administrator must create
`/etc/eduai/cron.env` from [`infra/cron/cron.env.example`](../cron/cron.env.example)
with real host-specific values (`root:eduai-cron`, mode `0640`), create the
`eduai-cron` user and its backup/log directories, and install the root-owned
worker template through [`SUDOERS_SETUP.md`](./SUDOERS_SETUP.md). Then run:

```bash
sudo -n /usr/local/sbin/eduai-production-admin install-cron-worker
sudo -n /usr/local/sbin/eduai-production-admin enable-cron-worker
sudo -n /usr/local/sbin/eduai-production-admin restart-cron-worker
```

Review any stale `RUNNING` records in Admin → Cron Jobs before restarting the
worker; it dispatches pending admin-triggered runs when it starts.

## Production configuration

- Public URL: `https://my.eduai.ok.ubc.ca`
- Internal Core port: `127.0.0.1:3000`
- PostgreSQL: private production database, not the legacy checkout's database
- Redis: private production Redis instance for the optional BullMQ worker
- Inference: configure only reachable hosts in `VLLM_FLEET_CHAT_URLS`; this PR's validated application template uses cmps01 for the Qwen3.5 interactive fleet and cmps02 for the retained Qwen2.5 32B Assist Auto model; cmps03 remains outside this rollout pending firewall and inventory validation
- AI Tutor: `https://aitutor.eduai.ok.ubc.ca`, static frontend plus API on `127.0.0.1:4000`
- Shared auth: `COOKIE_DOMAIN=.ok.ubc.ca` is required across the sibling Core and extension hosts; confirm no unrelated `*.ok.ubc.ca` service should receive this cookie before enabling it
- Question Maker: `https://questionmaker.eduai.ok.ubc.ca`, static frontend (same pattern as AI Tutor) plus API on `127.0.0.1:8000`
- Application cron: `eduai-cron-worker.service`, with schedules managed by the Admin → Cron Jobs page

## One-time server preparation

See [`PROVISIONING_CHECKLIST.md`](./PROVISIONING_CHECKLIST.md) for the database, Redis, permissions, environment, systemd, Apache, and final pre-release checks.

For privileged bootstrap operations, use the narrow helper and sudoers procedure in [`SUDOERS_SETUP.md`](./SUDOERS_SETUP.md).

Run these commands interactively as an administrator after reviewing the host-specific paths and package names:

```bash
sudo install -d -o ssaada08 -g eduai -m 2775 /srv/www/eduai-production/releases
sudo install -d -o ssaada08 -g eduai -m 2775 /srv/www/eduai-production/shared
sudo install -d -o root -g eduai -m 0750 /etc/eduai
sudo install -d -o ssaada08 -g eduai -m 0750 /var/log/eduai
sudo install -d -o root -g root -m 0750 /etc/eduai/production-templates
```

Privileged templates consumed by the passwordless helper must be installed by
an administrator into `/etc/eduai/production-templates` and remain root-owned;
do not place them under the deployment account's group-writable `shared/` tree.

Install the environment file from [`core.env.example`](./core.env.example) as `/etc/eduai/eduai-core.env`, replace every placeholder, then apply:

```bash
sudo chown root:eduai /etc/eduai/eduai-core.env
sudo chmod 0640 /etc/eduai/eduai-core.env
```

The production database must be provisioned and tested before migrations are applied. Take a backup before each schema-changing release.

### AI Tutor production prerequisites

Provision a dedicated PostgreSQL role and database before installing
`ai-tutor.env.example`; do not reuse Core's `eduai_prod` database:

```sql
CREATE ROLE ai_tutor_prod LOGIN PASSWORD '<generated-password>';
CREATE DATABASE ai_tutor_prod OWNER ai_tutor_prod;
```

Install the following reviewed templates as root-owned files:

```text
infra/production/ai-tutor.env.example                        -> /etc/eduai/eduai-aitutor.env
infra/production/systemd/eduai-aitutor-server.service        -> /etc/systemd/system/
infra/production/apache/aitutor.eduai.ok.ubc.ca.conf         -> /etc/apache2/sites-available/
infra/production/question-maker.env.example                   -> /etc/eduai/eduai-qm.env
infra/production/systemd/eduai-qm-backend.service             -> /etc/systemd/system/
infra/production/apache/questionmaker.eduai.ok.ubc.ca.conf    -> /etc/apache2/sites-available/
```

The frontend uses the public-only values in
`infra/production/ai-tutor-frontend.env` during the build. The API environment
must contain the same `EDUAI_API_KEY` as Core, but that secret must never be
committed or copied into the frontend bundle. This vhost does not set
explicit `SSLCertificateFile`/`SSLCertificateKeyFile` paths — it relies on
the certificate already configured for `*.eduai.ok.ubc.ca` names on this
host; confirm that coverage before enabling a new vhost under this domain,
rather than assuming a per-hostname certificate file exists.

### Question Maker production prerequisites

Provision a dedicated Question Maker database and role on the host PostgreSQL
instance before installing `question-maker.env.example`; do not reuse Core's
database:

```sql
CREATE ROLE qm_prod LOGIN PASSWORD '<generated-password>';
CREATE DATABASE eduquery OWNER qm_prod;
```

Install `question-maker.env.example` as the reviewed, secret-bearing
`/etc/eduai/eduai-qm.env`, and install
`systemd/eduai-qm-backend.service` and
`apache/questionmaker.eduai.ok.ubc.ca.conf` as root-owned templates. The
Question Maker generated client and frontend entrypoint are mandatory release
artifacts, just like AI Tutor's. If those templates are installed under
`/etc/eduai/production-templates`, the helper can install and validate them:

```bash
sudo -n /usr/local/sbin/eduai-production-admin install-qm-env
sudo -n /usr/local/sbin/eduai-production-admin install-qm-unit
sudo -n /usr/local/sbin/eduai-production-admin install-qm-apache
```

The release pointer is intentionally atomic for all three applications: an
activation is allowed only when Core, AI Tutor, and Question Maker artifacts
are present in the same release. This prevents an app-only build from moving
`current` to a tree that would make an untouched service or Apache document
root incomplete. An app-only build may be used for preparation, but the
unchanged applications' artifacts must be copied into the candidate before
the complete-release validation and activation steps.

## First release procedure

From a clean checkout of the approved `main` commit:

```bash
git fetch origin main
git worktree add --detach "/srv/www/eduai-production/releases/<commit>" "origin/main"
cd "/srv/www/eduai-production/releases/<commit>"
npm ci
npm run db:generate -w edu-ai
(cd apps/extensions/ai-tutor/server && npm run db:generate)
(cd apps/extensions/question-maker/app/backend && npm run db:generate)
cd apps/core
npx prisma migrate deploy
set -a; . /etc/eduai/eduai-core.env; set +a
npm run build
cd ../..
set -a; . /etc/eduai/eduai-aitutor.env; set +a
(cd apps/extensions/ai-tutor/server && npx prisma migrate deploy)
set -a; . /etc/eduai/eduai-qm.env; set +a
(cd apps/extensions/question-maker/app/backend && npm run db:migrate:deploy)
cp infra/production/ai-tutor-frontend.env apps/extensions/ai-tutor/.env
npm run build -w ai-tutor
cp infra/production/question-maker-frontend.env apps/extensions/question-maker/.env
npm run build -w question-maker-frontend
```

`/srv/www/eduai-production` is root-owned; a direct `ln -sfn` as the
deployment account fails with `Permission denied`. Switch `current` through
the helper instead:

```bash
sudo -n /usr/local/sbin/eduai-production-admin validate-release <commit>
sudo -n /usr/local/sbin/eduai-production-admin activate-release <commit>
```

For an urgent app-only change, keep the existing `current` release serving
traffic while preparing a complete candidate. Build the changed app and copy
the currently active artifacts for each unchanged app into that candidate,
then run `validate-release` before activation. Do not bypass the helper's
validation or switch `current` to a partial release. If the candidate cannot
be made complete, leave `current` unchanged and use the rollback procedure
below rather than taking an unrelated app offline.

Restart only after the build and migration succeed:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now eduai-aitutor-server
sudo systemctl enable --now eduai-qm-backend
sudo systemctl enable --now eduai-cron-worker
sudo systemctl restart eduai-core
sudo systemctl is-active eduai-core
sudo systemctl is-active eduai-aitutor-server
sudo systemctl is-active eduai-qm-backend
curl -fsS http://127.0.0.1:3000/api/health >/dev/null
curl -fsS http://127.0.0.1:4000/api/health >/dev/null
curl -fsS http://127.0.0.1:8000/readyz >/dev/null
sudo systemctl is-active eduai-cron-worker
curl -fsS https://my.eduai.ok.ubc.ca/api/health >/dev/null
curl -fsS https://aitutor.eduai.ok.ubc.ca/api/health >/dev/null
curl -fsS https://questionmaker.eduai.ok.ubc.ca/ >/dev/null
```

Do not run `prisma db push` or automatic production seeding in this procedure.

## Rollback

Keep the previous release symlink target until public smoke tests pass. If the new release fails:

```bash
sudo systemctl stop eduai-core
sudo -n /usr/local/sbin/eduai-production-admin activate-release <previous-commit>
sudo systemctl start eduai-core
```

Database rollback is separate from application rollback. A migration that changes the schema must have a reviewed restore or forward-fix procedure before deployment.

## Continuous deployment design

The production server should pull approved `main` commits through a locked systemd timer. The deploy runner must:

1. Refuse a dirty release checkout.
2. Fetch `main` and record the target SHA.
3. Back up the Core database.
4. Build a new release directory with `npm ci`, generating each app's
   extension-local Prisma client before migration.
5. Run all three applications' migrations.
6. Run all three production builds and verify their entrypoints.
7. Validate the release, prepare only the two public static trees for Apache,
   and switch `current` atomically.
8. Restart Core, AI Tutor, and Question Maker and verify local/public health
   endpoints.
9. Repoint `current` to the previous release if health checks fail.

The runner must never use `git reset --hard`, `git clean -fd`, `prisma db push`, or unconditional production seeding.
