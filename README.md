# EduAICore

Monorepo for the EduAI platform — a suite of AI-powered educational tools built for UBC course delivery.

## Repository structure

```text
EduAICore/
├── apps/
│   ├── core/                        # EduAI Core — RAG chat platform and central API
│   └── extensions/
│       ├── ai-tutor/                # AI Tutor — two-agent tutoring with hierarchical course content
│       └── question-maker/          # Question Maker — question bank authoring, Canvas integration
├── pkg/                             # Shared packages (in progress)
│   ├── config/
│   ├── db/
│   ├── ui/
│   └── util/
├── docs/                            # System-wide architecture and planning docs
├── turbo.json                       # Turborepo task pipeline configuration
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

## Shared packages

`pkg/` is reserved for shared code to be extracted as the monorepo matures (config, DB utilities, UI components, general utilities). Currently empty — shared code consolidation is planned.

## Docs

System-wide architecture and planning documents live in [`docs/`](docs/). App-specific docs live alongside each app under their own `docs/` directory.

| Document | Description |
|----------|-------------|
| [`platform-centralization-architecture-plan.md`](docs/platform-centralization-architecture-plan.md) | How Core, AI Tutor, and Question Maker are being centralized under a single API and auth layer |
| [`user-management-and-roles-architecture-plan.md`](docs/user-management-and-roles-architecture-plan.md) | Role hierarchy, permissions, and naming decisions across the platform |

## Changelog

All notable changes across apps are recorded in [`CHANGELOG.md`](CHANGELOG.md) at the monorepo root.

## Getting started

This project uses [Turborepo](https://turbo.build/) to orchestrate tasks across all apps and packages. You only need to run installations and scripts from the monorepo root.

```bash
# Setting up local dev
npm install
npm run dev

# Build all applications (Turborepo caches the outputs)
npm run build

# Run formatting, linting, and tests across the workspace
npm run lint
npm run test

```

*Note: You can still execute tasks for a specific app using Turborepo's filter flag. For example, `npm run dev --filter=ai-tutor` will only start the AI Tutor extension.*

## Databases (Docker)

PostgreSQL for local development is defined in [`docker-compose.dev.yml`](docker-compose.dev.yml) at the repo root. Apps still run on the host via Turborepo; Compose only starts the databases.

1. Copy [`.env.example`](.env.example) to `.env` at the root if you need custom **host** ports (defaults: Core `5432`, Tutor `54321`, Question Maker `55432`).
2. Start the databases you need:

| Command | Services |
| --- | --- |
| `npm run docker:dev:db` | All three databases |
| `npm run docker:dev:db:core` | Core only (pgvector, DB `eduai`) |
| `npm run docker:dev:db:tutor` | AI Tutor DB only (`aitutor`) |
| `npm run docker:dev:db:qm` | Question Maker DB only (`eduquery`) |
| `npm run docker:dev:db:down` | Stop and remove Compose services (data volumes are kept) |
| `npm run docker:dev:db:logs` | Follow database logs |

3. Point each app’s `DATABASE_URL` at `localhost` (see that app’s `.env.example`):

- **Core:** `postgresql://postgres:postgres@localhost:5432/eduai?schema=public`
- **AI Tutor server:** `postgresql://postgres:postgres@localhost:54321/aitutor?schema=public`
- **Question Maker:** `postgresql://postgres:password@localhost:55432/eduquery` (password matches the QM extension convention)

`docker compose up --wait` needs Docker Compose v2 with healthchecks.

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
