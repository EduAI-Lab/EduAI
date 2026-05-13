# PR: Dockerize monorepo and centralize dev/prod orchestration

**Branch:** `chore/dockerize-monorepo`
**Base:** `development`

## Summary

Adds Docker Compose configurations and root-level npm scripts to orchestrate all three EduAI platform apps (Core, AI Tutor, Question Maker) from a single location. This enables:

- **One-command dev startup** — databases-only or fully containerized
- **One-command production builds** — all apps built and served via Docker
- **Per-app native dev** — run any single app without Docker overhead
- **Consistent `.env` architecture** — each app has its own `.env` at the path it expects, with audited `.env.example` templates
- **No port conflicts** — each frontend has a unique dev port

## Port assignments


| Service               | Dev port  | Notes                        |
| --------------------- | --------- | ---------------------------- |
| Core (frontend + SSR) | **5173**  | Vite default; the "main" app |
| AI Tutor frontend     | **5174**  | Set in `vite.config.ts`      |
| AI Tutor backend      | **4000**  | Express API                  |
| QM frontend           | **5176**  | Set in `vite.config.ts`      |
| QM backend            | **8000**  | Express API                  |
| core-db (PostgreSQL)  | **5432**  | Docker: `core-db`            |
| tutor-db (PostgreSQL) | **54321** | Docker: `tutor-db`           |
| qm-db (PostgreSQL)    | **55432** | Docker: `qm-db`              |


All frontends previously defaulted to 5173 and would conflict. Fixed by assigning unique ports in each app's Vite config.

## What changed

### New files at monorepo root


| File                      | Purpose                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------- |
| `package.json`            | Root orchestrator — `dev:*`, `docker:*`, `build:*`, `start:*`, `install:*` scripts            |
| `docker-compose.dev.yml`  | Development stack: 3 databases + optional app containers with volume mounts for HMR           |
| `docker-compose.prod.yml` | Production stack: all apps built via multi-stage Dockerfiles, no databases (assumed external) |
| `.env.example`            | Documents Docker Compose port overrides only — per-app config lives in per-app `.env` files   |
| `.dockerignore`           | Expanded to cover all editor/AI tool dirs and build artifacts                                 |


### New/updated Dockerfiles


| File                                                     | Change                                                                       |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `apps/core/Dockerfile`                                   | Added Prisma schema copy to prod-deps stage, Prisma-safe production install, healthcheck |
| `apps/extensions/ai-tutor/Dockerfile`                    | Switched from `vite preview` to `nginx:alpine` for SPA serving in production |
| `apps/extensions/ai-tutor/server/Dockerfile`             | **New** — multi-stage Node 20 Alpine build for the Express API               |
| `apps/extensions/ai-tutor/server/.dockerignore`          | **New**                                                                      |
| `apps/extensions/question-maker/app/backend/Dockerfile`  | Unchanged (already production-ready)                                         |
| `apps/extensions/question-maker/app/frontend/Dockerfile` | Unchanged (already nginx-based)                                              |


### Deleted files (cleanup)


| File                                                    | Reason                                                                                         |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `apps/extensions/ai-tutor/docker-compose.yml`           | Replaced by root `docker-compose.dev.yml`                                                      |
| `apps/extensions/question-maker/docker-compose.yml`     | Replaced by root `docker-compose.prod.yml`                                                     |
| `apps/extensions/question-maker/docker-compose.dev.yml` | Replaced by root `docker-compose.dev.yml`                                                      |
| QM `package.json` Docker scripts                        | Removed `dev:up`, `dev:down`, `dev:build`, `prod:up`, `prod:down` — superseded by root scripts |


### Port conflict fixes


| File                                                         | Change                                      |
| ------------------------------------------------------------ | ------------------------------------------- |
| `apps/extensions/ai-tutor/vite.config.ts`                    | Added `server: { port: 5174 }`              |
| `apps/extensions/question-maker/app/frontend/vite.config.ts` | Changed hardcoded port from `5173` → `5176` |


