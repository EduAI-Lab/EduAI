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

| Service | Dev port | Notes |
|---------|----------|-------|
| Core (frontend + SSR) | **5173** | Vite default; the "main" app |
| AI Tutor frontend | **5174** | Set in `vite.config.ts` |
| AI Tutor backend | **4000** | Express API |
| QM frontend | **5176** | Set in `vite.config.ts` |
| QM backend | **8000** | Express API |
| core-db (PostgreSQL) | **5432** | Docker: `core-db` |
| tutor-db (PostgreSQL) | **54321** | Docker: `tutor-db` |
| qm-db (PostgreSQL) | **55432** | Docker: `qm-db` |

All frontends previously defaulted to 5173 and would conflict. Fixed by assigning unique ports in each app's Vite config.

## What changed

### New files at monorepo root

| File | Purpose |
|------|---------|
| `package.json` | Root orchestrator — `dev:*`, `docker:*`, `build:*`, `start:*`, `install:*` scripts |
| `docker-compose.dev.yml` | Development stack: 3 databases + optional app containers with volume mounts for HMR |
| `docker-compose.prod.yml` | Production stack: all apps built via multi-stage Dockerfiles, no databases (assumed external) |
| `.env.example` | Documents Docker Compose port overrides only — per-app config lives in per-app `.env` files |
| `.dockerignore` | Expanded to cover all editor/AI tool dirs and build artifacts |

### New/updated Dockerfiles

| File | Change |
|------|--------|
| `apps/core/Dockerfile` | Added Prisma schema copy to prod-deps stage, healthcheck, non-root setup |
| `apps/extensions/ai-tutor/Dockerfile` | Switched from `vite preview` to `nginx:alpine` for SPA serving in production |
| `apps/extensions/ai-tutor/server/Dockerfile` | **New** — multi-stage Node 20 Alpine build for the Express API |
| `apps/extensions/ai-tutor/server/.dockerignore` | **New** |
| `apps/extensions/question-maker/app/backend/Dockerfile` | Unchanged (already production-ready) |
| `apps/extensions/question-maker/app/frontend/Dockerfile` | Unchanged (already nginx-based) |

### Deleted files (cleanup)

| File | Reason |
|------|--------|
| `apps/extensions/ai-tutor/docker-compose.yml` | Replaced by root `docker-compose.dev.yml` |
| `apps/extensions/question-maker/docker-compose.yml` | Replaced by root `docker-compose.prod.yml` |
| `apps/extensions/question-maker/docker-compose.dev.yml` | Replaced by root `docker-compose.dev.yml` |
| QM `package.json` Docker scripts | Removed `dev:up`, `dev:down`, `dev:build`, `prod:up`, `prod:down` — superseded by root scripts |

### Port conflict fixes

| File | Change |
|------|--------|
| `apps/extensions/ai-tutor/vite.config.ts` | Added `server: { port: 5174 }` |
| `apps/extensions/question-maker/app/frontend/vite.config.ts` | Changed hardcoded port from `5173` → `5176` |

### `.env.example` audit & updates

Each app's `.env.example` was audited against actual `process.env` / `import.meta.env` usage in source code:

| App | Vars missing from `.env.example` | Action |
|-----|----------------------------------|--------|
| **Core** | `GOOGLE_GENERATIVE_AI_API_KEY`, `OPENAI_API_KEY`, `ROUTER_AUTO_DEFAULT`, `EDU_AI_API_KEY` | Added to template |
| **AI Tutor server** | `EDUAI_USERINFO_URL`, `JWT_SECRET` (fallback) | Added to template |
| **QM** | `DOCKER`, `COMPOSE_PROJECT_NAME` (Docker-injected, not user-configured) | No change needed |

Additional `.env.example` fixes:
- **Core**: Removed misleading `PORT="5173"` (Vite ignores this in dev; production Dockerfile hardcodes port 3000). Fixed `OLLAMA_BASE_URL` from port 11435 → 11434 to match all codebase defaults.

### Other changes

- **AI Tutor server `package.json`**: Replaced `bunx` with `npx` in `dev`, `start`, `seed` scripts for cross-platform compatibility (Bun not available on all dev machines)
- **Core `package.json`**: Added `postinstall: "prisma generate"` so Prisma client is auto-generated after `npm install`

## Environment architecture

