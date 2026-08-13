# Deployment

**Status:** Living document
**Last updated:** 2026-07-30

This document covers local development, the shared s378 development deployment, and the
production topology. Environment variables are catalogued in
[`docs/ENVIRONMENT.md`](ENVIRONMENT.md); this guide only lists values that change how a deployment
is wired.

## Service map

| Service | Local port | Shared development URL | Served on s378 by |
|---|---:|---|---|
| Core | `3000` | `https://dev.eduai.ok.ubc.ca` | node (SSR), proxied |
| AI Tutor frontend | `3001` | `https://dev.aitutor.eduai.ok.ubc.ca` | Apache, static build output |
| AI Tutor API | `4000` | `https://dev.aitutor.eduai.ok.ubc.ca/api/` | node, proxied |
| Question Maker frontend | `5173` | `https://dev.questionmaker.eduai.ok.ubc.ca` | Apache, static build output |
| Question Maker API | `8000` | `https://dev.questionmaker.eduai.ok.ubc.ca/api/` | node, proxied |

The two frontend ports are local-development only. On s378 both extensions are built to static
files and served straight from disk, so nothing listens on `3001` or `5173` there.

Core owns the browser session. AI Tutor and Question Maker forward the incoming cookie to Core's
`POST /api/sessions/validate`; their server-to-server requests use the shared `EDUAI_API_KEY`.

## Local development

Install and run from the monorepo root:

```bash
npm install
npm run dev
```

`npm install` creates missing app `.env` files from their examples without overwriting existing
values. `npm run dev` starts the development databases and Redis through
`docker-compose.dev.yml`, then starts all workspaces through Turborepo. Docker Desktop is started
automatically on macOS when possible; start Docker yourself on other platforms.

To run one product after its database is available:

```bash
npm run docker:dev:db
npx turbo run dev --filter=edu-ai
npx turbo run dev --filter=ai-tutor --filter=ai-tutor-server
npx turbo run dev --filter='question-maker-*'
```

### Local data services

`docker-compose.dev.yml` runs data services only; the applications run on the host.

| Service | Container | Host port | Database / purpose | Credentials |
|---|---|---:|---|---|
| Core Postgres + pgvector | `eduai-db` | `54320` | `eduai` | `postgres` / `postgres` |
| AI Tutor Postgres | `eduai-ai-tutor-db` | `54321` | `ai-tutor` | `postgres` / `postgres` |
| Question Maker Postgres | `eduai-question-maker-db` | `55432` | `question-maker` | `postgres` / `password` |
| Core Redis | `eduai-redis` | `63790` | Async AI-job queue | none |

Override those host ports in the root `.env` with `CORE_DB_PORT`, `TUTOR_DB_PORT`, `QM_DB_PORT`,
and `CORE_REDIS_PORT`. Useful lifecycle commands:

```bash
npm run docker:dev:db
docker compose -f docker-compose.dev.yml ps
npm run docker:dev:db:logs
npm run docker:dev:db:down
```

`npm run docker:dev:nuke` deletes all development volumes and their data. Use it only when a full
reset is intended.

### Required cross-service configuration

The app-specific `.env.example` files are the source of truth. For a working local stack:

