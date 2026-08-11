# Question Maker production deployment

This guide deploys Question Maker from the EduAI monorepo's reviewed
`development` branch. The production stack is defined in
`apps/extensions/question-maker/docker-compose.yml` and must be built from the
monorepo root so npm workspaces, the root lockfile, and shared packages are
available.

## Release contract

- Repository checkout: `/srv/www/EduAI` by default.
- Source branch: `development` unless an operator explicitly sets `BRANCH`.
- Git authentication: a read-only SSH deploy key or operating-system credential
  helper. Never put a personal access token in `.env`, a remote URL, a command
  line, a cron entry, or this repository.
- Update strategy: clean checkout plus `git merge --ff-only`. A dirty or
  diverged checkout stops the release for operator review; deployment never
  discards local files.
- Database changes: the backend container runs committed Prisma migrations
  before it starts the server. Do not use `prisma db push` in production.

## Prerequisites

1. Install Git and Docker with the Compose plugin.
2. Clone the full EduAI monorepo:

   ~~~sh
   sudo mkdir -p /srv/www/EduAI
   sudo chown "$USER" /srv/www/EduAI
   git clone --branch development git@github.com:ORG/EduAI.git /srv/www/EduAI
   ~~~

3. Configure `origin` with a read-only deploy key or credential helper and test
   it without printing credentials:

   ~~~sh
   cd /srv/www/EduAI
   git remote -v
   git fetch origin development
   ~~~

4. Copy the production environment template and populate it through the host's
   secret-management process:

   ~~~sh
   cd /srv/www/EduAI/apps/extensions/question-maker
   cp .env.example .env
   chmod 600 .env
   ~~~

   At minimum, production needs a strong `POSTGRES_PASSWORD_PRODUCTION`, a
   64-character hexadecimal `ENCRYPTION_KEY`, the Core service URL and shared
   `EDUAI_API_KEY`, and the approved browser origins. Keep `.env` untracked.

## Preflight

Run these checks from the monorepo root before changing the live stack:

~~~sh
cd /srv/www/EduAI
test -z "$(git status --porcelain --untracked-files=normal)"
test "$(git branch --show-current)" = development
git fetch origin development
git merge-base --is-ancestor HEAD origin/development
docker compose -f apps/extensions/question-maker/docker-compose.yml config --quiet
docker compose -f apps/extensions/question-maker/docker-compose.yml build
~~~

`docker compose config` can expand secrets. Use `--quiet` and do not paste an
unredacted rendered configuration into tickets or logs.

## Deploy

The checked-in deployment script performs the clean-checkout, fast-forward,
build, restart, and health-check sequence:

~~~sh
cd /srv/www/EduAI
PROJECT_DIR=/srv/www/EduAI BRANCH=development \
  apps/extensions/question-maker/scripts/daily-deploy.sh
~~~

It should report all services healthy. Verify the application independently:

~~~sh
docker compose -f apps/extensions/question-maker/docker-compose.yml ps
curl --fail --silent http://127.0.0.1:8000/healthz
curl --fail --silent http://127.0.0.1:8000/readyz
curl --fail --silent http://127.0.0.1:3005/healthz.html
~~~

`/healthz` is process liveness. `/readyz` includes the database dependency and
is the endpoint that should gate traffic.

## Reverse proxy

Terminate TLS at the approved edge proxy. Route `/api/` to the backend on port
8000 and all other paths to the static frontend on port 3005. Preserve the
original host and forwarding headers only from the trusted proxy. Do not expose
Postgres directly to the public network.

After changing proxy configuration, validate it before reload. For Apache this
is typically:

~~~sh
sudo apachectl configtest
sudo systemctl reload httpd
~~~

Use `apache2` instead of `httpd` on distributions that name the service that
way.

## Scheduled deployment

Systemd installation and the cron alternative are documented in
[cron.md](./cron.md). Review the checked-in service's `User` and `Group` for the
target host before installing it. The scheduler must use the same
`development` branch and `/srv/www/EduAI` checkout as the manual procedure.

## Rollback

Do not reset the live checkout destructively. Select a previously reviewed
commit through the normal Git workflow, create or update a release branch, and
fast-forward the deployment checkout to that commit. If a schema migration has
already run, review its forward-compatible rollback procedure before changing
application code. Restore data only from a verified backup and record the
restore point.

## Troubleshooting

- **Dirty checkout:** inspect `git status --short`; preserve or deliberately
  remove operator-owned files outside the deploy script.
- **Fast-forward refused:** the checkout diverged. Compare local and remote
  commits and resolve manually; do not add `reset --hard` as a fallback.
- **Postgres unhealthy:** verify `POSTGRES_PASSWORD_PRODUCTION`, volume
  permissions, and database logs without copying secret values.
- **Backend not ready:** inspect backend and Postgres logs, then verify all
  committed migrations completed.
- **Frontend unhealthy:** verify the container check uses port 8080 internally
  and the host publishes port 3005.

Useful diagnostics:

~~~sh
docker compose -f apps/extensions/question-maker/docker-compose.yml ps
docker compose -f apps/extensions/question-maker/docker-compose.yml logs --tail=100 backend postgres frontend
sudo journalctl -u question-maker-deploy.service --since today
~~~

Redact tokens, cookies, database URLs, request bodies, uploaded content, and
provider responses before sharing diagnostic output.
