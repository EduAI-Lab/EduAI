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

   **If this deployment has ever connected Canvas from Question Maker**, it also
   needs `CORE_DATABASE_URL` and `CORE_ENCRYPTION_KEY` — see "Canvas credential
   migration" below.

## Canvas credential migration (one-time, #1084)

Question Maker no longer stores Canvas API tokens; Core does. On startup the
backend container runs, in order:

1. `scripts/baselineExistingDatabase.js`
2. `scripts/migrate-canvas-integrations-to-core.mjs` — the credential copier
3. `prisma migrate deploy` — which renames `canvas_integrations` to
   `canvas_integrations_pre_core_backup`

The copier must run before step 3, so it is part of the container command rather
than a manual step. It decrypts each token with QM's `ENCRYPTION_KEY`, re-encrypts
it with Core's, and writes it to Core only where Core has no row for that user
(Core wins on conflict). Because the two services are documented as holding
**separate** keys, the QM container environment needs both:

| Variable | Value |
|---|---|
| `CORE_DATABASE_URL` | Core's Postgres URL, reachable from the QM container |
| `CORE_ENCRYPTION_KEY` | Core's `ENCRYPTION_KEY` |

If QM has `canvas_integrations` rows and `CORE_DATABASE_URL` is unset, the copier
exits non-zero and the container will not start — this is deliberate, so tokens are
never renamed out of reach without being copied. On a deployment that never
connected Canvas from QM the copier is a no-op and both variables may be omitted.

Verify the copy before deploying for real:

~~~sh
cd /srv/www/EduAI
npm run db:migrate:canvas-to-core -w question-maker-backend -- --dry-run
~~~

Once Core's rows are verified, `canvas_integrations_pre_core_backup` may be dropped
on the QM database. Leaving it is safe; dropping it is irreversible. Full procedure:
[`docs/DEPLOYMENT.md`](../../../../../docs/DEPLOYMENT.md).

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

## Database access

The production Compose file intentionally keeps PostgreSQL on the private
`eduquery-network`; it has no host-published database port. Run administrative
queries from the container network instead of opening PostgreSQL on the host:

~~~sh
docker compose -f apps/extensions/question-maker/docker-compose.yml \
  exec postgres psql -U postgres -d eduquery
~~~

For local development, use `docker-compose.dev.yml` (which publishes its
development-only database port) or the root monorepo development stack. If a
temporary host client connection is unavoidable, use a separate, explicit
override that binds only to `127.0.0.1`, and remove it immediately after the
maintenance task; never add that mapping to the production Compose file.

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