- Core: set `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and any model-provider keys in
  `apps/core/.env`.
- AI Tutor API: set `DATABASE_URL`, `CORE_URL`, `EDUAI_BASE_URL`, and `EDUAI_API_KEY` in
  `apps/extensions/ai-tutor/server/.env`.
- Question Maker: set `DATABASE_URL`, `CORE_URL`, `EDUAI_API_URL`, `CORS_ORIGINS`, and
  `EDUAI_API_KEY` in `apps/extensions/question-maker/.env`.
- Use the same randomly generated `EDUAI_API_KEY` in Core and both extension backends:

  ```bash
  openssl rand -hex 32
  ```

Canvas credentials are stored encrypted in the database rather than in these env files. See
[`docs/ENVIRONMENT.md`](ENVIRONMENT.md) for the complete inventory and
[`docs/CANVAS.md`](CANVAS.md) for Canvas setup.

## Shared development server (s378)

The shared host runs four node processes (Core, the dedicated cron worker, and
the two extension servers) plus the local data services, and serves both extension
frontends as static files from Apache. It is also the normal
place to test campus inference because cmps01 is reachable from s378, while it may not be reachable
from a developer laptop.

### Access and checkout

Connect from the UBC network or VPN:

```bash
ssh YOUR_CWL@s378.ok.ubc.ca
cd /srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore
```

The checked-in s378 systemd units use that nested checkout path. If the server checkout moves,
update `WorkingDirectory` and `Documentation` in `infra/s378/systemd/*.service` before reinstalling
the units.

Update the shared branch and prepare generated state:

```bash
git fetch origin
git checkout development
git pull --ff-only origin development
npm install
npm run docker:dev:db
npm run db:generate -w edu-ai
npm run db:migrate:deploy -w question-maker-backend
cd apps/core && npx prisma migrate deploy
cd ../extensions/ai-tutor/server && npx prisma migrate deploy
```

App development commands already migrate and seed-if-empty on startup, but explicit migration is
useful before restarting the shared stack because it fails before traffic is sent to an incompatible
schema. `go-live-build.sh` runs both of these plus Question Maker's, so a normal deploy does not
need them run by hand.

### Deploying a branch

s378 serves **built** assets. `git pull` alone no longer changes what the sites serve, and neither
does restarting a unit — every deploy has to rebuild:

```bash
cd /srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore
git fetch origin && git switch <branch>
bash infra/s378/go-live-build.sh --install     # drop --install if dependencies are unchanged
```

The script enforces the one ordering that matters: **env → generate → migrate → build → restart**.
`go-live-env.sh` writes the `VITE_*` public URLs, and those are baked into the bundle at build time
rather than read at startup, so running it after a build ships the previous run's URLs.

Builds run with `NODE_ENV=development` so s378 stays a development environment — `import.meta.env.DEV`
branches survive, and Core's `isProd` gates (HSTS, strict nonce CSP) stay off.

### Process management

Four system units under `infra/s378/systemd/`, owned by the `eduai-dev` group:

| Unit | Process |
|---|---|
| `eduai-core.service` | Core on `3000` (SSR, `react-router-serve`) |
| `eduai-cron-worker.service` | Dedicated Core cron scheduler and shell-job worker |
| `eduai-aitutor-server.service` | AI Tutor API on `4000` |
| `eduai-qm-backend.service` | Question Maker API on `8000` |
| `eduai-dev.target` | All four services |

Both extension frontends build to static files (`ssr: false`) and are served directly by Apache, so
they have no unit and no port of their own.

One-time installation (needs sudo):

```bash
bash infra/s378/go-live-systemd-install.sh
```

That installs the units to `/etc/systemd/system`, the shared env file to `/etc/eduai/`, and a polkit
rule scoped to `eduai-*` units. No `loginctl enable-linger` — system units survive logout and reboot
on their own. Day-to-day operations need no sudo:

```bash
systemctl status eduai-dev.target
systemctl restart eduai-dev.target
systemctl restart eduai-core
journalctl -u eduai-core -f
systemctl status eduai-cron-worker.service --no-pager
journalctl -u eduai-cron-worker.service -n 50 --no-pager
```

After deploying a change to `infra/cron/*.sh`, `go-live-build.sh` synchronizes
those scripts into `/opt/eduai/cron` before restarting the worker. For a one-time
upgrade from the old three-unit layout, run
`bash infra/s378/go-live-systemd-install.sh` first; it creates the dedicated
`eduai-cron` account, directories, env permissions, and worker unit.

Restarting picks up a changed server-side `.env`, but a changed `VITE_`-prefixed value needs a full
rebuild. Never start an app with `npm run dev` on s378 — it binds the same port the unit holds.

### Environment and shared auth

On s378, Core must issue a cookie usable by all three development hosts:

```env
BETTER_AUTH_URL="https://dev.eduai.ok.ubc.ca"
COOKIE_DOMAIN=".eduai.ok.ubc.ca"
```

After changing either value, users must sign in again. Keep the service key synchronized without
printing it:

```bash
bash infra/s378/go-live-build.sh
```

`go-live-env.sh` copies the Core `EDUAI_API_KEY` into the AI Tutor and Question Maker env files and
sets their public URLs. The canonical script and operational notes live in
[`infra/s378/GO-LIVE.md`](../infra/s378/GO-LIVE.md).

### Async AI-job worker

The durable BullMQ queue is drained by a separate Core process. Run one worker
process per Core deployment:

```bash
cd apps/core
npm run queue:worker
```

The process consumes `ai-jobs-chat` and `ai-jobs-heavy`, claims the authoritative
`AiJob` row, routes inference through the matching fleet pool, and writes
`COMPLETED` or `FAILED`. Graceful `SIGINT`/`SIGTERM` shutdown closes both BullMQ
workers before disconnecting Redis.

| Variable | Purpose |
| -------- | ------- |
| `REDIS_URL` | Shared Redis used by the producer and worker |
| `QUEUE_ENQUEUE_ENABLED` | Enables the guarded producer path; turn on only when the worker service is healthy |
| `AI_JOB_DEFAULT_MODEL` | Optional explicit worker model; otherwise Auto routing is used |
| `AI_JOB_CHAT_CONCURRENCY` | Chat-pool worker concurrency (default `8`) |
| `AI_JOB_HEAVY_CONCURRENCY` | Heavy-pool worker concurrency (default `1`) |
| `AI_JOB_EXECUTION_TIMEOUT_MS` | Per-attempt provider timeout in milliseconds (default `120000`) |
| `AI_JOB_ATTEMPTS` | Total BullMQ attempts per job (default `3`) |
| `AI_JOB_RETRY_DELAY_MS` | Exponential retry base delay (default `5000`) |

### Apache reverse proxy

The checked-in vhost templates are:

- `infra/s378/dev.aitutor.eduai.ok.ubc.ca.conf`
- `infra/s378/dev.questionmaker.eduai.ok.ubc.ca.conf`

Core's existing vhost proxies `dev.eduai.ok.ubc.ca` to `127.0.0.1:3000`. The two extension vhosts are
split: `/api/` is proxied to the backend, and everything else is served as static files from the
build output with `FallbackResource /index.html` for SPA routing. Install or refresh them with:

```bash
bash infra/s378/go-live-apache.sh
```

The script installs from the repo (not `~/dev-vhosts/`), backs up the previous conf to
`.bak.<timestamp>`, runs `httpd -t`, and restores the backup if the config fails to validate.

`mod_headers` is required for the `Cache-Control` blocks. `mod_proxy_wstunnel` is no longer needed —
there is no HMR websocket to upgrade. Core records the rightmost `X-Forwarded-For` value, so the
production security model assumes exactly one trusted reverse proxy and no direct public access to
Node.

### Campus inference

Configure Core on s378 to use the cmps01 HTTP endpoints:

```env
OLLAMA_BASE_URL="http://cmps01.ok.ubc.ca:11434"
VLLM_BASE_URL="http://cmps01.ok.ubc.ca:8001"
VLLM_API_KEY="<same value as cmps01's CMPS01_INTERNAL_KEY>"
```

`VLLM_API_KEY` must be a real generated secret (`openssl rand -hex 32`), not the
`vllm-local` placeholder — as soon as `VLLM_BASE_URL` points at cmps01, Core
refuses to fall back to `vllm-local` even though s378 runs
`NODE_ENV=development` (see #1115).

Then restart Core and verify from `apps/core`:

```bash
systemctl restart eduai-core
npm run vllm:smoke
npm run fleet:smoke
```

For fleet variables and firewall caveats, see
[`docs/rag-ai/HOW_TO_USE_DEV_SERVER.md`](rag-ai/HOW_TO_USE_DEV_SERVER.md) and
[`docs/rag-ai/VLLM.md`](rag-ai/VLLM.md).

### Smoke checks

```bash
systemctl is-active eduai-core eduai-cron-worker eduai-aitutor-server eduai-qm-backend

curl -fsS http://127.0.0.1:3000/ >/dev/null
curl -fsS http://127.0.0.1:4000/api/health >/dev/null
curl -fsS http://127.0.0.1:8000/healthz >/dev/null

# the two static sites — served by Apache, no local port to curl
curl -fsSk https://dev.aitutor.eduai.ok.ubc.ca/ >/dev/null
curl -fsSk https://dev.questionmaker.eduai.ok.ubc.ca/ >/dev/null
```

A public `503 Service Unavailable` on Core or an `/api/` path usually means Apache cannot reach the
local process — check the matching systemd unit, its journal, and the local curl before changing
proxy configuration. A `403` or `404` on one of the static sites is a different failure: the build
output is missing or unreadable, so check that `go-live-build.sh` completed.

## Production deployment

Production is an architectural contract, not a single checked-in one-command deployment. Do not use
`apps/core/deploy.sh` without adapting and reviewing it; it is a legacy template with host-specific
placeholders and destructive Git operations.

### Domain layout

| App | Production host |
|---|---|
| Core | `https://eduai.ok.ubc.ca` |
| AI Tutor | `https://ai-tutor.eduai.ok.ubc.ca` |
| Question Maker | `https://qm.eduai.ok.ubc.ca` |

Each app may run on one host or separate hosts. Every public host needs TLS and a reverse-proxy
upstream for its frontend and API. Keep Node ports private, preserve the original host and scheme,
and configure each backend's credentialed CORS allow-list for the exact deployed origins.

Core's production `BETTER_AUTH_URL`, `COOKIE_DOMAIN`, and trusted origins must match the public
domain layout. Extension `CORE_URL` values point to Core, while their browser-facing `VITE_*` values
point to the public hosts. Register only redirect URLs that the implemented login flow actually uses;
do not infer callback routes from the subdomain name.

### Production release order

1. Back up each database and verify the restore procedure.
2. Fetch the reviewed release commit into a clean checkout.
3. Install locked dependencies with `npm ci`.
4. Apply Core, AI Tutor, and Question Maker Prisma migrations.
5. Build the frontend/server bundles required by the chosen process manager.
6. Restart one service at a time and verify its local health endpoint.
7. Verify Core login, cross-subdomain session validation, and shared-key calls from both extensions.
8. Verify the three public URLs through TLS and the reverse proxy.

Store secrets outside Git, run services as an unprivileged account, and keep database and Node ports
off the public interface. Production backup and lifecycle jobs are documented in
[`infra/cron/README.md`](../infra/cron/README.md).

## Adding an extension

1. Assign a local frontend/API port pair and add workspace scripts.
2. Add its databases or queues to the appropriate infrastructure configuration.
3. Register its public URL in Core's extension launcher and trusted-origin configuration.
4. Implement Core session validation and use the shared service key only for server-to-server calls.
5. Add a reverse-proxy vhost, TLS certificate, systemd/container service, and health check.
6. Add its env variables to `docs/ENVIRONMENT.md` and its public URL to this service map.
7. Test login, logout, session expiry, CORS, API health, and restart recovery through the public host.
