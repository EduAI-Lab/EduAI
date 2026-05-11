# AI Tutor — Deployment

This document captures the **actual** production deployment, which differs in important ways from
what a casual reading of the repo (`Dockerfile`, `docker-compose.yml`) might suggest. If you are
about to ship a change, read this end-to-end first.

For the runtime architecture (request lifecycle, auth, AI loop), see
[`docs/ARCHITECTURE.md`](ARCHITECTURE.md). For product context, see
[`SYSTEM_OVERVIEW.md`](SYSTEM_OVERVIEW.md).

---

## Production Reality

Production is **not Docker-first**. The only thing that runs in Docker is PostgreSQL. The Express
API runs as a host process under PM2, and the SPA is served as static files by Apache `httpd`.

```mermaid
flowchart TD
    Client[Browser] -->|"HTTPS, port 443"| Apache["Apache httpd<br/>(s216.ok.ubc.ca)"]
    Apache -->|"static files"| SPA["build/client/<br/>(SPA assets from bun run build)"]
    Apache -->|"reverse proxy /api/*"| PM2["PM2: aitutor-api<br/>(node src/index.js)<br/>cwd=./server, max_memory 512M"]
    PM2 -->|"DATABASE_URL"| Docker["Docker container<br/>aitutor_db (postgres:16-alpine)"]
    PM2 -->|"OIDC + LLM"| EduAI["EduAI external service"]
```

| Layer | What runs it | Source of truth |
|-------|--------------|-----------------|
| TLS / static / reverse proxy | `httpd` (system service) | server-managed Apache vhost (not in repo) |
| SPA assets | Apache document root | `bun run build` -> `build/client/` |
| API | PM2 process `aitutor-api` | [`ecosystem.config.cjs`](../ecosystem.config.cjs) |
| Database | Docker container `aitutor_db` | [`docker-compose.yml`](../docker-compose.yml) |

