# EduAI deployment guide

**Status:** Living document
**Last updated:** 2026-09-02 (verified against `infra/`, `docker-compose.dev.yml`, and `apps/core/scripts/`)

This page is the deployment index. It describes the supported deployment paths and
links to the runbook that owns each detail. The repository scripts and the server
state are authoritative; examples in this document are not proof that a service is

This document covers local development, the shared s378 development deployment, and the production topology. Environment variables are catalogued in [`docs/ENVIRONMENT.md`](ENVIRONMENT.md); this guide only lists values that change how a deployment is wired.

## Choose the right runbook

| Task | Canonical guide | Scope |
| --- | --- | --- |
| Local development | This page and each app's README | Workstation-only development services |
| Shared development / s378 | [`infra/s378/GO-LIVE.md`](../infra/s378/GO-LIVE.md) | Built Core, AI Tutor, Question Maker, and cron-worker deployment |
| Production / s348 | [`infra/production/README.md`](../infra/production/README.md) | Release-based production deployment and rollback |
| Production preflight | [`infra/production/PROVISIONING_CHECKLIST.md`](../infra/production/PROVISIONING_CHECKLIST.md) | Host, database, environment, inference, and web-server checklist |
| Production privilege boundary | [`infra/production/SUDOERS_SETUP.md`](../infra/production/SUDOERS_SETUP.md) | Restricted administrative helper and root-owned templates |
| Inference fleet | [`infra/inference/README.md`](../infra/inference/README.md) | Shared fleet contract and CMPS01/02/03 host state |
| Backups and scheduled maintenance | [`infra/cron/README.md`](../infra/cron/README.md) | Backup scripts and the s378 cron-worker installation |

The two frontend ports are local-development only. On s378 both extensions are built to static files and served straight from disk, so nothing listens on `3001` or `5173` there.

Core owns the browser session. AI Tutor and Question Maker forward the incoming cookie to Core's `POST /api/sessions/validate`; their server-to-server requests use the shared `EDUAI_API_KEY`.

Application-specific deployment notes remain under `apps/`. Authentication and
first-admin bootstrap are documented in
[`apps/core/docs/DEPLOYMENT.md`](../apps/core/docs/DEPLOYMENT.md).

## Operational contacts

- **IT — Ian Courtney** (`ian.courtney@ubc.ca`): contact for all server-related
  matters involving CMPS01, CMPS02, CMPS03, s348 (production), and s378
  (development).
- **CTL — Michael Ogden** (`michael.ogden@ubc.ca`): coordinating additional
  servers from CTL and UBCV and working with Rich Tape on a potential deal.

## Deployment contracts

The supported runtime layout is:

| Component | Development | Production |
| --- | --- | --- |
| Core web application | s378, `127.0.0.1:3000` | s348, `127.0.0.1:3000` |
| AI Tutor API | s378, `127.0.0.1:4000` | s348, `127.0.0.1:4000` |
| Question Maker backend | s378, `127.0.0.1:8000` | s348, `0.0.0.0:8000` in the current deployment |
| Browser frontends | Built static assets served by the web server | Built static assets served by the web server |
| Database | Development containers on host ports | Host-managed PostgreSQL, normally `127.0.0.1:5432` |
| Redis | Development container on host port `63790` | Host-managed Redis when enabled; queueing is currently disabled |
| Inference | CMPS fleet behind port `8001` | Only approved and healthy CMPS endpoints |

Development uses the public hosts below after the web server is configured:

- Core: `https://dev.eduai.ok.ubc.ca`
- AI Tutor: `https://dev.aitutor.eduai.ok.ubc.ca`
- Question Maker: `https://dev.questionmaker.eduai.ok.ubc.ca`

Production uses `https://my.eduai.ok.ubc.ca`,
`https://aitutor.eduai.ok.ubc.ca`, and
`https://questionmaker.eduai.ok.ubc.ca`.

## Source of truth and safe boundaries

- `infra/s378/go-live-build.sh` is the canonical shared-development deployer.
- `infra/s378/go-live-systemd-install.sh` installs the s378 system units and
  supporting files; it does not build or start the applications.
- `infra/production/admin-helper.sh` is the restricted production administration
  interface. It is the only supported path for the privileged production actions
  listed in [`SUDOERS_SETUP.md`](../infra/production/SUDOERS_SETUP.md).
