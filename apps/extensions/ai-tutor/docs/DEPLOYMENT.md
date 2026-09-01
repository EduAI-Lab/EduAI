# AI Tutor — Deployment

This document captures the **actual** production deployment, which differs in important ways from
what a casual reading of the repo (`Dockerfile`, `docker-compose.yml`, `deploy.sh`) might suggest.
The repo currently contains **two** deployment mechanisms for this app, from two different eras,
and this doc calls out which one is current. If you are about to ship a change, read this
end-to-end first.

For the runtime architecture (request lifecycle, auth, AI loop), see
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md). For product context, see
[`SYSTEM_OVERVIEW.md`](SYSTEM_OVERVIEW.md).

---

## Two deployment generations — which one is live

- **`infra/production/`** (repo-root level, shared with Core and Question Maker) is the newer,
  release-based mechanism: a `git worktree` checkout of `origin/main` per release under
  `/srv/www/eduai-production/releases/<commit>`, symlinked as `current`, run by a **systemd** unit
  and fronted by an **Apache** vhost. Its systemd unit for this app
  ([`infra/production/systemd/eduai-aitutor-server.service`](../../../../infra/production/systemd/eduai-aitutor-server.service))
  was added by the commit `chore(production): add AI Tutor deployment wiring` (2026-08-17), the
  most recently touched production-config file for this app in the repo.
- **[`deploy.sh`](../deploy.sh)** (this app's own root) is the older, single-host mechanism: a
  hardcoded checkout at `/srv/www/EduAI`, branch `development`, restarted via **PM2**
  (`ecosystem.config.cjs`). `infra/production/README.md` explicitly frames the newer layout as a
  **replacement** for "the existing legacy checkout" and warns not to touch that old directory
  until the replacement has passed validation — which is exactly the checkout `deploy.sh` targets.

The repo alone cannot say with certainty whether the old host has already been decommissioned or
is still running as a fallback — that is operational state outside the codebase. Treat
`infra/production/` as the authoritative, current mechanism (it is newer, and its own README
explicitly describes itself as superseding the other), and treat `deploy.sh` as legacy: don't
extend it, and confirm with whoever owns the production hosts before assuming it still runs
anything. Both are documented below because both exist in the repo today.

---

## Current production: `infra/production/`

```mermaid
flowchart TD
    Client[Browser] -->|"HTTPS, port 443"| Apache["Apache httpd<br/>aitutor.eduai.ok.ubc.ca"]
    Apache -->|"static files"| SPA["build/client/<br/>(npm run build -w ai-tutor)"]
    Apache -->|"reverse proxy /api/*"| Systemd["systemd: eduai-aitutor-server<br/>(node src/index.js, port 4000)"]
    Systemd -->|"DATABASE_URL"| DB["Dedicated PostgreSQL role/db<br/>ai_tutor_prod"]
    Systemd -->|"session validate + AI completions"| Core["EduAI Core<br/>my.eduai.ok.ubc.ca"]
```

| Layer                        | What runs it                                | Source of truth                                                                                             |
| ----------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| TLS / static / reverse proxy | Apache `httpd` (system service)              | [`infra/production/apache/aitutor.eduai.ok.ubc.ca.conf`](../../../../infra/production/apache/aitutor.eduai.ok.ubc.ca.conf) |
| SPA assets                   | Apache document root                         | `npm run build -w ai-tutor` output copied into the release, served straight from `build/client/` — no container involved |
| API                           | systemd unit `eduai-aitutor-server`          | [`infra/production/systemd/eduai-aitutor-server.service`](../../../../infra/production/systemd/eduai-aitutor-server.service) |
| Database                     | Dedicated PostgreSQL role/db `ai_tutor_prod` | provisioned per [`infra/production/README.md`](../../../../infra/production/README.md); **not** Core's database, and **not** the Docker Postgres described below |

| Constant           | Value                                                                                   |
| ------------------- | ---------------------------------------------------------------------------------------- |
| Public URL          | `https://aitutor.eduai.ok.ubc.ca`                                                       |
| Release path        | `/srv/www/eduai-production/releases/<commit>`, symlinked as `current`                    |
| API working dir     | `.../current/apps/extensions/ai-tutor/server` (from the systemd unit)                   |
| API port            | `4000` (proxied by Apache; not exposed externally)                                       |
| Deploy branch       | `main`                                                                                   |
| Env files installed | `infra/production/ai-tutor.env.example` → `/etc/eduai/eduai-aitutor.env` (API, root:eduai, mode 0640); `infra/production/ai-tutor-frontend.env` → copied to `apps/extensions/ai-tutor/.env` before the frontend build (public values only) |

Release and rollback steps (git worktree per release, `eduai-production-admin activate-release`,
health-check curls, rollback by re-activating the previous release) are documented in
[`infra/production/README.md`](../../../../infra/production/README.md) and
[`PROVISIONING_CHECKLIST.md`](../../../../infra/production/PROVISIONING_CHECKLIST.md) — that file
is the source of truth for the exact command sequence, not this doc, since it's shared across
Core, AI Tutor, and Question Maker and changes independently of this app. As of this writing that
README also describes a **locked systemd timer for continuous deployment as a design, not
something already built** — it lists the properties such a runner "must" have (refuse a dirty
checkout, never `git reset --hard` or `prisma db push`, roll back `current` on a failed health
check) rather than pointing at an existing script. Treat continuous deployment here as aspirational
until that file says otherwise.

### The root `Dockerfile`

[`Dockerfile`](../Dockerfile) exists, is current, and is **not** the broken artifact an older
version of this doc described. It's a clean multi-stage build: installs the monorepo workspace,
builds the SPA with the real `VITE_*` production hostnames as default build args, and serves the
static output through `nginxinc/nginx-unprivileged` with a `/healthz` healthcheck. It builds only
the **frontend** — it never installs or runs anything from `server/`, by design, since the API is
a separate systemd-managed process in this topology.

Even so, nothing in the documented `infra/production/` release procedure runs `docker build` for
this app — the SPA is built on the host with plain `npm run build -w ai-tutor` and served by Apache
directly from `build/client/`, not from a container. So this Dockerfile currently has no known
caller in the repo's own deploy procedure. It may exist for a different environment (a future
containerized target, or something outside this repo) that isn't documented here — that's a
question for whoever added it, not something the code answers.

