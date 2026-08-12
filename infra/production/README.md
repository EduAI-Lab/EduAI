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

## Initial Core-only production configuration

- Public URL: `https://my.eduai.ok.ubc.ca`
- Internal Core port: `127.0.0.1:3000`
- PostgreSQL: private production database, not the legacy checkout's database
- Redis: private production Redis instance for the optional BullMQ worker
- Inference: configure only reachable hosts in `VLLM_FLEET_CHAT_URLS`; begin with cmps01 and add cmps02/cmps03 after firewall validation
- Extension links: omit `VITE_AI_TUTOR_URL` and `VITE_QUESTION_MAKER_URL` until the new production aliases and authentication path are ready

## One-time server preparation

Run these commands interactively as an administrator after reviewing the host-specific paths and package names:

```bash
sudo install -d -o ssaada08 -g eduai -m 2775 /srv/www/eduai-production/releases
sudo install -d -o ssaada08 -g eduai -m 2775 /srv/www/eduai-production/shared
sudo install -d -o root -g eduai -m 0750 /etc/eduai
sudo install -d -o ssaada08 -g eduai -m 0750 /var/log/eduai
```

Install the environment file from [`core.env.example`](./core.env.example) as `/etc/eduai/eduai-core.env`, replace every placeholder, then apply:

```bash
sudo chown root:eduai /etc/eduai/eduai-core.env
sudo chmod 0640 /etc/eduai/eduai-core.env
```

The production database must be provisioned and tested before migrations are applied. Take a backup before each schema-changing release.

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
npm run build
cd ../..
ln -sfn "/srv/www/eduai-production/releases/<commit>" /srv/www/eduai-production/current
```

Restart only after the build and migration succeed:

```bash
sudo systemctl daemon-reload
sudo systemctl restart eduai-core
sudo systemctl is-active eduai-core
curl -fsS http://127.0.0.1:3000/api/health >/dev/null
curl -fsS https://my.eduai.ok.ubc.ca/api/health >/dev/null
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
