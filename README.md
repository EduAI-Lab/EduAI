# EduAICore

Monorepo for the EduAI platform — a suite of AI-powered educational tools built for UBC course delivery.

## Repository structure

```
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
| [`user-management-and-roles-architecture-plan.md`](docs/user-management-and-roles-architecture-plan.md) | Role hierarchy, permissions, and naming decisions across the platform — **on hold pending Canvas integration** |

## Changelog

All notable changes across apps are recorded in [`CHANGELOG.md`](CHANGELOG.md) at the monorepo root.

## Getting started

Each app is independently runnable. Navigate to the app directory and follow its own README:

```bash
# EduAI Core
cd apps/core && npm install

# AI Tutor
cd apps/extensions/ai-tutor && bun install
cd apps/extensions/ai-tutor/server && bun install

# Question Maker
cd apps/extensions/question-maker/app/backend && npm install
cd apps/extensions/question-maker/app/frontend && npm install
# or use Docker Compose from the question-maker root
```

## Testing

All tests can be run from the monorepo root using the `package.json` scripts. Each app uses its own test runner and is invoked in isolation.

### Prerequisites

Before running tests for the first time, ensure dependencies are installed in every package that has tests.

### Running tests

From the monorepo root `EduAICore/`:

| Command | What runs |
|---------|-----------|
| `npm test` | All unit tests across every app |
| `npm run test:all` | Everything above, plus Question Maker backend integration tests |
| `npm run test:core` | EduAI Core only |
| `npm run test:ai-tutor` | AI Tutor frontend + server |
| `npm run test:ai-tutor:frontend` | AI Tutor frontend only |
| `npm run test:ai-tutor:server` | AI Tutor server only (unit + integration) |
| `npm run test:question-maker` | Question Maker backend (unit) + frontend |
| `npm run test:question-maker:backend` | Question Maker backend unit tests only |
| `npm run test:question-maker:backend:all` | Question Maker backend unit + integration tests |
| `npm run test:question-maker:frontend` | Question Maker frontend only |

### Integration tests

Some tests require a running PostgreSQL instance and will fail without one:

- **AI Tutor server** — `npm run test:ai-tutor:server` runs both unit and integration tests. Connection details are configured in `apps/extensions/ai-tutor/server/.env.test`. The test database (`aitutor_test`) is created automatically on first run. To skip the database and run unit tests only: `bun run --cwd apps/extensions/ai-tutor/server test:unit`
- **Question Maker backend** — `npm run test:question-maker:backend` runs unit tests only. Integration tests are opt-in via `npm run test:question-maker:backend:all` and also require PostgreSQL.

### Test runners by app

| App | Runner | Config |
|-----|--------|--------|
| EduAI Core | Vitest | `apps/core/vitest.config.ts` |
| AI Tutor frontend | Vitest | `apps/extensions/ai-tutor/vitest.config.ts` |
| AI Tutor server | Vitest | `apps/extensions/ai-tutor/server/vitest.config.js` |
| Question Maker backend | Jest | `apps/extensions/question-maker/app/backend/jest.config.js` |
| Question Maker frontend | Vitest | `apps/extensions/question-maker/app/frontend/vite.config.ts` |

## Git hooks

> **WIP:** Git hooks (currently in `apps/extensions/ai-tutor/.githooks/`) are being migrated to the monorepo root. Hook strategy is not yet finalized.