---

## Legacy: `deploy.sh` (single host, PM2)

[`deploy.sh`](../deploy.sh) targets a different, older checkout: `REPO_DIR=/srv/www/EduAI`, branch
`development` (not `main`), restarted with **PM2** rather than systemd. Its own header comment
still describes the target as `/srv/www/AiTutor`, one generation further back than the
`REPO_DIR` default in the script body — the two disagree with each other, which is itself a sign
this script has drifted from whatever host it last ran against successfully.

```bash
cd /srv/www/EduAI   # or wherever this checkout actually lives — see caveat above
./deploy.sh           # no-op if HEAD already matches origin/development and no local changes exist
./deploy.sh --force   # rebuild and restart even if no new commits
```

What it does, in order (line numbers reference [`deploy.sh`](../deploy.sh)):

| Step               | What it does                                                                                                        | Notes                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Lock                | Writes `$$` to `/tmp/deploy-aitutor.lock`, `trap`s cleanup on exit.                                                  | Guards against parallel deploys via `kill -0` on the recorded PID. (lines 20-40)                                    |
| Dirty-tree guard    | **Aborts** if `git status --porcelain --untracked-files=normal` is non-empty.                                       | Fail-closed, not a destructive reset — this script does **not** run `git reset --hard` or `git clean`. (lines 49-53) |
| Branch / commit gate | `git fetch origin "$GIT_BRANCH"` (default `development`), compares `origin/$GIT_BRANCH` to `.git/last_deployed_ai_tutor`; exits 0 if unchanged and not `--force`. | (lines 55-69)                                                                                                        |
| Merge                | `git merge --ff-only "origin/$GIT_BRANCH"`.                                                                          | Fails loudly if a fast-forward isn't possible — never force-updates the branch. (line 71)                            |
| Install              | `npm ci --no-audit --no-fund` at the monorepo root.                                                                  | (line 75)                                                                                                            |
| DB up                | Requires a non-default `POSTGRES_PASSWORD` env var, runs a network-consistency check script, then `docker compose up -d` for the app's `docker-compose.yml`. | Aborts if `POSTGRES_PASSWORD` is unset or equals the literal string `postgres`. (lines 77-85)                       |
| Migrate              | `npm exec -w ai-tutor-server -- prisma generate` then `prisma migrate deploy`.                                       | Workspace-scoped, not `cd server &&`. (lines 87-90)                                                                 |
| Build                | `npm run build -w ai-tutor`.                                                                                         | Outputs static SPA to `build/client/`. (line 94)                                                                    |
| Restart API          | `pm2 restart ecosystem.config.cjs --update-env`, falling back to `pm2 start ecosystem.config.cjs` on first run; then `pm2 save`. | (lines 96-103)                                                                                                       |
| Pin commit           | Writes `LATEST_COMMIT` to `.git/last_deployed_ai_tutor`.                                                             | The next no-arg deploy short-circuits until a new commit lands. (line 106)                                          |
| Reload web server    | `sudo systemctl reload httpd`, but **only** if `RELOAD_WEB_SERVER=true` is set — it is not automatic.                | (lines 113-115)                                                                                                      |

Failure mode: every step uses `|| { echo "..."; exit 1; }`, so any non-zero exit aborts the deploy
and the lockfile is removed via the `trap`.

### `ecosystem.config.cjs`

[`ecosystem.config.cjs`](../ecosystem.config.cjs) defines exactly **one PM2 app**:

```js
{
  name: 'aitutor-api',
  cwd: './server',
  script: 'src/index.js',
  interpreter: 'node',
  instances: 1,
  autorestart: true,
  max_memory_restart: '512M',
  env: { NODE_ENV: 'production' },
}
```

