# Question Maker

Full-stack extension for course question banks and assessments (AI authoring, OCR, Canvas import/export, variant workflows).

**Auth:** no local JWT/password accounts. The browser holds the Core session cookie; the backend validates it via Core `POST /api/sessions/validate` (`app/backend/src/middleware/auth.js`).

## Develop from the monorepo root

```bash
# from repo root
npm install
npm run dev
# Question Maker only:
npx turbo run dev --filter='question-maker-*'
```

| Process | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8000 |

Env file: `apps/extensions/question-maker/.env` (from `.env.example`). `EDUAI_API_KEY` must match Core. See [root README](../../../README.md).

Nested: [Backend README](app/backend/README.md).

### Optional: Compose-only stack

`npm run dev:up` / `dev:down` / `dev:logs` remain available for a QM-centric Docker Compose workflow. Prefer the monorepo root path for normal platform development.

## Tech stack

| Layer | Technology |
|-------|------------|
| Frontend | React, Vite, React Router, Tailwind, Radix/shadcn-style UI |
| Backend | Express (ESM), Prisma, PostgreSQL |
| Auth | Core session cookie validation |
| Integrations | Core API (service key + cookie), Canvas (per-user encrypted keys) |
| Testing | Vitest (unit + integration) |

## Project structure

```text
question-maker/
├── app/backend/     # Express/Prisma API
├── app/frontend/    # Vite UI
├── docs/
├── .env.example
└── README.md
```

## Features (overview)

Question bank + variants; assessments; Core course/topic sync; Canvas import/export; OCR; AI generation via Core; bug reports.

High-level API prefixes: `/api/auth`, `/api/course`, `/api/questions`, `/api/assessments`, `/api/eduai`, `/api/canvas`, `/api/assessment-variant`, `/api/bug-reports`, `/api/internal`.

**UI routes** include `/login`, `/courses`, `/home`, `/assessments/:id/builder`, `/assessment-variant`, `/help`, `/admin/bug-reports` (admins).

## Environment variables