### `.env.example` audit & updates

Each app's `.env.example` was audited against actual `process.env` / `import.meta.env` usage in source code:


| App                 | Vars missing from `.env.example`                                                          | Action            |
| ------------------- | ----------------------------------------------------------------------------------------- | ----------------- |
| **Core**            | `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENAI_API_KEY`, `ROUTER_AUTO_DEFAULT`, `EDU_AI_API_KEY` | Added to template |
| **AI Tutor server** | `EDUAI_USERINFO_URL`, `JWT_SECRET` (fallback)                                             | Added to template |
| **QM**              | `DOCKER`, `COMPOSE_PROJECT_NAME` (Docker-injected, not user-configured)                   | No change needed  |


Additional `.env.example` fixes:

- **Core**: Removed misleading `PORT="5173"` (Vite ignores this in dev; production Dockerfile hardcodes port 3000). Fixed `OLLAMA_BASE_URL` from port 11435 → 11434 to match all codebase defaults.

### Other changes

- **AI Tutor server `package.json`**: Replaced `bunx` with `npx` in `dev`, `start`, `seed` scripts for cross-platform compatibility (Bun not available on all dev machines)
- **Core `package.json`**: Added `postinstall: "prisma generate"` so Prisma client is auto-generated after `npm install`
- **Core Dockerfile**: Changed the production dependency stage to run `npm ci` before `npm prune --omit=dev`, so the `prisma` CLI is available for `postinstall` generation but omitted from the final production dependency set

## Environment architecture

```
.env                                    → Docker Compose port overrides only
apps/core/.env                          → Core config (DATABASE_URL, BETTER_AUTH_*, OLLAMA_*, etc.)
apps/extensions/ai-tutor/server/.env    → Tutor server config (DATABASE_URL, EDUAI_*, BETTER_AUTH_*, etc.)
apps/extensions/question-maker/.env     → QM config (DATABASE_URL, JWT_SECRET, CORS_ORIGINS, etc.)
```

Each app uses `DATABASE_URL` pointing to a **different database** — a single unified `.env` is not possible without renaming variables and modifying app source code.

## Startup workflow (per-app)

Goal scripts follow one pattern: `**dev:<service>`** brings up the right databases, runs migrations where needed, then starts apps. Split when you already have databases running or only want one layer:


| Script              | What it does                                                                |
| ------------------- | --------------------------------------------------------------------------- |
| `dev:<service>`     | DB(s) for that slice + migrate (if applicable) + app(s)                     |
| `dev:<service>:db`  | Docker DB containers only (`--wait` on healthchecks)                        |
| `dev:<service>:app` | App process(es) only (assumes DB already up; Tutor includes Core for OAuth) |


### Prerequisites for all apps

```bash
npm run install:all             # Install root + all app dependencies
```

### 1. EduAI Core

```bash
npm run dev:core                # core-db + migrate + Core (http://localhost:5173)
# or step-by-step:
npm run dev:core:db && npm run db:migrate:core && npm run dev:core:app
```

- **Login**: Create account at the sign-up page, or use seeded credentials after `npm run db:seed:core`
- **Common error**: `Can't reach database server at localhost:5432` → run `npm run dev:core:db` or `npm run docker:dev:db`.

### 2. AI Tutor (Core is started for you)

```bash
npm run dev:tutor               # core-db + tutor-db + migrate both + Core + Tutor FE/BE
```

- **URLs**: Core `http://localhost:5173`, Tutor FE `http://localhost:5174`, Tutor BE `http://localhost:4000`
- **Login**: Redirects to Core for OAuth (OIDC/PKCE). Requires `EDUAI_CLIENT_ID` and `EDUAI_CLIENT_SECRET` to be registered in Core's OAuth provider config.
- **Common error**: `Invalid callbackURL` → The callback URL the tutor sends isn't registered in Core. Core must have an OAuth client configured for AI Tutor with the correct redirect URI (`http://localhost:5174/...`).
- **App only** (DBs already running): `npm run dev:tutor:app` — starts Core + Tutor together so discovery/OAuth still works.