PM2 only manages the API — the frontend is not under PM2, Apache serves `build/client/` directly,
same as in the newer topology. One instance, hard 512 MB restart cap. `cwd: './server'` is relative
to wherever `pm2 start ecosystem.config.cjs` is invoked from, which `deploy.sh` runs from the repo
root, so the effective cwd is `<REPO_DIR>/apps/extensions/ai-tutor/server`.

### `docker-compose.yml` (this app's own copy, Postgres only)

[`docker-compose.yml`](../docker-compose.yml) manages only a local Postgres container, distinct
from the dedicated `ai_tutor_prod` database the newer `infra/production/` mechanism provisions:

```yaml
services:
  db:
    image: postgres:16-alpine
    container_name: aitutor_db
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set to a non-default secret}
      POSTGRES_DB: aitutor
    ports:
      - '127.0.0.1:54321:5432'
    volumes:
      - db_data:/var/lib/postgresql/data
volumes:
  db_data:
```

Loopback-only port binding (`127.0.0.1:54321`), named volume survives `docker compose down` but
not `docker compose down -v`, `restart: unless-stopped` so the container comes back after a host
reboot. This is also the same compose file local development uses (see below) — in production
under the legacy `deploy.sh` path it's the one piece that does run in Docker; everything else
(API, frontend build, PM2) runs on the host.

---

## Environment variables

The full, current list of server env vars — required and optional, with defaults — is documented
in [`server/README.md`](../server/README.md) and [`server/.env.example`](../server/.env.example);
this section only calls out the production-specific values.

Production (`infra/production/ai-tutor.env.example`, installed as `/etc/eduai/eduai-aitutor.env`):
`NODE_ENV=production`, `PORT=4000`, `DATABASE_URL` pointing at the dedicated `ai_tutor_prod`
database, `CORE_URL=https://my.eduai.ok.ubc.ca`, `EDUAI_BASE_URL=https://my.eduai.ok.ubc.ca/api`,
`EDUAI_API_KEY` (must match Core's own `EDUAI_API_KEY` — this is a server-to-server trust anchor,
not something the admin-UI key override replaces), `EDUAI_ENFORCE_URL_CONSISTENCY=1`, and
`CORS_ORIGINS=https://aitutor.eduai.ok.ubc.ca` (production CORS is fail-closed when this is
unset).

Frontend build values (`infra/production/ai-tutor-frontend.env`, public-only, compiled into the
browser bundle — never put a secret here): `VITE_API_URL`, `VITE_CORE_URL`, `VITE_EDUAI_URL`,
`VITE_AI_TUTOR_URL`, and `VITE_QUESTION_MAKER_URL`, all pointing at the `*.eduai.ok.ubc.ca`
production hostnames.

There is no local Better Auth instance, OAuth client, or JWT/bearer-token config anywhere in this
app — session validation is delegated entirely to Core's `POST /api/sessions/validate` on every
request. Env var names that would suggest otherwise (`BETTER_AUTH_SECRET`, `EDUAI_CLIENT_ID`, etc.)
are not read anywhere in `server/src`.

---

## Test database convention

The backend test suite uses a **separate** Postgres database to keep developer dev data intact.

[`server/.env.test`](../server/.env.test):

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:54321/aitutor_test"
PORT=4001
```

Same Postgres container as local dev, different database name — both `aitutor` and `aitutor_test`
live in the single `aitutor_db` container on port `54321`. `PORT=4001` so an integration test that
boots the API doesn't collide with a developer's `npm run dev` on `:4000`.
[`server/vitest.config.js`](../server/vitest.config.js) sets `fileParallelism: false` and
`pool: 'forks'` so tests never run in parallel against the same database — if that ever changes,
each worker needs its own schema or database, or tests will see each other's data.

Run with:

```bash
cd server
npm run test        # unit + integration, chained
npm run test:unit
npm run test:integration
```

---

## Lockfiles

Both the monorepo root and `server/` use `package-lock.json` exclusively. Use `npm ci`/`npm install`
everywhere: local dev, CI, and both deploy paths above.

---

## Smoke-test checklist (post-deploy)

For the current (`infra/production/`) path:

1. `curl -fsS http://127.0.0.1:4000/api/health` on the host → `{"ok":true}`.
2. `curl -fsS https://aitutor.eduai.ok.ubc.ca/api/health` → `{"ok":true}`.
3. Sign in via Core, confirm a role-appropriate landing page renders.
4. `sudo systemctl is-active eduai-aitutor-server` → `active`.
5. Open an activity, send a `teach` message, confirm a response renders — this exercises Core
   session validation, the EduAI completion call, and (if configured) a per-user BYOK key
   end-to-end.

If you're instead operating the legacy `deploy.sh` host, swap steps 2 and 4 for `pm2 status`
showing `aitutor-api` `online` with a non-climbing restart count, and `sudo docker ps` showing
`aitutor_db` `Up (healthy)`.