Copy `.env.example` → `.env` in **this directory**. Full commented list lives in `.env.example`. Canvas API keys are **not** set here — users connect Canvas from the app.

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | QM Postgres (Docker port `55432` in monorepo dev) |
| `CORE_URL` | Yes | Core base URL for session validation |
| `EDUAI_API_KEY` | For Core S2S / AI | Must match Core |
| `EDUAI_API_URL` | For AI proxy | Core API base |
| `ENCRYPTION_KEY` | Prod / Canvas | Encrypts stored Canvas credentials |
| `CORS_ORIGINS` | Yes | Allowed browser origins |
| `EDUAI_IGNORED_COURSE_CODES` | No | Comma-separated codes hidden in the course list |
| `EDUAI_PROBE_COURSE_ID` | No | Core course CUID for AI connectivity probes (preferred over code) |
| `EDUAI_PROBE_COURSE_CODE` | No | Core course code for probes when `EDUAI_PROBE_COURSE_ID` is unset |
| `GROQ_API_KEY` | No | Direct LLM provider for question generation |
| `OPENAI_API_KEY` | No | Same |
| `DEEPSEEK_API_KEY` | No | Same |
| `DEFAULT_NUM_QUESTIONS`, `MAX_QUESTIONS` | No | AI batch limits |
| `COURSE_ACCESS_SYNC_TTL_MS` | No | Cache TTL (ms, default `60000`) for the synced Core enrollment access mirror and ADMIN catalog behind `GET /api/course` (#1206/#1410) |
| `USER_ROW_CACHE_TTL_MS`, `USER_ROW_CACHE_MAX` | No | How long (ms, default `900000`) `requireAuth` remembers that a user's local FK row exists before re-running the upsert, and the max ids held per process (default `5000`). Set either to `0` to disable the cache and upsert on every request (#1388) |
| `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX` | No | Production rate limiting |
| `BUG_REPORT_ADMIN_EMAILS` | No | Extra admin emails for bug triage (see [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md)) |
| `VITE_API_URL` | No | Default `http://localhost:8000` |
| `TEST_DATABASE_URL` | Integration tests | Optional |

**Production Compose** may use `POSTGRES_PASSWORD_PRODUCTION` (see [docker-compose.yml](docker-compose.yml)). **Automated server deploys** may use `GITHUB_TOKEN`, `GITHUB_PERSONAL_ACCESS_TOKEN`, or `PERSONAL_ACCESS_TOKEN` — see [docs/deployment/cron.md](docs/deployment/cron.md) and [docs/deployment/README.md](docs/deployment/README.md).

## Campus vLLM defaults

Question Maker’s EduAI chat / OCR / generation UIs default to the **campus vLLM** path (replacing the retired `gpt-oss:120b` Ollama model):

| Use case | Fallback model id | Notes |
| -------- | ----------------- | ----- |
| Generation / OCR / variants | `vllm:qwen2.5-32b-instruct` | Prefer the largest active campus model from Core’s `/api/ai-models` catalog when available |
| Connectivity probes (status chips) | `vllm:qwen2.5-7b-instruct` | Prefer the smallest active campus model; 20s timeout |
| Provider | `vllm` | Server-managed — no client API key. Legacy `forceProvider=ollama` still pins the campus path |

**Probe course context:** `testApiKey` no longer hardcodes `COSC 121`. Set `EDUAI_PROBE_COURSE_ID` (preferred) or `EDUAI_PROBE_COURSE_CODE` for cookie/session probes. When unset, service-key probes omit course context (Core allows course-free chat for API keys).

## Scripts

| Command | Where | Description |
|---------|-------|-------------|
| `npm run dev` | `app/backend` | API (migrate/generate/seed-if-empty + nodemon) |
| `npm run dev` | `app/frontend` | Vite UI |
| `npm test` / `test:integration` | backend or frontend | See package scripts |
| `npm run dev:up` | extension root | Optional Compose stack |
| `npm run dev:down` | extension root | Stop optional Compose stack |
| `npm run dev:logs` | extension root | Follow optional Compose logs |
| `npm run seed:production` | extension root | Seed production-style questions (see script) |

### Backend (`app/backend`)

| Command | Description |
|---------|-------------|
| `npm run dev` | API with nodemon |
| `npm start` | Production start |
| `npm test` | Unit tests |
| `npm run test:integration` | Integration tests (needs DB) |
| `npm run lint` | ESLint |
| `npm run seed:production` | Seed script |
| `npm run migrate:1072` | One-time hand-run migration: drops `courses.name`/`code` and `assessments.semester` (#1072 §4 step 10 — Core-owned, superseded by read-through). Idempotent; safe to re-run. |

### Frontend (`app/frontend`)

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build |
| `npm test` | Unit + integration Vitest suites |
| `npm run test:unit` | Frontend unit tests |
| `npm run test:integration` | Frontend integration tests |
| `npm run lint` | Lint |

## Testing

- Backend: `cd app/backend && npm test` / `npm run test:integration`
- Frontend: `cd app/frontend && npm test`
- Inventory: [`TESTS.md`](../../../TESTS.md), [docs/TEST_PLAN.md](docs/TEST_PLAN.md)

## Documentation

| Topic                               | Where                                                                                                                                                                 |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Testing (integration DB, commands)  | [docs/TEST_PLAN.md](docs/TEST_PLAN.md)                                                                                                                                |
| Architecture and workflows          | [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md)                                                                                                                    |
| Troubleshooting                     | [docs/troubleshooting/](docs/troubleshooting/) — [MONITORING_SETUP.md](docs/troubleshooting/MONITORING_SETUP.md), [PRODUCTION.md](docs/troubleshooting/PRODUCTION.md) |
| Deployment and CI/CD                | [docs/deployment/README.md](docs/deployment/README.md)                                                                                                                |
| Cron / scheduled pull on the server | [docs/deployment/cron.md](docs/deployment/cron.md)                                                                                                                    |
| CI/CD feature notes                 | [docs/features/CI-CD.md](docs/features/CI-CD.md)                                                                                                                      |

The cron-based server job may be disabled or misconfigured. If releases do not appear, see [docs/deployment/cron.md](docs/deployment/cron.md) and [docs/troubleshooting/PRODUCTION.md](docs/troubleshooting/PRODUCTION.md), or deploy manually per [docs/deployment/README.md](docs/deployment/README.md).

**In-app guide:** open `/help` after signing in.

**GitHub HTTPS:** for CI/CD or production `git pull`, use a Personal Access Token — align names with [.github/workflows/](.github/workflows/) and store secrets as in [docs/deployment/README.md](docs/deployment/README.md).

## License

MIT
