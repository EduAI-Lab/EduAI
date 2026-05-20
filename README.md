# EduAI

Monorepo for the EduAI platform — a suite of AI-powered educational tools built for UBC course delivery.

## Repository structure

```text
EduAICore/
├── apps/
│   ├── core/                        # EduAI — RAG chat platform and central API
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
├── TESTS.md                         # Canonical test inventory across all apps
└── .gitignore
```

## Apps

### [EduAI](apps/core/)

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
| [`auth-pipeline-centralization-plan.md`](docs/auth-pipeline-centralization-plan.md) | Auth pipeline centralization — migrating all extensions to Core as the sole OAuth/OIDC provider |
| [`user-management-and-roles-architecture-plan.md`](docs/user-management-and-roles-architecture-plan.md) | Role hierarchy, permissions, and naming decisions across the platform |
| [`DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Instructions on how to deploy the system (production and development) |
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Architectural breakdown of the system |

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

After `npm install`, each app gets a `.env` copied from its `.env.example` (only if one doesn't already exist). Fill in any secrets (auth keys, API keys) before the relevant features will work. See each app's `.env.example` for what is required.

**Dev server ports**

| App | URL |
| --- | --- |
| EduAI | http://localhost:3000 |
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

To run tasks for a single app, use Turborepo's filter flag directly:

```bash
npx turbo run dev --filter=ai-tutor --filter=ai-tutor-server   # AI Tutor frontend + server
npx turbo run dev --filter='question-maker-*'         # Question Maker frontend + backend
```

## Databases (Docker)

PostgreSQL for local development is defined in [`docker-compose.dev.yml`](docker-compose.dev.yml) at the repo root. Apps still run on the host via Turborepo; Compose only starts the databases.

Default host ports (override via root `.env` — copy from [`.env.example`](.env.example)):

| Database | Container name | Default port | DB name | User / password |
| --- | --- | --- | --- | --- |
| EduAI (pgvector) | `eduai-db` | `54320` | `eduai` | `postgres` / `postgres` |
| AI Tutor | `eduai-ai-tutor-db` | `54321` | `ai-tutor` | `postgres` / `postgres` |
| Question Maker | `eduai-question-maker-db` | `55432` | `question-maker` | `postgres` / `password` |

Individual database commands:

| Command | Services |
| --- | --- |
| `npm run docker:dev:db` | All three databases |
| `npm run docker:dev:db:eduai` | EduAI DB only |
| `npm run docker:dev:db:ai-tutor` | AI Tutor DB only |
| `npm run docker:dev:db:question-maker` | Question Maker DB only |
| `npm run docker:dev:db:down` | Stop and remove Compose services (data volumes are kept) |
| `npm run docker:dev:db:logs` | Follow database logs |

`docker compose up --wait` requires Docker Compose v2 with healthcheck support.

### Inspecting the database

**Recommended: use a GUI client** such as [DBeaver](https://dbeaver.io/) (free, cross-platform) or [pgAdmin](https://www.pgadmin.org/). Connect with the credentials from the table above and `localhost` as the host. The GUI lets you browse tables, run queries, and inspect data without memorising psql commands.

**Terminal access via psql** (if you prefer the CLI):

```bash
# 1. Open a shell inside the container you want to inspect
docker exec -it eduai-db bash                # EduAI DB
docker exec -it eduai-ai-tutor-db bash       # AI Tutor DB
docker exec -it eduai-question-maker-db bash # Question Maker DB

# 2. Inside the container, launch psql as the postgres user
psql -U postgres

# 3. Connect to the database you want
\c eduai          # or ai-tutor, question-maker

# 4. List all tables in the current schema
\dt

# 5. Query a table (example — adjust table name as needed)
SELECT * FROM "user";

# 6. Exit psql and the container
\q
exit
```

> **Tip:** Table names are case-sensitive in Postgres when quoted. Use double quotes around mixed-case names (e.g. `SELECT * FROM "CourseOffering";`).

**Connecting with DBeaver / pgAdmin:**

1. Open DBeaver and choose **New Connection → PostgreSQL**.
2. Set the fields:
   - **Host:** `localhost`
   - **Port:** use the port from the table above (`54320`, `54321`, or `55432`)
   - **Database:** `eduai`, `ai-tutor`, or `question-maker`
   - **Username:** `postgres`
   - **Password:** `postgres` (or `password` for Question Maker)
3. Click **Test Connection** — if Docker is running the DB container you should see a success message.
4. Click **Finish** to save the connection.

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
| `npx turbo run test --filter=edu-ai` | EduAI tests only |
| `npx turbo run test --filter=ai-tutor --filter=ai-tutor-server` | AI Tutor frontend and server tests |
| `npx turbo run test --filter='question-maker-*'` | Question Maker frontend and backend tests |

### Integration tests

Some tests require a running PostgreSQL instance and will fail without one:

* **AI Tutor server** — Turborepo runs both unit and integration tests. Connection details are configured in `apps/extensions/ai-tutor/server/.env.test`. The test database (`ai-tutor_test`) is created automatically on the first run.
* **Question Maker backend** — The standard `npm run test` runs unit tests only. Integration tests are opt-in via `npm run test:all` and also require PostgreSQL.

### Test runners by app

| App | Runner | Config |
| --- | --- | --- |
| EduAI | Vitest | `apps/core/vitest.config.ts` |
| AI Tutor frontend | Vitest | `apps/extensions/ai-tutor/vitest.config.ts` |
| AI Tutor server | Vitest | `apps/extensions/ai-tutor/server/vitest.config.js` |
| Question Maker backend | Vitest | `apps/extensions/question-maker/app/backend/vitest.config.js` |
| Question Maker frontend | Vitest | `apps/extensions/question-maker/app/frontend/vite.config.ts` |

## Git hooks

> **WIP:** Git hooks (currently in `apps/extensions/ai-tutor/.githooks/`) are being migrated to the monorepo root. Hook strategy is not yet finalized.