- `infra/cmps01/migrate.sh` is the repository-managed inference-host procedure.
- `apps/core/deploy.sh` and `apps/extensions/ai-tutor/deploy.sh` are legacy PM2
  templates. They are not the s378 or production deployment mechanism and should
  not be used as a substitute for the runbooks above.
- Never commit `.env` files, API keys, database passwords, model credentials, or
  generated secrets. The deployment scripts intentionally refuse some unsafe
  environment-file and dirty-checkout states.
- Do not copy commands from a server's current working tree into a runbook without
  checking them against the corresponding file in the repository. A server may
  contain an older release, local backup, or an uncommitted operational change.

## Local development

From the repository root:

```bash
npm install
npm run dev
```

`npm install` creates missing app `.env` files from their examples without overwriting existing values. `npm run dev` starts the development databases and Redis through `docker-compose.dev.yml`, then starts all workspaces through Turborepo. Docker Desktop is started automatically on macOS when possible; start Docker yourself on other platforms.

The root development command starts the application services after the development
databases are available. The compose file used by the root scripts is
`docker-compose.dev.yml`:

| Service | Host port |
| --- | ---: |
| Core PostgreSQL | `54320` |
| AI Tutor PostgreSQL | `54321` |
| Question Maker PostgreSQL | `55432` |
| Redis | `63790` |

For an individual app, use its package scripts and README. Do not use production
environment files for local development. Before testing an authenticated API,
complete the Core authentication bootstrap described in
[`apps/core/docs/DEPLOYMENT.md`](../apps/core/docs/DEPLOYMENT.md).

## Shared development deployment

The shared development checkout is normally:

```text
/srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore
```

### Local data services

`docker-compose.dev.yml` runs data services only; the applications run on the host.

| Service | Container | Host port | Database / purpose | Credentials |
|---|---|---:|---|---|
| Core Postgres + pgvector | `eduai-db` | `54320` | `eduai` | `postgres` / `postgres` |
| AI Tutor Postgres | `eduai-ai-tutor-db` | `54321` | `ai-tutor` | `postgres` / `postgres` |
| Question Maker Postgres | `eduai-question-maker-db` | `55432` | `question-maker` | `postgres` / `password` |
| Core Redis | `eduai-redis` | `63790` | Shared `/api/chat` + `/api/completion` rate limits (live); async AI-job queue (dormant) | none |

Override those host ports in the root `.env` with `CORE_DB_PORT`, `TUTOR_DB_PORT`, `QM_DB_PORT`, and `CORE_REDIS_PORT`. Useful lifecycle commands:

```bash
npm run docker:dev:db
docker compose -f docker-compose.dev.yml ps
npm run docker:dev:db:logs
npm run docker:dev:db:down
```

`npm run docker:dev:nuke` deletes all development volumes and their data. Use it only when a full reset is intended.

### Required cross-service configuration

The app-specific `.env.example` files are the source of truth. For a working local stack:

- Core: set `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and any model-provider keys in `apps/core/.env`.
- AI Tutor API: set `DATABASE_URL`, `CORE_URL`, `EDUAI_BASE_URL`, and `EDUAI_API_KEY` in `apps/extensions/ai-tutor/server/.env`.
- Question Maker: set `DATABASE_URL`, `CORE_URL`, `EDUAI_API_URL`, `CORS_ORIGINS`, and `EDUAI_API_KEY` in `apps/extensions/question-maker/.env`.
- Use the same randomly generated `EDUAI_API_KEY` in Core and both extension backends:

  ```bash
  openssl rand -hex 32
  ```

Canvas credentials are stored encrypted in the database rather than in these env files. See [`docs/ENVIRONMENT.md`](ENVIRONMENT.md) for the complete inventory and [`docs/CANVAS.md`](CANVAS.md) for Canvas setup.

## Shared development server (s378)

The shared host runs four node processes (Core, the dedicated cron worker, and the two extension servers) plus the local data services, and serves both extension frontends as static files from Apache. It is also the normal place to test campus inference because cmps01 is reachable from s378, while it may not be reachable from a developer laptop.

### Access and checkout

Connect from the UBC network or VPN:

```bash
ssh YOUR_CWL@s378.ok.ubc.ca
cd /srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore
```

The checked-in s378 systemd units use that nested checkout path. If the server checkout moves, update `WorkingDirectory` and `Documentation` in `infra/s378/systemd/*.service` before reinstalling the units.

The complete procedure, including one-time systemd installation, belongs in
[`infra/s378/GO-LIVE.md`](../infra/s378/GO-LIVE.md). The short operational path is:

Update the shared branch and prepare generated state:

```bash
git status --short
git fetch origin
git checkout development
git pull --ff-only origin development
bash infra/s378/go-live-build.sh --install
```

The deployer performs environment synchronization, Prisma client generation,
migrations, reference and extension seed steps, builds, service restarts, and
port checks in a defined order. It must run from the intended checkout and will
refuse unsafe environment files or an unsuitable working tree. Review the script
output before treating the deployment as successful.

App development commands already migrate and seed-if-empty on startup, but explicit migration is useful before restarting the shared stack because it fails before traffic is sent to an incompatible schema. `go-live-build.sh` runs Core → AI Tutor → Question Maker in that order, so a normal deploy does not need them run by hand. Production QM containers run baseline → canvas→Core copier → `prisma migrate deploy` from their startup command (the same sequence as `npm run db:migrate:deploy`) before starting the API — set `CORE_DATABASE_URL`, `QM_ENCRYPTION_KEY` / `CORE_ENCRYPTION_KEY` (or the respective `ENCRYPTION_KEY` values) in the container env whenever QM still has credential rows.

### Canvas credentials: QM → Core (one-time)

Question Maker no longer stores Canvas API tokens. Before QM's Prisma migrate renames `canvas_integrations` → `canvas_integrations_pre_core_backup`, both the QM container startup command and `npm run db:migrate:deploy -w question-maker-backend` run `scripts/migrate-canvas-integrations-to-core.mjs`, which:

1. Reads rows from QM `canvas_integrations` (or the backup table if already renamed)
2. Decrypts each `api_key` with **QM** `ENCRYPTION_KEY`
3. Re-encrypts with **Core** `ENCRYPTION_KEY` (documented as a separate key in [`docs/ENVIRONMENT.md`](ENVIRONMENT.md))
4. Inserts into Core `canvas_integrations` only when Core has no row for that `userId`

Dry-run: `npm run db:migrate:canvas-to-core -w question-maker-backend -- --dry-run`

After verifying Core rows, ops may `DROP TABLE canvas_integrations_pre_core_backup` on the QM database. Leaving the backup is safe; dropping it is irreversible.

### Deploying a branch

s378 serves **built** assets. `git pull` alone no longer changes what the sites serve, and neither does restarting a unit — every deploy has to rebuild:

```bash
bash infra/s378/go-live-build.sh --only core
bash infra/s378/go-live-build.sh --only aitutor
bash infra/s378/go-live-build.sh --only qm
bash infra/s378/go-live-build.sh --no-restart
```

The script enforces the one ordering that matters: **env → generate → migrate → build → restart**.
`go-live-env.sh` writes the `VITE_*` public URLs, and those are baked into the bundle at build time rather than read at startup, so running it after a build ships the previous run's URLs.

Builds run with `NODE_ENV=development` so s378 stays a development environment — `import.meta.env.DEV` branches survive, and Core's `isProd` gates (HSTS, strict nonce CSP) stay off.

### Process management

Four system units under `infra/s378/systemd/`, owned by the `eduai-dev` group:

| Unit | Process |
|---|---|
| `eduai-core.service` | Core on `3000` (SSR, `react-router-serve`) |
| `eduai-cron-worker.service` | Dedicated Core cron scheduler and shell-job worker |
| `eduai-aitutor-server.service` | AI Tutor API on `4000` |
| `eduai-qm-backend.service` | Question Maker API on `8000` |
| `eduai-dev.target` | All four services |

Both extension frontends build to static files (`ssr: false`) and are served directly by Apache, so they have no unit and no port of their own.

One-time installation (needs sudo):

```bash
sudo bash infra/s378/go-live-systemd-install.sh
```

That installs the units to `/etc/systemd/system`, the shared env file to `/etc/eduai/`, and a polkit rule scoped to `eduai-*` units. No `loginctl enable-linger` — system units survive logout and reboot on their own. Day-to-day service operations need no sudo.

The exact aliases and flags are maintained in the script and its runbook. The
`--install` flag is idempotent setup for the host's systemd/polkit/cron support; it
does not replace the build and verification steps.

### Shared-development health checks

Use the service-local endpoints when diagnosing a unit, then verify the public
vhost:

```bash
curl -fsS http://127.0.0.1:3000/api/health
curl -fsS http://127.0.0.1:4000/api/health
curl -fsS http://127.0.0.1:8000/healthz
curl -fsSI https://dev.eduai.ok.ubc.ca/
curl -fsSI https://dev.aitutor.eduai.ok.ubc.ca/
curl -fsSI https://dev.questionmaker.eduai.ok.ubc.ca/
systemctl --no-pager --full status eduai-core eduai-cron-worker eduai-aitutor-server eduai-qm-backend
```

The Question Maker health route is `/healthz`; `/api/health` is the Core and AI
Tutor route. A successful HTTP response does not prove that inference, database
migrations, authentication, or background jobs are configured correctly.

### Service operation notes

After deploying a change to `infra/cron/*.sh`, `go-live-build.sh` synchronizes those scripts into `/opt/eduai/cron` before restarting the worker. For a one-time upgrade from the old three-unit layout, run `bash infra/s378/go-live-systemd-install.sh` first; it creates the dedicated `eduai-cron` account, directories, env permissions, and worker unit.

Restarting picks up a changed server-side `.env`, but a changed `VITE_`-prefixed value needs a full rebuild. Never start an app with `npm run dev` on s378 — it binds the same port the unit holds.

`go-live-env.sh` copies the Core `EDUAI_API_KEY` into the AI Tutor and Question Maker env files and sets their public URLs. The canonical script and operational notes live in [`infra/s378/GO-LIVE.md`](../infra/s378/GO-LIVE.md).

## Inference fleet

The current Qwen deployment contract uses these served model IDs:

- small tier: `qwen3.5-2b-instruct`
- large tier: `qwen3.5-9b-instruct` where that tier is installed
- Assist Auto: `qwen3.8-27b-instruct` on CMPS02

The fleet is intentionally heterogeneous. As verified on 2026-09-02, all three
authenticated port-8001 edges were healthy:

| Host | Served models observed | Authenticated port-8001 result / role |
| --- | --- | --- |
| CMPS01 | Qwen 3.5 2B, Qwen 3.5 9B, `mxbai-embed-large` | HTTP 200; small, large, and embedding capacity |
| CMPS02 | Qwen 3.5 2B, Qwen 3.8 27B | HTTP 200; small tier and Assist Auto |
| CMPS03 | Qwen 3.5 2B, Qwen 3.5 9B | HTTP 200; small and large tiers |

CMPS02 does not advertise `qwen3.5-9b-instruct` by design. A fleet smoke run may
therefore print a warning when checking the global large-tier expectation; that
warning is not a host-health failure. Host-scoped model declarations should match
the models each server actually advertises.

On this DB-less LiteLLM edge, `HTTP 400 no_db_connection` / `No connected db.`
can be a misleading authentication-path error when the proxy's `master_key`
does not match Core's `VLLM_API_KEY`. Check key alignment before provisioning or
debugging a database. Never print the key while checking it.

The port-8001 edge is authenticated. Never put the shared inference key in a
document, command history, browser URL, or client-side bundle. See
[`infra/inference/README.md`](../infra/inference/README.md) for the fleet contract
and [`infra/cmps01/README.md`](../infra/cmps01/README.md) for the host-level proxy
and model deployment procedure.

## Backups and scheduled work

Core's production scheduler and the s378 `eduai-cron-worker` are distinct from
the standalone scripts in `infra/cron/`. The scripts back up the Core, AI Tutor,
and Question Maker databases, apply retention, and support off-site copies. They
do not create a system crontab by themselves. See
[`infra/cron/README.md`](../infra/cron/README.md) for installation, environment
files, schedules, and restore considerations.

Before a migration or release, confirm that a recent backup exists and that the
backup destination is writable. A backup job completing successfully does not
prove that a restore has been tested.

### Async AI-job worker — currently disabled

> **Do not deploy this worker.** The BullMQ AI-job queue is **hard-disabled pre-MVP**, in code, not by configuration. `npm run queue:worker` calls `assertAiJobQueueEnabled()` and exits *before* it constructs Prisma, Redis, or any BullMQ worker. On the producer side, `isEnqueueRequested()` ignores `QUEUE_ENQUEUE_ENABLED` entirely — setting it to `true` changes nothing, and `POST /api/chat` always takes the direct-chat path. Re-enabling requires a reviewed code change once owner-scoped job status/cancellation and server-side model authorization exist.

The design below describes the intended contract so the variables in `.env.example` are legible; none of it is live today.

```bash
cd apps/core
npm run queue:worker   # exits immediately: "AI job queue is disabled"
```

When enabled, the process would consume `ai-jobs-chat` and `ai-jobs-heavy`, claim the authoritative `AiJob` row, route inference through the matching fleet pool, and write `COMPLETED` or `FAILED`, with graceful `SIGINT`/`SIGTERM` shutdown before disconnecting Redis.

| Variable | Status | Purpose |
| -------- | ------ | ------- |
| `REDIS_URL` | **active** | Also backs the shared `/api/chat` + `/api/completion` sliding-window rate limits, which *are* live |
| `QUEUE_ENQUEUE_ENABLED` | **ignored** | Legacy flag; the producer does not read it |
| `AI_JOB_DEFAULT_MODEL` | dormant *(one live use)* | Reserved for worker model authorization — but it is also step 2 of `TOPIC_ANALYSIS_MODEL`'s fallback chain, so it does affect in-process topic analysis |
| `AI_JOB_CHAT_CONCURRENCY` | dormant | Chat-pool worker concurrency (default `8`) |
| `AI_JOB_HEAVY_CONCURRENCY` | dormant | Heavy-pool worker concurrency (default `1`) |
| `AI_JOB_EXECUTION_TIMEOUT_MS` | dormant | Per-attempt provider timeout in milliseconds (default `120000`) |
| `AI_JOB_ATTEMPTS` | dormant | Total BullMQ attempts per job (default `3`) |
| `AI_JOB_RETRY_DELAY_MS` | dormant | Exponential retry base delay (default `5000`) |

Redis itself **is** required in every environment for rate limiting, so keep the container or service running even though the queue is off.

### Apache reverse proxy

The checked-in vhost templates are:

- `infra/s378/dev.aitutor.eduai.ok.ubc.ca.conf`
- `infra/s378/dev.questionmaker.eduai.ok.ubc.ca.conf`

Core's existing vhost proxies `dev.eduai.ok.ubc.ca` to `127.0.0.1:3000`. The two extension vhosts are split: `/api/` is proxied to the backend, and everything else is served as static files from the build output with `FallbackResource /index.html` for SPA routing. Install or refresh them with:

```bash
bash infra/s378/go-live-apache.sh
```

The script installs from the repo (not `~/dev-vhosts/`), backs up the previous conf to `.bak.<timestamp>`, runs `httpd -t`, and restores the backup if the config fails to validate.

`mod_headers` is required for the `Cache-Control` blocks. `mod_proxy_wstunnel` is no longer needed — there is no HMR websocket to upgrade. Core records the rightmost `X-Forwarded-For` value, so the production security model assumes exactly one trusted reverse proxy and no direct public access to Node.

### Campus inference

Configure Core on s378 to use the cmps01 HTTP endpoints:

```env
OLLAMA_BASE_URL="http://cmps01.ok.ubc.ca:11434"
VLLM_BASE_URL="http://cmps01.ok.ubc.ca:8001"
VLLM_API_KEY="<same value as cmps01's CMPS01_INTERNAL_KEY>"
```

`VLLM_API_KEY` must be a real generated secret (`openssl rand -hex 32`), not the `vllm-local` placeholder — as soon as `VLLM_BASE_URL` points at cmps01, Core refuses to fall back to `vllm-local` even though s378 runs `NODE_ENV=development` (see #1115).

Then restart Core and verify from `apps/core`:

```bash
systemctl restart eduai-core
npm run vllm:smoke
npm run fleet:smoke
```

For fleet variables and firewall caveats, see [`docs/rag-ai/HOW_TO_USE_DEV_SERVER.md`](rag-ai/HOW_TO_USE_DEV_SERVER.md) and [`docs/rag-ai/VLLM.md`](rag-ai/VLLM.md).

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

A public `503 Service Unavailable` on Core or an `/api/` path usually means Apache cannot reach the local process — check the matching systemd unit, its journal, and the local curl before changing proxy configuration. A `403` or `404` on one of the static sites is a different failure: the build output is missing or unreadable, so check that `go-live-build.sh` completed.

## Production deployment

Production is an architectural contract, not a single checked-in one-command deployment. Do not use `apps/core/deploy.sh` without adapting and reviewing it; it is a legacy template with host-specific placeholders and destructive Git operations.

Production uses release directories under:

```text
/srv/www/eduai-production/releases/<release-id>
/srv/www/eduai-production/current -> <release-id>
```

The checked-in production vhost templates under `infra/production/apache/` are the source of truth for the intended hostnames:

| App | Production host | Vhost template |
|---|---|---|
| Core | `https://my.eduai.ok.ubc.ca` | `infra/production/apache/my.eduai.ok.ubc.ca.conf` |
| AI Tutor | `https://aitutor.eduai.ok.ubc.ca` | `infra/production/apache/aitutor.eduai.ok.ubc.ca.conf` |
| Question Maker | `https://questionmaker.eduai.ok.ubc.ca` | `infra/production/apache/questionmaker.eduai.ok.ubc.ca.conf` |

The extensions currently still answer on legacy hosts outside the `eduai.ok.ubc.ca` cookie scope (`aitutor.ok.ubc.ca`, `questionmaker.ok.ubc.ca`). Seamless Core→extension browser authentication is **not** production-ready until IT provisions the aliases above, because Core's shared session cookie is scoped to `.eduai.ok.ubc.ca`. See [`docs/operations/PRODUCTION_DEPLOYMENT_PLAN.md`](operations/PRODUCTION_DEPLOYMENT_PLAN.md).

Each app may run on one host or separate hosts. Every public host needs TLS and a reverse-proxy upstream for its frontend and API. Keep Node ports private, preserve the original host and scheme, and configure each backend's credentialed CORS allow-list for the exact deployed origins.

Core's production `BETTER_AUTH_URL`, `COOKIE_DOMAIN`, and trusted origins must match the public domain layout. Extension `CORE_URL` values point to Core, while their browser-facing `VITE_*` values point to the public hosts. Register only redirect URLs that the implemented login flow actually uses; do not infer callback routes from the subdomain name.

The production runbook and checklist are intentionally release-oriented. They
cover dependency installation, Prisma generation, migrations, asset builds,
activation, service management, Apache configuration, health verification, and
rollback. Do not run `npm run dev`, PM2 deployment templates, or ad-hoc commands
against the active release.

The production verification checklist should always include:

- Core: `http://127.0.0.1:3000/api/health`
- AI Tutor: `http://127.0.0.1:4000/api/health`
- Question Maker: `http://127.0.0.1:8000/healthz`
- public HTTPS checks for the three production vhosts
- systemd state, recent journal output, database connectivity, and approved
  inference-edge model IDs
- queue configuration, which is currently disabled unless deliberately re-enabled

Do not report production as ready from a single HTTP check. Record the active
release ID, commit, timestamp, and any failed component in the deployment handoff.

## Troubleshooting order

1. Identify the host, active release/checkout, branch or commit, and systemd unit.
2. Check the unit journal and the service-local health endpoint.
3. Check environment presence and model IDs without printing secrets.
4. Confirm database connectivity and migration status.
5. Confirm the public vhost and Apache configuration.
6. For inference failures, test the authenticated port-8001 edge and then the
   direct backend only as a diagnostic comparison.
7. Record the observed commit, timestamp, HTTP status, and remediation owner in an
   issue or handoff. Do not turn a one-off incident into a permanent runbook step.

Store secrets outside Git, run services as an unprivileged account, and keep database and Node ports off the public interface. Production backup and lifecycle jobs are documented in [`infra/cron/README.md`](../infra/cron/README.md).

Supporting material under `infra/production/`: `README.md` (bootstrap runbook), `PROVISIONING_CHECKLIST.md` (splits non-privileged prep from interactive sudo/DB/Apache work), `preflight.sh` (read-only host/dependency/service/inference reachability check), `core.env.example` / `ai-tutor.env.example` / `question-maker.env.example` / `aitutor-db.env.example`, `systemd/` units, `apache/` vhosts, `admin-helper.sh`, and `SUDOERS_SETUP.md`.

For service-specific commands and rollback details, follow the canonical runbook
for the environment instead of duplicating them here.