| Constant | Value |
|----------|-------|
| Production host | `s216.ok.ubc.ca` (URL: `aitutor.ok.ubc.ca`) |
| Repo path on host | `/srv/www/AiTutor` (hardcoded in [`deploy.sh:15`](../deploy.sh)) |
| API port | `4000` (default in `server/src/index.js`; Apache proxies to it) |
| DB host port | `54321` (mapped from container's `5432`) |
| Required SSH auth | password (per `~/.claude/.../reference_ubc_server.md`) |
| Required local privilege | passwordless `sudo` for `docker compose` and `systemctl restart httpd` |

---

## The Dockerfile Is Orphaned

The repo contains a `Dockerfile` at the root. **It is not used in production and should not be
trusted as a deployment artifact.** Specifically:

- It is **npm-based** (`npm ci`, `npm run start`) while the rest of the repo is Bun-first.
- Its final `CMD ["npm", "run", "start"]` resolves to `vite preview --outDir build/client`,
  which only serves the **frontend preview bundle**. It does not run the Express API
  (`server/src/index.js`).
- It does not run `prisma generate` or `prisma migrate deploy`.
- It does not install or run anything from `server/`.

If you need a containerized deployment in the future, this file must be rewritten from scratch.
Until then, treat it as dead code that future contributors should not "fix" by tweaking — they
should fix it by replacing it or deleting it.

---

## `deploy.sh` Walkthrough

[`deploy.sh`](../deploy.sh) is the only supported deploy entry point on the production host.
Run it from the repo root as the application user. It is idempotent and short-circuits when no
new commits exist on `main`.

```bash
cd /srv/www/AiTutor
./deploy.sh           # no-op if HEAD already matches origin/main
./deploy.sh --force   # rebuild and restart even if no new commits
```

Step by step (line numbers reference [`deploy.sh`](../deploy.sh)):

| Step | What it does | Notes |
|------|--------------|-------|
| Lock | Writes `$$` to `/tmp/deploy-aitutor.lock` and `trap`s cleanup. | Guards against parallel deploys; checks `kill -0` on the recorded PID. (lines 18-38) |
| Working tree reset | `git reset --hard` then `git clean -fd --exclude=.env --exclude=server/.env`. | **Preserves the two `.env` files**; everything else gets nuked. Local edits on the server are lost. (lines 47-50) |
| Branch check | `git checkout main` + `git fetch origin`. | Branch is hardcoded to `main`. (line 14, 50-53) |
| Commit gate | Compares `origin/main` to `.last_commit`. Exits 0 if unchanged unless `--force`. | `.last_commit` lives in repo root and is written at the very end. (lines 55-66) |
| Pull | `git pull origin main`. | (line 69) |
| Install | `bun install` (root), `bun install` (server). | (lines 75-80) |
| DB up | `sudo docker compose up -d`. | Brings up the `aitutor_db` container if it isn't already running. **Requires passwordless sudo.** (lines 82-84) |
| Migrate | `bunx prisma generate && bunx prisma migrate deploy` from `server/`. | Uses `migrate deploy`, never `migrate dev`. (lines 86-91) |
| Build | `bun run build` (root). | Outputs static SPA to `build/client/`. (lines 93-95) |
| Restart API | `pm2 restart ecosystem.config.cjs --update-env` falling back to `pm2 start ecosystem.config.cjs`. Then `pm2 save`. | The `||` chain is the cold-start fallback the first time PM2 has never seen the app. (lines 97-100) |
| Pin commit | Write `LATEST_COMMIT` to `.last_commit`. | The next no-arg deploy will short-circuit until a new commit lands. (line 103) |
| Restart Apache | `sudo systemctl restart httpd`. | Kicks Apache so any new SPA assets are served fresh. (line 112) |

Failure mode: every step uses `|| { echo "..."; exit 1; }`, so any non-zero exit aborts the
deploy. The lockfile is removed via the `trap`.

---

## `ecosystem.config.cjs`

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

Things to know:

- **PM2 only manages the API.** The frontend is not under PM2 — Apache serves `build/client/`
  directly.
- **Node, not Bun, is the runtime.** `interpreter: 'node'` overrides PM2's default. The repo
  uses Bun for *tooling* (install, build, scripts), but the long-running production process is
  Node. Code that depends on Bun-only globals will break in production.
- **One instance, hard 512 MB cap.** PM2 will restart the process if RSS exceeds 512 MB.
- **`cwd: './server'`** — relative to `pm2 start ecosystem.config.cjs`'s working directory,
  which `deploy.sh` invokes from the repo root, so the effective cwd is `/srv/www/AiTutor/server`.
  `dotenv` resolves `server/.env` from that cwd.

---

## `docker-compose.yml`

[`docker-compose.yml`](../docker-compose.yml) is intentionally minimal. It manages **only the
database**:

```yaml
services:
  db:
    image: postgres:16-alpine
    container_name: aitutor_db
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: aitutor
    ports:
      - "54321:5432"
    volumes:
      - db_data:/var/lib/postgresql/data
volumes:
  db_data:
```

| Property | Value | Notes |
|----------|-------|-------|
| Image | `postgres:16-alpine` | Pinned to major 16. |
| Host port | `54321` | Non-default to avoid clashing with any host-installed Postgres. The connection string in `.env` must use `54321`. |
| Volume | named `db_data` | Survives `docker compose down` but **not** `docker compose down -v`. |
| Restart policy | `unless-stopped` | Container comes back automatically after host reboot. |

App processes (API, frontend build, PM2) all run **outside** Docker.

---

## Environment Variables

All values default to local-dev sane values; production must override the secrets.

### Frontend (`.env` at repo root)

| Variable | Default | Purpose |
|----------|---------|---------|
| `VITE_API_URL` | `http://localhost:4000` | Base URL the SPA uses for `fetch('/api/...')`. Read in [`app/lib/api.ts:18`](../app/lib/api.ts). Must point at the public API origin in production (e.g. `https://aitutor.ok.ubc.ca`). |

### Backend (`server/.env`)

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | (none) | Prisma Postgres connection string. Local: `postgresql://postgres:postgres@localhost:54321/aitutor`. |
| `PORT` | `4000` | API listen port. |
| `BETTER_AUTH_SECRET` | dev placeholder; **required in prod** | HMAC secret for Better Auth sessions. The auth.js bootstrap throws if unset and `NODE_ENV=production`. |
| `BETTER_AUTH_URL` | `http://localhost:4000/api/auth` | Public URL of the Better Auth handler. |
| `COOKIE_DOMAIN` | `localhost` | Session-cookie scope. Set to `aitutor.ok.ubc.ca` in production. |
| `EDUAI_BASE_URL` | `http://localhost:5174/api` | Base URL for EduAI's chat endpoint (used by `eduaiClient.js`). |
| `EDUAI_API_KEY` | (none) | Optional server-wide fallback API key. Overridden at runtime by the `EDUAI_API_KEY` row in `SystemSetting` if set via the admin UI. |
| `EDUAI_MODEL` | `google:gemini-2.5-flash` | Default model id passed to EduAI when the request body omits one. |
| `AI_SUPERVISOR_ENABLED` | (env example only) | Documentation hint. Runtime behavior is currently driven by the `AI_MODEL_POLICY` row, not this variable. |

EduAI OAuth values (used by `genericOAuth` in `auth.js`) — also live in `server/.env`:

| Variable | Default |
|----------|---------|
| `EDUAI_DISCOVERY_URL` | `http://localhost:5174/api/auth/.well-known/openid-configuration` |
| `EDUAI_USERINFO_URL`  | `http://localhost:5174/api/auth/oauth2/userinfo` |
| `EDUAI_CLIENT_ID`     | `aitutor-local` |
| `EDUAI_CLIENT_SECRET` | `aitutor-local-secret` |

> No `JWT_SECRET` is required by the current auth flow. If it is set, `auth.js` will accept it as
> a secondary fallback for `BETTER_AUTH_SECRET`, but new deployments should set `BETTER_AUTH_SECRET`
> explicitly.

---

## Test Database Convention

The backend test suite uses a **separate** Postgres database to keep developer dev data intact.

[`server/.env.test`](../server/.env.test):

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:54321/aitutor_test"
BETTER_AUTH_SECRET="test-secret-not-for-production"
BETTER_AUTH_URL="http://localhost:4000/api/auth"
COOKIE_DOMAIN="localhost"
PORT=4001
```

Notes:

- **Same Postgres container, different database name.** Both `aitutor` and `aitutor_test` live
  in the single `aitutor_db` container on port `54321`.
- **`PORT=4001`** so an integration test that boots the API does not collide with a developer's
  `bun run dev` on `:4000`.
- **Tests must not run in parallel against the same DB.** [`server/vitest.config.js`](../server/vitest.config.js)
  sets `fileParallelism: false` and `pool: 'forks'` for this reason. If you change the runner
  config to enable parallelism, you must also rework the test setup to give each worker its own
  schema or database — otherwise tests will see each other's data.

Run with:

```bash
cd server
bun run test
```

---

## The Dual Lockfile Situation

Both the root and `server/` contain **two lockfiles each**: `bun.lock` *and* `package-lock.json`.
This is intentional but confusing.

| Tool that uses which | Where |
|----------------------|-------|
| `bun install` (developers, `deploy.sh`, README, `CONTRIBUTING.md`) | `bun.lock` |
| `npm ci` (the orphaned `Dockerfile`) | `package-lock.json` |

The README and `CONTRIBUTING.md` both say "use Bun". `deploy.sh` uses Bun. `package.json`
scripts assume Bun-style execution. The npm lockfiles exist purely so that the orphaned
`Dockerfile` build does not fail.

**If you delete the `Dockerfile`**, you should also delete both `package-lock.json` files to
remove the inconsistency. Until then:

- Add new dependencies with `bun add ...`. Do not run `npm install`.
- If you regenerate `package-lock.json` for any reason, regenerate `bun.lock` in the same commit
  so they cannot drift independently.

---

## Smoke-Test Checklist (post-deploy)

1. `curl https://aitutor.ok.ubc.ca/api/health` -> `{"ok":true}`.
2. Sign in via EduAI, confirm role-appropriate landing page renders.
3. `pm2 status` shows `aitutor-api` `online`, restart count not climbing.
4. `sudo docker ps` shows `aitutor_db` `Up (healthy)`.
5. `sudo systemctl status httpd` shows `active (running)`.
6. Open an activity, send a `teach` message, confirm response renders (validates EduAI auth +
   per-user API key path end-to-end).
