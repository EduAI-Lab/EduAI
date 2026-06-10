# EduAI Monorepo — Agent Notes

## Cursor Cloud specific instructions

### Overview

EduAI is an npm workspaces + Turborepo monorepo. Local development runs app processes on the host and Postgres in Docker (`docker-compose.dev.yml`). See root `README.md` for ports, seeded accounts, and env variables.

| Service | URL | Notes |
|---------|-----|-------|
| EduAI Core | http://localhost:3000 | Central auth + RAG chat; start here for login demos |
| AI Tutor frontend | http://localhost:3001 | OAuth via Core |
| AI Tutor server | http://localhost:4000 | Express API |
| Question Maker frontend | http://localhost:5173 | Vite/React |
| Question Maker backend | http://localhost:8000 | Express API |

### Docker

Docker must be running before `npm run dev`. On Cloud Agent VMs, `dockerd` may need a manual start if the daemon is not already up:

```bash
sudo dockerd > /tmp/dockerd.log 2>&1 &
sudo chmod 666 /var/run/docker.sock   # if you get permission denied on docker.sock
```

Compose uses `fuse-overlayfs` storage driver (see `/etc/docker/daemon.json`).

### Install & env

- Use **corepack npm** (repo pins `npm@11.12.1` in `package.json`); plain `npm` from nvm may be an older version.
- `npm install` at repo root runs `scripts/setup-env.js` (creates `.env` from `.env.example`).
- Set `BETTER_AUTH_SECRET` in `apps/core/.env` and the same `EDUAI_API_KEY` in Core, AI Tutor server, and Question Maker `.env` files before cross-app features work.
- Seeded dev login: `admin@eduai.local` / `EduAI2026!` (see `README.md` for full account list).

### Dev servers

```bash
corepack npm run dev
```

`predev` kills conflicting ports and starts all three Postgres containers, then Turborepo runs every app's `dev` script. First run applies Prisma migrations and seeds Core + AI Tutor DBs.

Run a single app: `npx turbo run dev --filter=edu-ai`

### Lint / test / build

| Command | Scope |
|---------|-------|
| `corepack npm run lint` | All apps (AI Tutor oxlint currently has 1 pre-existing error) |
| `corepack npm run test:eduai:unit` | Core unit tests in Docker |
| `corepack npm run test:all` | Full unit + integration suite in Docker |
| `corepack npm run build -- --filter=edu-ai` | Build one app via Turbo filter |

Tests and DB-backed integration runs use `docker-compose.test.yml`; dev DBs use `docker-compose.dev.yml`.

### Gotchas

- EduAI Core login page can show a React context error on the very first load after cold start; a browser refresh usually fixes it.
- AI features (chat, embeddings, question generation) need provider API keys or a local Ollama instance; auth and navigation work without them.
- AI Tutor extension-specific conventions live in `apps/extensions/ai-tutor/AGENTS.md`.
