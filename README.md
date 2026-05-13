# EduAICore

Monorepo for the EduAI platform — a suite of AI-powered educational tools built for UBC course delivery.

## Repository structure

```text
EduAICore/
├── apps/
│   ├── core/                        # EduAI Core — RAG chat platform and central API
│   └── extensions/
│       ├── ai-tutor/                # AI Tutor — two-agent tutoring with hierarchical course content
│       │   └── server/              # AI Tutor Express/Prisma backend (Better Auth OAuth provider)
│       └── question-maker/          # Question Maker — question bank authoring, Canvas integration
│           └── app/
│               ├── backend/         # Question Maker Express/Sequelize API
│               └── frontend/        # Question Maker Vite/React frontend
├── scripts/                         # Repo-level setup and dev utilities
├── docs/                            # System-wide architecture and planning docs
├── turbo.json                       # Turborepo task pipeline configuration
├── docker-compose.dev.yml           # Dev-only Postgres containers (apps run on the host)
├── CHANGELOG.md                     # Unified changelog across all apps
└── .gitignore
```

## Apps

### [EduAI Core](apps/core/)

RAG-powered chat platform and the central API layer for the EduAI ecosystem. Handles AI provider routing, course-aware retrieval, auth, and exposes the API that AI Tutor and Question Maker integrate with.

### [AI Tutor](apps/extensions/ai-tutor/)

AI tutoring platform with a two-agent supervisor system (primary tutor + pedagogical reviewer). Manages course hierarchies (CourseOffering → Module → Lesson → Activity) and student/professor/TA roles.

### [Question Maker](apps/extensions/question-maker/)

Full-stack tool for building course question banks and assessments. Supports AI-assisted question authoring, OCR upload, Canvas import/export, and assessment variant workflows.

## Docs

System-wide architecture and planning documents live in [`docs/`](docs/). App-specific docs live alongside each app under their own `docs/` directory.

| Document | Description |
|----------|-------------|
| [`platform-centralization-architecture-plan.md`](docs/platform-centralization-architecture-plan.md) | How Core, AI Tutor, and Question Maker are being centralized under a single API and auth layer |
| [`user-management-and-roles-architecture-plan.md`](docs/user-management-and-roles-architecture-plan.md) | Role hierarchy, permissions, and naming decisions across the platform |

## Changelog

All notable changes across apps are recorded in [`CHANGELOG.md`](CHANGELOG.md) at the monorepo root.

## Getting started

This project uses [Turborepo](https://turbo.build/) to orchestrate tasks across all apps and packages. You only need to run from the monorepo root.

```bash
# 1. Install all workspace dependencies and auto-create per-app .env files from examples
npm install

# 2. Start Docker databases + all dev servers in one command
npm run dev
```

`npm run dev` automatically starts the Docker databases before spinning up all apps via Turborepo. If Docker Desktop is not running you will get a daemon error — start Docker first, then re-run.

After `npm install`, each app gets a `.env` copied from its `.env.example` (only if one doesn’t already exist). Fill in any secrets (auth keys, API keys) before the relevant features will work. See each app’s `.env.example` for what is required.

**Dev server ports**

| App | URL |
| --- | --- |
| EduAI Core | http://localhost:3000 |
| AI Tutor frontend | http://localhost:3001 |
| AI Tutor server (API) | http://localhost:4000 |
| Question Maker frontend | http://localhost:5173 |
| Question Maker backend (API) | http://localhost:8000 |

**Other root scripts**

```bash
npm run build        # Build all apps (Turborepo caches outputs)
npm run lint         # Lint all apps
npm run test         # Unit tests across all apps
npm run test:all     # Unit + integration tests
```

To run tasks for a single app, use Turborepo’s filter flag directly:

```bash
npx turbo run dev --filter=aitutor          # AI Tutor only
npx turbo run dev --filter=question-maker-* # Question Maker frontend + backend only
```

## Databases (Docker)

PostgreSQL for local development is defined in [`docker-compose.dev.yml`](docker-compose.dev.yml) at the repo root. Apps still run on the host via Turborepo; Compose only starts the databases.

Default host ports (override via root `.env` — copy from [`.env.example`](.env.example)):

| Database | Default port | DB name | User / password |
| --- | --- | --- | --- |
| Core (pgvector) | `54320` | `eduai` | `postgres` / `postgres` |
| AI Tutor | `54321` | `aitutor` | `postgres` / `postgres` |
| Question Maker | `55432` | `eduquery` | `postgres` / `password` |

Individual database commands:

| Command | Services |
| --- | --- |
| `npm run docker:dev:db` | All three databases |
| `npm run docker:dev:db:core` | Core only |
| `npm run docker:dev:db:tutor` | AI Tutor DB only |
| `npm run docker:dev:db:qm` | Question Maker DB only |
| `npm run docker:dev:db:down` | Stop and remove Compose services (data volumes are kept) |
| `npm run docker:dev:db:logs` | Follow database logs |

`docker compose up --wait` requires Docker Compose v2 with healthcheck support.

## Testing

With Turborepo, testing is orchestrated from the monorepo root. Each app uses its own test runner and is invoked in isolation, with results heavily cached to speed up development.

### Prerequisites

Before running tests for the first time, ensure dependencies are installed via `npm install` at the monorepo root.

### Running tests

From the monorepo root `EduAICore/`:

| Command | What runs |
| --- | --- |
| `npm run test` | All unit tests across every app simultaneously |
| `npm run test:all` | Everything above, plus Question Maker backend integration tests |
| `npm run test --filter=core` | EduAI Core tests only |
| `npm run test --filter=ai-tutor...` | AI Tutor frontend and server tests |
| `npm run test --filter=question-maker...` | Question Maker frontend and backend tests |

### Integration tests

Some tests require a running PostgreSQL instance and will fail without one:

* **AI Tutor server** — Turborepo runs both unit and integration tests. Connection details are configured in `apps/extensions/ai-tutor/server/.env.test`. The test database (`aitutor_test`) is created automatically on the first run.
* **Question Maker backend** — The standard `npm run test` runs unit tests only. Integration tests are opt-in via `npm run test:all` and also require PostgreSQL.

### Test runners by app

| App | Runner | Config |
| --- | --- | --- |
| EduAI Core | Vitest | `apps/core/vitest.config.ts` |
| AI Tutor frontend | Vitest | `apps/extensions/ai-tutor/vitest.config.ts` |
| AI Tutor server | Vitest | `apps/extensions/ai-tutor/server/vitest.config.js` |
| Question Maker backend | Jest | `apps/extensions/question-maker/app/backend/jest.config.js` |
| Question Maker frontend | Vitest | `apps/extensions/question-maker/app/frontend/vite.config.ts` |

## Git hooks

> **WIP:** Git hooks (currently in `apps/extensions/ai-tutor/.githooks/`) are being migrated to the monorepo root. Hook strategy is not yet finalized.
