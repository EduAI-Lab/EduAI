# AiTutor

An AI-powered educational platform with a two-agent supervisor system that ensures pedagogically sound tutoring. Built for UBC course delivery with hierarchical content management and role-based access.

## Tech Stack

| Layer    | Technology                                                    |
| -------- | ------------------------------------------------------------- |
| Frontend | React Router v7 (SPA mode), Vite 8, TailwindCSS v4, `@eduai/ui` (shared EduAI design system) |
| Backend  | Express 5, Prisma ORM, PostgreSQL 16                          |
| Auth     | Better Auth (session-based)                                   |
| AI       | Two-agent supervisor system via EduAI API                     |
| Testing  | Vitest, Supertest                                             |
| Tooling  | Node.js/npm, oxlint, oxfmt, tsgo, knip                       |

## Prerequisites

- Node.js 20+ with npm (or pnpm / yarn)
- [Docker](https://docs.docker.com/get-docker/) (for PostgreSQL)
- Node.js 20+ (Vite/Vitest runtime)

## Architecture

```bash
# 1. Clone and install
npm install
cd server && npm install && cd ..

# 2. Start PostgreSQL (If using docker, if using a DB server change the DATABASE_URL env instead. )
docker compose up -d db

# 3. Configure environment
cp server/.env.example server/.env
# Edit server/.env with your secrets (see Environment section below)

# 4. Run migrations and seed demo data
cd server
npx prisma migrate deploy
npm run seed
cd ..
```

### Directory Layout

Run frontend and backend in separate terminals:

```bash
# Terminal 1 — API server (http://localhost:4000)
cd server && npm run dev

# Terminal 2 — Frontend dev server (http://localhost:3001)
npm run dev
```

The frontend expects the API at `http://localhost:4000`. Override with the `VITE_API_URL` env var.

### Design system

AiTutor shares the EduAI design system via the monorepo `@eduai/ui` package and tokens in `app/app.css` (UBC Blue, Outfit typography, dark mode). See `eduai-design-system/project/SKILL.md` for brand rules. Cross-app navigation:

- **AiTutor → EduAI Core:** Nav bar “EduAI Core” link (`VITE_EDUAI_URL`, default `http://localhost:3000`)
- **EduAI Core → AiTutor:** Sidebar “AI Tutor” link (`VITE_AI_TUTOR_URL` on Core, default `http://localhost:3001`)

## Project Structure

```
├── app/                          # React Router frontend
│   ├── routes/                   # File-based routes (dot-delimited)
│   │   ├── home.tsx              # Login page
│   │   ├── admin.tsx             # Admin dashboard
│   │   ├── instructor.*.tsx      # Instructor views (course → module → lesson)
│   │   └── student.*.tsx         # Student views
│   ├── components/               # Reusable UI components
│   ├── hooks/                    # Custom React hooks
│   └── lib/                      # API client, types, utilities
├── server/
│   └── src/
│       ├── app.js                # Express app factory (createApp)
│       ├── config/               # Database connection, admin bootstrap
│       ├── middleware/            # Auth (Better Auth session middleware)
│       ├── routes/               # Domain route modules (10 modules)
│       ├── services/             # Business logic (AI guidance, cloning, evaluation)
│       ├── schemas/              # Zod validation schemas
│       └── utils/                # Data mappers
│   └── prisma/
│       ├── schema.prisma         # Database schema (18 models)
│       └── seed.ts               # Demo data seeder
├── shared/                       # Code shared between frontend and backend
├── docs/                         # Design documents
├── .githooks/                    # Pre-commit hook (lint, format, typecheck, test)
└── docker-compose.yml            # PostgreSQL 16 service
```

## Architecture

### Content Hierarchy

```
CourseOffering → Module → Lesson → Activity
```

Each level supports publish/unpublish gating — unpublished parents hide their children.

### Roles

| Role             | Access                                                              |
| ---------------- | ------------------------------------------------------------------- |
| **Student**      | Enrolled courses, activities, AI chat modes                         |
| **Instructor**   | Full course management, content authoring, analytics                |
| **TA**           | Read-only instructor shell, course submissions view (no content edits) |
| **Unit Admin**   | Department-scoped course management and enrollment admin            |
| **Admin**        | User management, system settings, AI model config, bug report triage |

RBAC UI wiring follows `docs/rbac-endpoints-ai-tutor.md` and `docs/implementations/rbac-matrix.md` §14–15. Frontend gates use `app/lib/rbac/permissions.ts` and `PermissionGate` — TA users share the `/instructor` shell in read-only mode; unit admins see department-scoped course management.

### AI Tutoring — Two-Agent Supervisor System

The platform uses a two-agent architecture for AI-powered tutoring:

1. **AI1 (Primary Tutor)** — Generates responses in one of three modes: Teach, Guide, or Custom
2. **AI2 (Supervisor)** — Reviews AI1's output for pedagogical soundness (e.g., no answer leaking)

The supervisor loop runs up to 3 iterations before falling back. It is controlled by the admin AI model policy. See [`docs/two-agent-supervisor-system.md`](docs/two-agent-supervisor-system.md) for details.

### Topic Classification

Activities require a **main topic** and support multiple **secondary topics** for cross-referencing. Topics are scoped to their CourseOffering (unique names per course, no cross-course pollution).

## Environment Variables

Copy `server/.env.example` to `server/.env` and configure:

| Variable                | Required | Description                                        |
| ----------------------- | -------- | -------------------------------------------------- |
| `DATABASE_URL`          | Yes      | PostgreSQL connection string                       |
| `BETTER_AUTH_SECRET`    | Yes      | Session signing secret                             |
| `BETTER_AUTH_URL`       | Yes      | Auth endpoint base URL                             |
| `PORT`                  | No       | API port (default: `4000`)                         |
| `COOKIE_DOMAIN`         | No       | Cookie domain (default: `localhost`)               |
| `EDUAI_API_KEY`         | For AI   | EduAI API key                                      |
| `EDUAI_BASE_URL`        | For AI   | EduAI API base URL                                 |
| `EDUAI_MODEL`           | For AI   | Model identifier (e.g., `google:gemini-2.5-flash`) |

Frontend env vars:

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `VITE_API_URL` | `http://localhost:4000` | AiTutor API server URL |
| `VITE_EDUAI_URL` | `http://localhost:3000` | EduAI Core app URL (cross-nav link in Nav) |

## Scripts

### Root (frontend)

| Command                  | Description                                 |
| ------------------------ | ------------------------------------------- |
| `npm run dev`            | Start Vite dev server                       |
| `npm run build`          | Production build                            |
| `npm run typecheck`      | React Router typegen + `tsc`                |
| `npm run typecheck:fast` | React Router typegen + `tsgo` (~10x faster) |
| `npm run lint`           | Run oxlint on all source files              |
| `npm run format`         | Format with oxfmt                           |
| `npm run knip`           | Detect dead code/exports                    |
| `npm run test`           | Run frontend tests                          |

### Server

| Command                    | Description                                  |
| -------------------------- | -------------------------------------------- |
| `npm run dev`              | Start API with nodemon (auto-reload)         |
| `npm run start`            | Production start                             |
| `npm run seed`             | Seed database with demo data                 |
| `npm run test`             | Run all tests (unit + integration)           |
| `npm run test:unit`        | Unit tests only (no DB required)             |
| `npm run test:integration` | Integration tests only (requires PostgreSQL) |
| `npm run test:watch`       | Watch mode                                   |

## Testing

21 test files across unit and integration suites:

- **Unit tests** (`server/test/unit/`) — Pure function tests for mappers, evaluation logic, analytics, AI model policy, and AI guidance. No database required.
- **Integration tests** (`server/test/integration/`) — Full HTTP tests via Supertest against a real PostgreSQL test database. Covers auth, CRUD for all entities, course cloning, progress calculation, and topic management.

```bash
# Run all server tests
cd server && npm run test

# Run only unit tests (fast, no DB)
cd server && npm run test:unit
```

The test database (`aitutor_test`) is created automatically on first run by `globalSetup.js`. Tests inject a mock user via `createApp({ mockUser })` to bypass auth.

## Pre-commit Hook

> **WIP:** Git hooks are currently being migrated to the EduAICore monorepo root. Hook scripts live in `.githooks/` but are not yet wired up. This section will be updated once the monorepo-level hook strategy is finalized.

## Database

Reset or reseed at any time:

```bash
cd server

# Apply pending migrations
npx prisma migrate deploy

# Reseed demo data
npm run seed

# Open Prisma Studio (visual DB browser)
npx prisma studio
```

## Production Build

```bash
npm run build
npm run start       # Serves built frontend via Vite preview
```

For the API server:

```bash
cd server && npm run start
```

### Docker

```bash
docker build -t aitutor .
docker run -p 3000:3000 aitutor
```
