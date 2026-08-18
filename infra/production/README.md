# EduAI Core production bootstrap

This directory contains the production Core deployment templates. They are intentionally separate from the existing legacy checkout on `s348`:

`/srv/www/my.eduai.ok.ubc.ca`

Do not reset, clean, or pull over that directory until it has been backed up and the replacement deployment has passed validation.

## Read-only preflight

Run [`preflight.sh`](./preflight.sh) on the production host before any privileged provisioning:

```bash
bash infra/production/preflight.sh
```

The script checks installed tools, runtime versions, filesystem paths, the legacy checkout state, service/listener state, PostgreSQL/Redis, cmps01–03 reachability, and the public URL. It does not modify files, services, databases, or environment values.

## Target layout

The replacement deployment uses a release layout:

```text
/srv/www/eduai-production/
├── current -> releases/<commit>
├── releases/<commit>/
└── shared/
```

The application service runs from `current`. The old checkout remains available until the new deployment is accepted.

## Production configuration

- Public URL: `https://my.eduai.ok.ubc.ca`
- Internal Core port: `127.0.0.1:3000`
- PostgreSQL: private production database, not the legacy checkout's database
- Redis: private production Redis instance for the optional BullMQ worker
- Inference: configure only reachable hosts in `VLLM_FLEET_CHAT_URLS`; begin with cmps01 and add cmps02/cmps03 after firewall validation
- AI Tutor: `https://aitutor.ok.ubc.ca`, static frontend plus API on `127.0.0.1:4000`
- Shared auth: `COOKIE_DOMAIN=.eduai.ok.ubc.ca` is required across Core and AI Tutor
- Question Maker: `https://questionmaker.ok.ubc.ca`, Docker frontend on `127.0.0.1:3005` plus API on `127.0.0.1:8000`

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
infra/production/ai-tutor.env.example                  -> /etc/eduai/eduai-aitutor.env
infra/production/systemd/eduai-aitutor-server.service  -> /etc/systemd/system/
infra/production/apache/aitutor.ok.ubc.ca.conf         -> /etc/apache2/sites-available/
infra/production/question-maker.env.example            -> Question Maker stack `.env`
infra/production/question-maker-frontend.env           -> Question Maker frontend build `.env`
infra/production/apache/questionmaker.ok.ubc.ca.conf   -> /etc/apache2/sites-available/
```

The frontend uses the public-only values in
`infra/production/ai-tutor-frontend.env` during the build. The API environment
must contain the same `EDUAI_API_KEY` as Core, but that secret must never be
committed or copied into the frontend bundle.

### Question Maker production prerequisites

Copy `question-maker.env.example` to the Question Maker project root as `.env`
and copy `question-maker-frontend.env` to
`apps/extensions/question-maker/app/frontend/.env` before running
`docker compose build`. The
frontend values are compiled into the static bundle; changing the container's
runtime environment after the build will not change browser navigation URLs.

Install `apache/questionmaker.ok.ubc.ca.conf` after confirming the managed TLS
certificate path. The vhost proxies `/api/` to the Question Maker backend on
`127.0.0.1:8000` and the frontend to `127.0.0.1:3005`.

## First release procedure

From a clean checkout of the approved `main` commit:

```bash
git fetch origin main
git worktree add --detach "/srv/www/eduai-production/releases/<commit>" "origin/main"
cd "/srv/www/eduai-production/releases/<commit>"
npm ci
npm run db:generate -w edu-ai
cd apps/core
npx prisma migrate deploy
set -a; . /etc/eduai/eduai-core.env; set +a
npm run build
cd ../..
ln -sfn "/srv/www/eduai-production/releases/<commit>" /srv/www/eduai-production/current
```

For a release that includes AI Tutor, run its database migration and build
before switching `current`:

```bash
cd "/srv/www/eduai-production/releases/<commit>"
set -a; . /etc/eduai/eduai-aitutor.env; set +a
(cd apps/extensions/ai-tutor/server && npx prisma generate)
(cd apps/extensions/ai-tutor/server && npx prisma migrate deploy)
cp infra/production/ai-tutor-frontend.env apps/extensions/ai-tutor/.env
npm run build -w ai-tutor
```

Restart only after the build and migration succeed:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now eduai-aitutor-server
sudo systemctl restart eduai-core
sudo systemctl is-active eduai-core
sudo systemctl is-active eduai-aitutor-server
curl -fsS http://127.0.0.1:3000/api/health >/dev/null
curl -fsS http://127.0.0.1:4000/api/health >/dev/null
curl -fsS https://my.eduai.ok.ubc.ca/api/health >/dev/null
curl -fsS https://aitutor.ok.ubc.ca/api/health >/dev/null
curl -fsS https://questionmaker.ok.ubc.ca/healthz.html >/dev/null
```

Do not run `prisma db push` or automatic production seeding in this procedure.

## Rollback

Keep the previous release symlink target until public smoke tests pass. If the new release fails:

```bash
sudo systemctl stop eduai-core
ln -sfn "/srv/www/eduai-production/releases/<previous-commit>" /srv/www/eduai-production/current
sudo systemctl start eduai-core
```

Database rollback is separate from application rollback. A migration that changes the schema must have a reviewed restore or forward-fix procedure before deployment.

## Continuous deployment design

The production server should pull approved `main` commits through a locked systemd timer. The deploy runner must:

1. Refuse a dirty release checkout.
2. Fetch `main` and record the target SHA.
3. Back up the Core database.
4. Build a new release directory with `npm ci`.
5. Run `prisma migrate deploy`.
6. Run the production build.
7. Switch `current` atomically.
8. Restart Core and verify local/public health endpoints.
9. Repoint `current` to the previous release if health checks fail.

The runner must never use `git reset --hard`, `git clean -fd`, `prisma db push`, or unconditional production seeding.
