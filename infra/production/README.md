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
- Inference: configure only reachable hosts in `VLLM_FLEET_CHAT_URLS`; this PR's validated application template uses cmps01 for the Qwen3.5 interactive fleet and cmps02 for the retained Qwen2.5 32B Assist Auto model; cmps03 remains outside this rollout pending firewall and inventory validation
- AI Tutor: `https://aitutor.eduai.ok.ubc.ca`, static frontend plus API on `127.0.0.1:4000`
- Shared auth: `COOKIE_DOMAIN=.ok.ubc.ca` is required across the sibling Core and extension hosts; confirm no unrelated `*.ok.ubc.ca` service should receive this cookie before enabling it
- Question Maker: `https://questionmaker.eduai.ok.ubc.ca`, static frontend (same pattern as AI Tutor) plus API on `127.0.0.1:8000` — see the dedicated Question Maker provisioning PR/branch for its templates and `provision-qm` helper action; not covered by this file

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

Question Maker's production templates and provisioning sequence are not in
this revision of `README.md` — see the dedicated Question Maker
provisioning branch/PR, which follows the same static-frontend-plus-API
pattern as AI Tutor above (hostname `questionmaker.eduai.ok.ubc.ca`, API on
`127.0.0.1:8000`) and a `provision-qm` `eduai-production-admin` action
modeled on `provision-aitutor`.

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
```

`/srv/www/eduai-production` is root-owned; a direct `ln -sfn` as the
deployment account fails with `Permission denied`. Switch `current` through
the helper instead:

```bash
sudo -n /usr/local/sbin/eduai-production-admin activate-release <commit>
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
curl -fsS https://aitutor.eduai.ok.ubc.ca/api/health >/dev/null
```

Question Maker's health checks are covered by its own provisioning
branch/PR (see above), not this file.

Do not run `prisma db push` or automatic production seeding in this procedure.

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
4. Build a new release directory with `npm ci`.
5. Run `prisma migrate deploy`.
6. Run the production build.
7. Switch `current` atomically.
8. Restart Core and verify local/public health endpoints.
9. Repoint `current` to the previous release if health checks fail.

The runner must never use `git reset --hard`, `git clean -fd`, `prisma db push`, or unconditional production seeding.
