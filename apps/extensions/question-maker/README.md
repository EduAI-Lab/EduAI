# Question Maker

Full-stack app for building course question banks and assessments, with AI-assisted authoring, Canvas import/export, and assessment variant workflows.

## Tech stack


| Layer        | Technology                                                                   |
| ------------ | ---------------------------------------------------------------------------- |
| Frontend     | React 19, TypeScript, Vite, React Router v7, Tailwind, Radix/shadcn-style UI |
| Backend      | Node.js, Express (ESM), Prisma, PostgreSQL                                  |
| Auth         | JWT + bcrypt                                                                 |
| Integrations | EduAI API, Canvas (per-user API keys from the app UI)                        |
| Testing      | Vitest (unit + integration + frontend)                                       |


## Prerequisites

- **Node.js** 18+
- **npm**
- **Docker** + Docker Compose (recommended for Postgres + aligned URLs), or a local **PostgreSQL** instance

## Getting started

1. **Clone** the EduAICore monorepo and navigate to this app:
   ```bash
   cd apps/extensions/question-maker
   ```
2. **Environment** — copy the example file and edit values:
  ```bash
   cp .env.example .env
  ```
   See [Environment variables](#environment-variables) below. Use a `DATABASE_URL` host of `postgres` when the API runs inside Docker Compose, and `localhost` when the API runs on your machine against a local Postgres.
3. **Run with Docker Compose (dev)** — starts Postgres, backend, and frontend:
  ```bash
   npm run dev:up
  ```
   Other useful commands: `npm run dev:down`, `npm run dev:logs`, `npm run dev:build`.
4. **Run locally (two terminals)** — if you prefer npm on the host with your own Postgres:
  ```bash
   # Terminal 1 — API (http://localhost:8000)
   cd app/backend && npm install && npm run dev

   # Terminal 2 — UI (http://localhost:5173)
   cd app/frontend && npm install && npm run dev
  ```
   Point the UI at the API with `VITE_API_URL` in `.env` (default `http://localhost:8000`).

## Project structure

```text
question-maker/
├── app/
│   ├── backend/
│   │   ├── src/
│   │   │   ├── config/
│   │   │   ├── middleware/
│   │   │   ├── routes/
│   │   │   ├── schema/
│   │   │   ├── services/
│   │   │   └── utils/
│   │   └── tests/
│   └── frontend/
│       ├── src/components/
│       ├── src/contexts/
│       ├── src/hooks/
│       ├── src/pages/
│       ├── src/services/
│       ├── src/types/
│       └── src/utils/
├── docs/
├── docker-compose.yml
├── docker-compose.dev.yml
└── README.md
```

## Features (overview)

- Auth with per-user data; courses/topics from EduAI; question and variant authoring (manual + AI); OCR upload; assessment builder; Canvas export/import; variant workflow (baseline, parallel exams, rubric review); TXT/Word export; guided tour; in-app bug reports with admin triage.

High-level **API** prefixes: `/api/auth`, `/api/course`, `/api/questions`, `/api/assessments`, `/api/eduai`, `/api/canvas`, `/api/assessment-variant`, `/api/bug-reports`.

**UI routes** include `/login`, `/courses`, `/home`, `/assessments/:id/builder`, `/assessment-variant`, `/help`, `/admin/bug-reports` (admins).

## Environment variables

Copy [.env.example](.env.example) to `.env` in the **question-maker root** (`apps/extensions/question-maker/`). Canvas API keys are **not** set here — users connect Canvas from the app.


| Variable                                 | Required    | Description                                                                                |
| ---------------------------------------- | ----------- | ------------------------------------------------------------------------------------------ |
| `NODE_ENV`                               | Yes         | `development` or `production`                                                              |
| `PORT`                                   | No          | API port (default `8000`)                                                                  |
| `DATABASE_URL`                           | Yes         | PostgreSQL URL; host `postgres` in Compose, `localhost` for local API                      |
| `JWT_SECRET`                             | Yes         | Secret for signing JWTs                                                                    |
| `JWT_EXPIRES_IN`                         | No          | Token lifetime (default `24h`)                                                             |
| `BCRYPT_ROUNDS`                          | No          | bcrypt cost (default `12`)                                                                 |
| `CORS_ORIGINS`                           | No          | Comma-separated allowed origins                                                            |
| `ENCRYPTION_KEY`                         | Yes in prod | 64-char hex; encrypts stored Canvas credentials                                            |
| `LOG_LEVEL`                              | No          | e.g. `info`, `debug`                                                                       |
| `EDUAI_API_URL`                          | For EduAI   | Base URL (default UBC EduAI)                                                               |
| `EDUAI_API_KEY`                          | For EduAI   | API key from EduAI                                                                         |
| `EDUAI_IGNORED_COURSE_CODES`             | No          | Comma-separated codes hidden in the course list                                            |
| `EDUAI_PROBE_COURSE_ID`                  | No          | Core course CUID for AI connectivity probes (preferred over code)                          |
| `EDUAI_PROBE_COURSE_CODE`                | No          | Core course code for probes when `EDUAI_PROBE_COURSE_ID` is unset                          |
| `GROQ_API_KEY`                           | No          | Direct LLM provider for question generation                                                |
| `OPENAI_API_KEY`                         | No          | Same                                                                                       |
| `DEEPSEEK_API_KEY`                       | No          | Same                                                                                       |
| `DEFAULT_NUM_QUESTIONS`, `MAX_QUESTIONS` | No          | AI batch limits                                                                            |
| `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX` | No          | Production rate limiting                                                                   |
| `BUG_REPORT_ADMIN_EMAILS`                | No          | Extra admin emails for bug triage (see [docs/DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md)) |
| `VITE_API_URL`                           | No          | Browser → API URL (default `http://localhost:8000`)                                        |
| `TEST_DATABASE_URL`                      | Tests only  | Integration test database URL                                                              |


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

### Root


| Command                    | Description                                  |
| -------------------------- | -------------------------------------------- |
| `npm run dev:up`           | Docker Compose dev stack                     |
| `npm run dev:down`         | Stop dev stack                               |
| `npm run dev:logs`         | Follow Compose logs                          |
| `npm run dev:build`        | Dev stack with rebuild                       |
| `npm run seed:production`  | Seed production-style questions (see script) |


### Backend (`app/backend`)


| Command                    | Description                  |
| -------------------------- | ---------------------------- |
| `npm run dev`              | API with nodemon             |
| `npm start`                | Production start             |
| `npm test`                 | Unit tests                   |
| `npm run test:integration` | Integration tests (needs DB) |
| `npm run lint`             | ESLint                       |
| `npm run seed:production`  | Seed script                  |
| `npm run migrate:1072`     | One-time hand-run migration: drops `courses.name`/`code` and `assessments.semester` (#1072 §4 step 10 — Core-owned, superseded by read-through). Idempotent; safe to re-run. |


### Frontend (`app/frontend`)


| Command         | Description      |
| --------------- | ---------------- |
| `npm run dev`   | Vite dev server  |
| `npm run build` | Production build |
| `npm test`      | Unit + integration Vitest suites |
| `npm run test:unit` | Frontend unit tests |
| `npm run test:integration` | Frontend integration tests |
| `npm run lint`  | Lint             |


## Testing

- Backend: `cd app/backend && npm test` and `npm run test:integration` (integration needs PostgreSQL; optional `TEST_DATABASE_URL`).
- Frontend: `cd app/frontend && npm test` for both suites, or `npm run test:unit` / `npm run test:integration` individually.

Details: [docs/TEST_PLAN.md](docs/TEST_PLAN.md).

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