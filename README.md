# EduAI

Monorepo for the EduAI platform — a suite of AI-powered educational tools built for UBC course delivery.

## Repository structure

Quick map of the monorepo. For the full layout, Core internals, routes, schema, and RBAC, see [`docs/ARCHITECTURE.md` §7](docs/ARCHITECTURE.md#7-codebase-walkthrough-where-to-look).

```text
EduAI/
├── apps/
│   ├── core/                        # EduAI — RAG chat platform and central API
│   └── extensions/
│       ├── ai-tutor/                # AI Tutor — two-agent tutoring with hierarchical course content
│       │   └── server/              # AI Tutor Express/Prisma backend (session validated via Core)
│       ├── question-maker/          # Question Maker — question bank authoring, Canvas integration
│       │   └── app/
│       │       ├── backend/         # Question Maker Express/Prisma API
│       │       └── frontend/        # Question Maker Vite/React frontend
│       └── example-extension/       # Minimal Express extension demonstrating Core auth patterns (dev reference)
├── packages/
│   ├── ui/                          # @eduai/ui — shared shadcn component library + design system components
│   └── types/                       # @eduai/types — shared UserRole and EnrollmentRole types
├── eduai-design-system/             # EduAI design system bundle (tokens, guidelines, Figma UI kit exports)
├── infra/
│   └── cron/                        # Server backup + data-lifecycle scripts (pg_dump, off-site sync, rotation, stale-record cleanup) + cron.env config
├── tools/
│   └── energy-meter/                # GPU/CPU energy sidecar for URA research telemetry (cmps01)
├── scripts/                         # Repo-level setup and dev utilities
├── docs/                            # System-wide architecture and planning docs
│   ├── rag-ai/                      # EduAI chat, RAG, latency (#203), routing (#197)
│   └── implementations/             # schema-design, planned-core-tests, …
├── turbo.json                       # Turborepo task pipeline configuration
├── docker-compose.dev.yml           # Dev-only Postgres containers (apps run on the host)
├── CHANGELOG.md                     # Unified changelog across all apps
├── TESTS.md                         # Canonical test inventory across all apps
└── .gitignore
```

## Apps

### [EduAI](apps/core/)

RAG-powered chat platform and the central API layer for the EduAI ecosystem. Handles AI provider routing, course-aware retrieval, auth, account-level Assistive Mode (`data-assistive` gating), and exposes the API that AI Tutor and Question Maker integrate with.

Core's admin list endpoints (`/api/users`, `/api/courses`, `/api/ai-models`, `/api/ai-providers`) require `page` and `pageSize` on every request and answer `400 PAGINATION_REQUIRED` without them, returning a `{ data, total, page, pageSize }` envelope. `/api/users` and `/api/courses` also take `?ids=a,b,c` (max 200, mutually exclusive with paging) to resolve a known set without page-looping, plus `?search=`. See [`docs/EXTENSION_ONBOARDING.md`](docs/EXTENSION_ONBOARDING.md) for the full contract and the consumer-migration checklist.

### [AI Tutor](apps/extensions/ai-tutor/)

AI tutoring platform with a two-agent supervisor system (primary tutor + pedagogical reviewer). Manages course hierarchies (CourseOffering → Module → Lesson → Activity) and student/professor/TA roles.

### [Question Maker](apps/extensions/question-maker/)

Full-stack tool for building course question banks and assessments. Supports AI-assisted question authoring, OCR upload, Canvas import/export, and assessment variant workflows.

Campus AI defaults (as of the ollama→vLLM cutover): generation/OCR prefer `vllm:qwen2.5-32b-instruct`, connectivity probes prefer `vllm:qwen2.5-7b-instruct`, and both resolve from Core’s live model catalog when available. `vllm` is server-managed (no client API key); legacy `forceProvider=ollama` still maps to campus vLLM. See [Question Maker README](apps/extensions/question-maker/README.md#campus-vllm-defaults).

## Docs

System-wide architecture and planning documents live in [`docs/`](docs/). App-specific docs live alongside each app under their own `docs/` directory.

| Document | Description |
|----------|-------------|
| [`USER_GUIDE.md`](docs/USER_GUIDE.md) | User-facing guide to navigation, roles, and common workflows across Core, AI Tutor, and Question Maker |
| [`DEVELOPER_GUIDE.md`](docs/DEVELOPER_GUIDE.md) | Developer entry point covering the stack, trust boundaries, conventions, testing, and documentation map |
| [`platform-centralization-architecture-plan.md`](docs/platform-centralization-architecture-plan.md) | How Core, AI Tutor, and Question Maker are being centralized under a single API and auth layer |
| [`auth-pipeline-centralization-plan.md`](docs/implementations/auth-pipeline-centralization-plan.md) | Auth pipeline centralization — migrating all extensions to Core as the sole OAuth/OIDC provider |
| [`user-management-and-roles-architecture-plan.md`](docs/user-management-and-roles-architecture-plan.md) | Role hierarchy, permissions, and naming decisions across the platform — **on hold pending Canvas integration** |
| [`rag-ai/README.md`](docs/rag-ai/README.md) | Index for EduAI chat/RAG docs — pipeline, embeddings, latency sprint (#203), routing (#197), dev server runbook |
| [`rag-ai/HOW_TO_USE_DEV_SERVER.md`](docs/rag-ai/HOW_TO_USE_DEV_SERVER.md) | Shared s378 / `dev.eduai` runbook — Core + AI Tutor + Question Maker URLs, systemd units, shared cookies, auth troubleshooting |
| [`rag-ai/EMBEDDINGS.md`](docs/rag-ai/EMBEDDINGS.md) | How embeddings work — pgvector storage, server vs chat API keys, index/retrieval lifecycle, hosting |
| [`rag-ai/CHAT_RAG_PIPELINE.md`](docs/rag-ai/CHAT_RAG_PIPELINE.md) | `POST /api/chat` flow — hybrid vs tool-calling RAG, capped context, `findRelevantContent`, Mermaid diagram |
| [`AGENT_READINESS.md`](docs/AGENT_READINESS.md) | Agent-ready REST endpoints and admin/learning chat tool coverage snapshot ([#167](https://github.com/EduAI-Lab/EduAI/issues/167), [#672](https://github.com/EduAI-Lab/EduAI/issues/672)) |
| [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Core vs hosted services, provider keys, RAG/chat flows, and **codebase walkthrough** (§7 — full repo layout, routes, schema, RBAC) |
| [`EXTENSION_ONBOARDING.md`](docs/EXTENSION_ONBOARDING.md) | Step-by-step guide for connecting a new extension to Core — session validation, auth middleware, RBAC, sidebar registration, and local dev verification checklist |
| [`implementations/schema-design.md`](docs/implementations/schema-design.md) | Unified schema design across apps |
| [`CRON_JOBS.md`](docs/CRON_JOBS.md) | Registered cron jobs, their schedules, trigger behavior, and local dry-run testing steps |
| [`DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Instructions on how to deploy the system (production and development) |
| [`CANVAS.md`](docs/CANVAS.md) | Local Canvas LMS setup — WSL, Docker, ports, seed script |
| [`TEAM_PHASE_0_AND_1_GUIDE.md`](docs/rag-ai/routing/eduai-summer-2026/TEAM_PHASE_0_AND_1_GUIDE.md) | Phase 0 model routing and sustainability telemetry (Prisma schema, router, seeds) |
| [`tools/energy-meter/README.md`](tools/energy-meter/README.md) | GPU/CPU energy sidecar — deploy on cmps01, `ENERGY_SIDECAR_URL` / `CMPS01_INTERNAL_KEY`, verify with `npm run research:verify-energy` |

## Changelog

All notable changes across apps are recorded in [`CHANGELOG.md`](CHANGELOG.md) at the monorepo root.

## Chat latency benchmarking (EduAI Core)

For scripted non-streaming `POST /api/chat` latency runs (for example against a dev deployment), use:

```bash
cd apps/core
node ./scripts/chat-latency-bench.mjs
```

Required environment variables and auth options (`CHAT_BENCH_URL`, `CHAT_BENCH_MODEL`, `CHAT_BENCH_API_KEYS`, cookies or API key) are documented in the script header in [`apps/core/scripts/chat-latency-bench.mjs`](apps/core/scripts/chat-latency-bench.mjs).

**Hybrid RAG** (optional, `#203 L03`): set `CHAT_HYBRID_RAG_ALWAYS_WITH_COURSE` in [`apps/core/.env.example`](apps/core/.env.example) to force hybrid RAG whenever a course is selected. Chat always uses the model the user selected (no automatic tier downgrade). Admin `webToolsEnabled` is seeded `false` in `system_config`.

## Mobile responsiveness audit (`#805`)

Playwright-driven screenshot audit of Core, AI Tutor, and Question Maker at mobile viewports, checking for horizontal overflow and sidebar `aria-expanded`/`aria-controls` wiring:

```bash
cd scripts/mobile-audit
npm install
node run.mjs
```

Requires Core, AI Tutor, and Question Maker dev servers already running locally (`npm run dev` in each, or the root `npm run dev`), plus a seeded instructor account (the default matches `apps/core`'s `npm run db:seed`). Results (JSON + per-page/viewport PNGs) are written to `docs/implementations/screenshots/mobile-audit/`.

The tool audits public pages (e.g. Core sign-in, marked `requiresAuth: false` in `pages.mjs`) in a logged-out browser context, then logs into Core once and reuses that session for every other page across all three apps — Better Auth's dev cookie is host-only for `localhost` with no port restriction (RFC 6265), and AI Tutor / Question Maker authenticate every request by forwarding the `Cookie` header to Core's `/api/sessions/validate` rather than keeping their own session. Each result carries an `authOk` flag confirming the navigation actually landed on the target page; the run exits non-zero if any page fails that check. Full rationale in the navigation helpers in [`scripts/mobile-audit/lib.mjs`](scripts/mobile-audit/lib.mjs).

Env overrides (`CORE_URL`, `AI_TUTOR_URL`, `QM_URL`, `AUDIT_EMAIL`, `AUDIT_PASSWORD`, `MOBILE_AUDIT_OUT_DIR`) are documented in the script header in [`scripts/mobile-audit/run.mjs`](scripts/mobile-audit/run.mjs).

## Getting started

This project uses [Turborepo](https://turbo.build/) to orchestrate tasks across all apps and packages. You only need to run from the monorepo root.

```bash
# 1. Install all workspace dependencies and auto-create per-app .env files from examples
npm install

# 2. Start Docker databases + all dev servers in one command
npm run dev
```

`npm run dev` automatically starts the Docker databases before spinning up all apps via Turborepo. On macOS, Docker Desktop is started automatically if it is not already running. On other platforms, start Docker manually before running `npm run dev`.

On first run (or after a database wipe), the Core and AI Tutor databases are seeded automatically with development data — users, courses, topics, questions, and AI Tutor prompt templates. Subsequent dev restarts detect existing data and skip the seed, so normal restarts are not slowed down.

**Seeded dev accounts** — all share password `EduAI2026!`

| Role | Email | Name |
| --- | --- | --- |
| ADMIN | `admin@eduai.local` | EduAI Admin |
| UNIT_ADMIN | `unitadmin.cosc@eduai.local` | COSC Unit Admin |
| UNIT_ADMIN | `unitadmin.multi@eduai.local` | Multi-Unit Admin |
| INSTRUCTOR | `instructor.cs@eduai.local` | Dr. Ada Lovelace |
| INSTRUCTOR | `instructor.math@eduai.local` | Dr. Emmy Noether |
| INSTRUCTOR | `instructor.sci@eduai.local` | Dr. Marie Curie |
| INSTRUCTOR | `instructor.hum@eduai.local` | Dr. Hannah Arendt |
| TA | `ta.cs@eduai.local` | Sam Carter |
| TA | `ta.math@eduai.local` | Riley Chen |
| STUDENT | `student1@eduai.local` | Alex Patel |
| STUDENT | `student2@eduai.local` | Brooke Kim |
| STUDENT | `student3@eduai.local` | Cameron Lee |
| STUDENT | `student4@eduai.local` | Devon Singh |
| STUDENT | `student5@eduai.local` | Erin Walsh |

After `npm install`, each app gets a `.env` copied from its `.env.example` (only if one doesn't already exist). Fill in any secrets (auth keys, API keys) before the relevant features will work. See each app's `.env.example` for what is required, or [`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md) for a consolidated reference of every variable across the monorepo.

**Service API key (`EDUAI_API_KEY`)**

AI Tutor and Question Maker make server-to-server calls to Core for several features: bug report submission, enrollment sync, topic sync, question push, listing importable courses, and AI-assist LLM calls (Question Maker question generation and AI Tutor tutor/supervisor loops proxied to Core's stateless `/api/completion`; the interactive course chat UI continues to use `/api/chat`). Core also calls back out to both extensions to cascade a course delete (see below). These calls are authenticated with a shared secret called `EDUAI_API_KEY`.

You must set the **same value** in all three services:

| File | Variable |
| --- | --- |
| `apps/core/.env` | `EDUAI_API_KEY` |
| `apps/extensions/ai-tutor/server/.env` | `EDUAI_API_KEY` |
| `apps/extensions/question-maker/.env` | `EDUAI_API_KEY` |

Generate a value with:

```bash
openssl rand -hex 32
```

Without this key the following features will not work: bug report submission from AI Tutor and Question Maker, AI Tutor course import from Core, AI Tutor enrollment sync, Question Maker topic/question push to Core, Question Maker AI chat / question generation (proxied to Core), and cascade-delete propagation from Core to both extensions.

**Cascade-delete propagation (`QM_BACKEND_URL`, `AI_TUTOR_SERVER_URL`)**

When a course is deleted in Core, Core pushes a best-effort delete to QM and AI Tutor's internal endpoints (`DELETE /api/internal/courses/:coreCourseId` / `:coreOfferingId`, service-key authenticated) so linked data doesn't outlive the course. Set these in `apps/core/.env` to point at each extension's backend:

| Variable | Default (dev) |
| --- | --- |
| `QM_BACKEND_URL` | `http://localhost:8000` |
| `AI_TUTOR_SERVER_URL` | `http://localhost:4000` |

Leave either unset in an environment where that extension isn't running — the push is skipped silently for that extension, and its own daily reconcile cron will delete the local mirror on its next run instead (eventual-consistency safety net).

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
npm run test         # All tests across all apps (unit + integration)
npm run test:all     # Unit + integration tests
npm run test:coverage # Coverage for all six test suites (backends + frontends)
npm run dbseed       # Force-seed all three databases (Core → AI Tutor → Question Maker)
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
| `npm run docker:dev:nuke` | **Full teardown** — stop all services and delete all data volumes (irreversible; use when you need a clean slate) |

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

## Running Tests

Locally, all test suites run inside Docker. This ensures every developer uses an identical Node version, dependency tree, and database state regardless of what is installed locally.

> **Note:** CI (`.github/workflows/pr-tests.yml`) runs the unit/integration suites natively on the runner via `turbo run test` against Postgres service containers instead — remote runners get no Docker layer cache, so the containerized suites rebuilt every image (including a full `npm ci` per image) on every run. E2E still runs the full dockerized stack, with image layers cached in the GitHub Actions cache.

### Prerequisites

- Docker Desktop running
- Dependencies installed locally (`npm install`) — only needed to invoke the npm scripts; the actual test execution happens inside containers

### Running tests

From the monorepo root:

#### Run everything
```bash
npm run test:all           # all unit + integration suites
npm run test:unit          # all unit suites only
npm run test:integration   # all integration suites only
npm run test:e2e           # all e2e suites; WARNING: no e2e tests currently
```

### Coverage

Each app exposes a `test:coverage` script (Vitest V8 coverage). From the monorepo root:

```bash
npm run test:coverage   # Aggregates coverage for all six suites (backends + frontends) via Turborepo
```

> **Note:** The root `test:coverage` command covers the three backends (Core, AI Tutor server, Question Maker backend) and the three frontend/UI suites (`@eduai/ui`, AI Tutor client, Question Maker frontend).

Run a single app's coverage from its own directory with `npm run test:coverage`. Generated coverage report directories are gitignored.

### PICT combinatorial models

```bash
npm run test:pict:gen   # Regenerate tests/models/*.cases.json from their .pict sources
```

Runs `pict` inside a pinned Docker image (built on first use) rather than a host install — a native `pict` build isn't reproducible across platforms. See [TESTS.md](TESTS.md#pict-combinatorial-tests) for why, how to add a model, and the model/oracle/world-builder split.

### Integration tests

#### Run by component
```bash
# EduAI (core SSR app)
npm run test:eduai
npm run test:eduai:unit
npm run test:eduai:integration

# AI Tutor
npm run test:ai-tutor

# AI Tutor — frontend app (WARNING: ai-tutor has no integration tests)
npm run test:ai-tutor:app
npm run test:ai-tutor:app:unit
npm run test:ai-tutor:app:integration

# AI Tutor — Express server
npm run test:ai-tutor:server
npm run test:ai-tutor:server:unit
npm run test:ai-tutor:server:integration

# Question Maker
npm run test:qm
npm run test:qm:app
npm run test:qm:app:unit
npm run test:qm:app:integration

# Question Maker — frontend app
npm run test:qm:app:unit
npm run test:qm:app:integration

# Question Maker — Express server
npm run test:qm:server
npm run test:qm:server:unit
npm run test:qm:server:integration
```

Individual commands use `docker compose run --rm`, which starts only the containers that suite needs (e.g. a Postgres instance for integration tests), streams output directly to your terminal, and exits with the test process's exit code.

The full-suite commands (`test:docker`, `test:docker:unit`, `test:docker:integration`) run through `scripts/test-in-docker.sh`, which builds all images in parallel, runs each suite sequentially, reports a per-suite pass/fail summary, and cleans up containers on exit.

## Git hooks

> **WIP:** Git hooks (currently in `apps/extensions/ai-tutor/.githooks/`) are being migrated to the monorepo root. Hook strategy is not yet finalized.