```
.env                                    → Docker Compose port overrides only
apps/core/.env                          → Core config (DATABASE_URL, BETTER_AUTH_*, OLLAMA_*, etc.)
apps/extensions/ai-tutor/server/.env    → Tutor server config (DATABASE_URL, EDUAI_*, BETTER_AUTH_*, etc.)
apps/extensions/question-maker/.env     → QM config (DATABASE_URL, JWT_SECRET, CORS_ORIGINS, etc.)
```

Each app uses `DATABASE_URL` pointing to a **different database** — a single unified `.env` is not possible without renaming variables and modifying app source code.

## Startup workflow (per-app)

### Prerequisites for all apps

```bash
npm run install:all             # Install root + all app dependencies
npm run docker:dev:db           # Start all 3 database containers
```

### 1. EduAI Core (start first — other apps depend on it)

```bash
npm run db:migrate:core         # Run Prisma migrations against core-db
npm run dev:core                # http://localhost:5173
```

- **Login**: Create account at the sign-up page, or use seeded credentials after `npm run db:seed:core`
- **Common error**: `Can't reach database server at localhost:5432` → database container isn't running. Run `npm run docker:dev:db`.

### 2. AI Tutor (requires Core running)

```bash
npm run db:migrate:tutor        # Run Prisma migrations against tutor-db
npm run dev:tutor               # Frontend: http://localhost:5174, Backend: http://localhost:4000
```

- **Login**: Redirects to Core for OAuth (OIDC/PKCE). Requires `EDUAI_CLIENT_ID` and `EDUAI_CLIENT_SECRET` to be registered in Core's OAuth provider config.
- **Common error**: `Invalid callbackURL` → The callback URL the tutor sends isn't registered in Core. Core must have an OAuth client configured for AI Tutor with the correct redirect URI (`http://localhost:5174/...`).
- **Common error**: `ECONNREFUSED` on discovery URL → Core isn't running on :5173.

### 3. Question Maker (independent auth, doesn't need Core running)

```bash
npm run dev:qm                  # Frontend: http://localhost:5176, Backend: http://localhost:8000
```

- **Login**: Uses its own JWT auth (not Core's). Create an account through the QM sign-up page.
- **Common error**: `SequelizeConnectionRefusedError` on port 55432 → database container isn't running. Run `npm run docker:dev:db`.
- **Note**: `EDUAI_API_KEY` must be set in `question-maker/.env` to enable course sync and AI features that call Core's API.

## npm scripts reference

### Development (native — databases in Docker, apps on host)

```bash
npm run docker:dev:db          # Start only databases (Core, Tutor, QM)
npm run dev:core               # Core on :5173
npm run dev:tutor              # Tutor FE on :5174, BE on :4000
npm run dev:qm                 # QM FE on :5176, BE on :8000
npm run dev                    # Start all 5 services at once (no port conflicts)
```

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

| App | Requires |
|-----|----------|
| **Core** | PostgreSQL with pgvector (`core-db` on port 5432) |
| **AI Tutor** | PostgreSQL (`tutor-db` on port 54321) + **Core running on :5173** (OAuth/OIDC) |
| **Question Maker** | PostgreSQL (`qm-db` on port 55432) |

AI Tutor's Better Auth plugin fetches Core's OIDC discovery URL on startup. If Core isn't running, the tutor backend logs `ECONNREFUSED` errors from the OAuth flow — the server still starts but auth won't work until Core is available.

## How to test

1. **Start databases:**
   ```bash
   npm run docker:dev:db
   ```

2. **Core (verify login works):**
   ```bash
   npm run db:migrate:core
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
   npm run db:migrate:tutor
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

- **Port conflicts on Windows**: Port 54321 (tutor-db default) may fall in a Windows reserved range. Override via `TUTOR_DB_PORT` in root `.env`.
- **AI Tutor peer deps**: `npm install` for AI Tutor requires `--legacy-peer-deps` due to Vite 8 vs React Router's Vite 7 peer requirement.
- **Bun not required**: AI Tutor server scripts were changed from `bunx` to `npx`. If the team wants to restore Bun usage, install Bun on all dev machines first.
- **AI Tutor OAuth**: Requires OAuth client registration in Core before login works. The `EDUAI_CLIENT_ID` and `EDUAI_CLIENT_SECRET` in the tutor's `.env` must match a client configured in Core's Better Auth OAuth provider.