### 3. Question Maker (independent auth, doesn't need Core running)

```bash
npm run dev:qm                  # qm-db + QM FE/BE (http://localhost:5176 / :8000)
```

- **Login**: Uses its own JWT auth (not Core's). Create an account through the QM sign-up page.
- **Common error**: `SequelizeConnectionRefusedError` on port 55432 → database container isn't running. Run `npm run dev:qm:db` or `npm run docker:dev:db`.
- **Note**: `EDUAI_API_KEY` must be set in `question-maker/.env` to enable course sync and AI features that call Core's API.
- This setup is subject to change with auth to be updated 

## npm scripts reference

### Development (native — databases in Docker, apps on host)

```bash
npm run docker:dev:db          # All three DBs (waits for healthchecks)
npm run docker:dev:db:core     # core-db only
npm run docker:dev:db:tutor    # core-db + tutor-db (Tutor slice)
npm run docker:dev:db:qm      # qm-db only

npm run dev:core               # core-db + migrate + Core on :5173
npm run dev:core:db            # core-db only
npm run dev:core:app           # Core dev server only

npm run dev:tutor              # DBs + migrate + Core + Tutor FE/BE
npm run dev:tutor:db           # core-db + tutor-db only
npm run dev:tutor:app          # Core + Tutor FE + Tutor BE (no Docker / migrate)

npm run dev:qm                 # qm-db + QM FE/BE
npm run dev:qm:db              # qm-db only
npm run dev:qm:app             # QM FE + BE only

npm run dev                    # All DBs + migrate core/tutor + all five app processes
```

`docker compose up --wait` requires a recent Docker Compose v2 (healthchecks are defined on the DB services).

### Development (fully containerized)

```bash
npm run docker:dev             # All databases + all apps in containers (volume-mounted)
npm run docker:dev:build       # Same but force-rebuild images
npm run docker:dev:down        # Stop everything
```

### Production

```bash
npm run docker:prod            # Build and start all production containers
npm run docker:prod:down       # Stop production stack
npm run docker:prod:logs       # Tail production logs
```

### Utilities

```bash
npm run install:all            # Install dependencies for all apps
npm run install:core           # Install Core only
npm run install:tutor          # Install AI Tutor frontend + server
npm run install:qm             # Install QM frontend + backend
npm run db:migrate:core        # Run Core Prisma migrations
npm run db:seed:core           # Seed Core database
```

## Dependency on running services


| App                | Requires                                                                       |
| ------------------ | ------------------------------------------------------------------------------ |
| **Core**           | PostgreSQL with pgvector (`core-db` on port 5432)                              |
| **AI Tutor**       | PostgreSQL (`tutor-db` on port 54321) + **Core running on :5173** (OAuth/OIDC) |
| **Question Maker** | PostgreSQL (`qm-db` on port 55432)                                             |


AI Tutor's Better Auth plugin fetches Core's OIDC discovery URL on startup. If Core isn't running, the tutor backend logs `ECONNREFUSED` errors from the OAuth flow — the server still starts but auth won't work until Core is available.

## How to test

1. **Start databases:**
  ```bash
   npm run docker:dev:db
  ```
2. **Core (verify login works):**
  ```bash
   npm run dev:core
   # Open http://localhost:5173 — should see login page
   # Create an account or use seeded credentials
  ```
3. **QM (verify independent auth):**
  ```bash
   npm run dev:qm
   # Open http://localhost:5176 — should see QM login page
   # Backend API should respond at http://localhost:8000
  ```
4. **AI Tutor (verify OAuth flow):**
  ```bash
   npm run dev:tutor
   # Open http://localhost:5174 — should redirect to Core for login
   # Requires OAuth client registered in Core
  ```
5. **All at once (verify no port conflicts):**
  ```bash
   npm run dev
   # All 5 services should start without port errors
  ```
6. **Production build validation:**
  ```bash
   docker compose -f docker-compose.prod.yml config --quiet  # should exit 0
  ```

## Known limitations

- **Windows + Prisma (`EPERM` on `query_engine-windows.dll.node`)**: Another Node process (Core, Tutor backend, IDE, or a previous dev server) can lock the Prisma engine while `prisma generate` renames it. Stop other dev terminals that run Core or Tutor, then retry. Goal scripts `dev:tutor` and `dev` run `prisma migrate deploy` for Core then Tutor (each step runs `generate` for that app only, in sequence, before servers start).
- **Ports 5173 / 5174 / 4000**: `npm run dev:tutor` expects Core on **5173** and Tutor FE on **5174** (OAuth redirects). If Question Maker or another app already uses those ports, Vite is configured with `strictPort: true` so the command fails fast instead of picking another port and breaking auth.
- **Port conflicts on Windows**: Port 54321 (tutor-db default) may fall in a Windows reserved range. Override via `TUTOR_DB_PORT` in root `.env`.
- **AI Tutor peer deps**: `npm install` for AI Tutor requires `--legacy-peer-deps` due to Vite 8 vs React Router's Vite 7 peer requirement.
- **Bun not required**: AI Tutor server scripts were changed from `bunx` to `npx`. If the team wants to restore Bun usage, install Bun on all dev machines first.
- **AI Tutor OAuth**: Requires OAuth client registration in Core before login works. The `EDUAI_CLIENT_ID` and `EDUAI_CLIENT_SECRET` in the tutor's `.env` must match a client configured in Core's Better Auth OAuth provider.
- **Slow “Sign in with EduAI” (multi‑second pause before redirect)**: The Tutor API calls Core at `http://localhost:5173` for OIDC discovery. On Windows, `localhost` can resolve to IPv6 first; the Tutor server sets **IPv4-first DNS** at startup to avoid long stalls. If it is still slow, confirm Core is up, then in DevTools → Network watch `POST …/api/auth/sign-in/oauth2` (Tutor `:4000`) — if it hangs, Core may be unreachable from that process (firewall, wrong port, or Core not started).

## Follow-up & delegation (help wanted)

**Status today**

- **EduAI Core** — Compose-backed dev DBs, production Dockerfile, and goal scripts are in place; **email/password login has been verified** in native dev.
- **Question Maker** — Same orchestration pattern; **login has been verified** (JWT; independent of Core).
- **AI Tutor** — `npm run dev:tutor` brings up Core + Tutor FE/BE and applies migrations, but **“Sign in with EduAI” (OAuth/OIDC through Core) still needs a dedicated owner** for reliable day-one setup: OAuth client registration in Core, redirect URIs vs fixed ports (5173/5174), and any remaining Windows or Prisma friction.

**Next owner — suggested scope**

1. **AI Tutor OAuth** — Make Tutor login reproducible from docs alone (exact Core Better Auth / OAuth client steps, optional seed or admin checklist). Consider promoting `scripts/e2e/oauth-matrix.sh` (or equivalent) in CI once stable.
2. **Testing via Docker Compose** — Add **opt-in** Compose profiles or `docker compose run --rm …` recipes so Vitest (and other suites) can run in containers for parity with CI, without slowing default `docker compose up`. Document the one-liner in this file once added.
3. **Full native stack** — Re-verify `npm run dev` (five processes) with a clean port layout; tighten docs if anything still confuses new contributors.

If you pick this up, use this document as the source of truth, reproduce `npm run dev:tutor`, and ship follow-up PRs against `development`.

**Tracking:** [EduAI-Lab/EduAICore#126](https://github.com/EduAI-Lab/EduAICore/issues/126) — AI Tutor OAuth login + Compose-based test harness.

