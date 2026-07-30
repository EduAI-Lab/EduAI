# README Monorepo Refresh (#815) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make root + Core + AI Tutor + Question Maker README files agree on monorepo onboarding (install/dev from root, correct ports/auth) without touching ARCHITECTURE / DEPLOYMENT / TESTS.

**Architecture:** Role-split docs — root owns platform onboarding; app READMEs are thin pointers plus app-specific truth; nested READMEs keep package maps but drop standalone-first install framing. Core drops its API curl cookbook in favor of ARCHITECTURE + routes.

**Tech Stack:** Markdown only. Source of truth for facts: root `README.md`, `docs/ARCHITECTURE.md`, `apps/core/.env.example`, turbo filters in root `package.json` / CLAUDE.md.

**Commit policy:** Do **not** commit this plan file or `docs/superpowers/specs/*`. Do **not** commit README edits unless the user explicitly asks.

**Spec:** `docs/superpowers/specs/2026-07-29-readme-monorepo-refresh-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `README.md` | Light fact/link pass |
| `apps/core/README.md` | Slim Core overview (replace wholesale) |
| `apps/extensions/ai-tutor/README.md` | Thin extension entrypoint |
| `apps/extensions/ai-tutor/server/README.md` | Backend map + Core session auth; monorepo DB pointer |
| `apps/extensions/ai-tutor/app/README.md` | Frontend map; fix stale routes/roles/design-system |
| `apps/extensions/question-maker/README.md` | Thin extension entrypoint (Core session, root-first) |
| `apps/extensions/question-maker/app/backend/README.md` | Light install framing align |

---

### Task 1: Root README light pass

**Files:**
- Modify: `README.md`
- Verify against: `apps/extensions/example-extension/` (exists; no README required)

- [ ] **Step 1: Grep for stale markers in root README**

Run from repo root:

```bash
rg -n "JWT|BETTER_AUTH_URL|Sequelize|EduAICore monorepo|localhost:5173.*[Cc]ore|docker compose up -d db" README.md
```

Expected: no JWT/Sequelize/standalone Core-on-5173 hits. `5173` may appear only as Question Maker frontend (OK).

- [ ] **Step 2: Confirm `example-extension` tree entry is accurate**

Confirm directory exists: `apps/extensions/example-extension/` (package present; may lack its own README — that is fine; do not invent one).

If the tree line claims a README or wrong purpose, adjust the comment only. Current intended line:

```text
│       └── example-extension/       # Minimal Express extension demonstrating Core auth patterns (dev reference)
```

- [ ] **Step 3: Spot-check internal doc links used in the Docs table**

For each relative link in the Docs table near the top of `README.md`, resolve the path exists (at minimum these high-traffic ones):

- `docs/ARCHITECTURE.md`
- `docs/EXTENSION_ONBOARDING.md`
- `docs/ENVIRONMENT.md` (if linked)
- `apps/extensions/ai-tutor/README.md`
- `apps/extensions/question-maker/README.md`

Fix only broken paths found in **this file**.

- [ ] **Step 4: Smoke-read Getting started + ports**

Confirm ports table still matches:

| App | Port |
|-----|------|
| EduAI | 3000 |
| AI Tutor FE | 3001 |
| AI Tutor API | 4000 |
| QM FE | 5173 |
| QM API | 8000 |

Do not restructure long sections (mobile audit, latency bench).

---

### Task 2: Rewrite `apps/core/README.md` (slim)

**Files:**
- Modify: `apps/core/README.md` (full replace)
- Reference: `apps/core/.env.example` (`BETTER_AUTH_URL=http://localhost:3000`)
- Reference: `docs/ARCHITECTURE.md` §6–7

- [ ] **Step 1: Replace file contents with the slim README below**

Write exactly this structure (adjust wording only if a linked path does not exist; prefer keeping links):

```markdown
# EduAI Core

RAG-powered chat platform and the **central API / auth layer** for the EduAI monorepo. Extensions (AI Tutor, Question Maker) validate sessions against Core and call Core APIs with the shared service key (`EDUAI_API_KEY`).

For platform layout, ports, Docker databases, and `npm run dev`, start at the **[monorepo root README](../../README.md)**. For architecture, RAG/chat flows, schema, and RBAC, see [`docs/ARCHITECTURE.md`](../../docs/ARCHITECTURE.md).

## Develop from the monorepo root

```bash
# from repo root
npm install
npm run dev
# Core only:
npx turbo run dev --filter=edu-ai
```

Core listens at **http://localhost:3000**. Do not treat this package as a standalone Vite app on port 5173.

## What Core owns

- Better Auth sessions and OAuth/OIDC for the platform
- Course / enrollment / materials / Canvas sync APIs
- Chat + RAG (`POST /api/chat`), embeddings (pgvector), AI provider catalog
- Policy registry (`GET /api/policies`) and admin tooling
- Service-key and session APIs consumed by extensions

## Essential environment

Copy from `.env.example` (root `npm install` also auto-copies if missing). Critical variables:

| Variable | Notes |
|----------|--------|
| `DATABASE_URL` | Dev default points at Docker `eduai-db` on port `54320` |
| `BETTER_AUTH_SECRET` | Required |
| `BETTER_AUTH_URL` | `http://localhost:3000` in local dev |
| `ENCRYPTION_KEY` | Required for Canvas token storage (AES-256-GCM) |
| `EDUAI_API_KEY` | Same value as AI Tutor server + Question Maker |
| `EMBEDDING_PROVIDER` / `OPENROUTER_API_KEY` / `OLLAMA_BASE_URL` | Embeddings path — see [`docs/rag-ai/EMBEDDINGS.md`](../../docs/rag-ai/EMBEDDINGS.md) |

Full inventory: [`docs/ENVIRONMENT.md`](../../docs/ENVIRONMENT.md) and `apps/core/.env.example`.

## Useful scripts (from `apps/core`)

```bash
npm run typecheck      # react-router typegen + tsc
npm run test:unit      # vitest unit suite
npm run test:integration
npm run db:migrate     # prisma migrate dev
npm run db:generate
npm run db:seed
```

Prefer root scripts for multi-app work: `npm run test:eduai`, `npm run test:eduai:unit`, etc. Inventory: [`TESTS.md`](../../TESTS.md).

## API discovery

Route handlers live under `app/routes/` (API under `app/routes/api/`). Auth guards: `app/lib/auth/`. Course access: `app/lib/auth/course-access.server.ts`.

Do not maintain a curl cookbook in this README — it drifts. Use ARCHITECTURE §6 (chat/RAG) and §7 (codebase walkthrough), plus the route modules themselves.

## Related docs

| Doc | Why |
|-----|-----|
| [Root README](../../README.md) | Install, ports, Docker DBs, service key |
| [ARCHITECTURE.md](../../docs/ARCHITECTURE.md) | Core vs hosted, RAG, layout, RBAC |
| [EXTENSION_ONBOARDING.md](../../docs/EXTENSION_ONBOARDING.md) | How extensions attach to Core |
| [CANVAS.md](../../docs/CANVAS.md) | Local Canvas LMS |
| [LOGGING.md](../../docs/LOGGING.md) | Audit / system logs |
```

- [ ] **Step 2: Verify no stale Core-on-5173 or JWT claims remain**

```bash
rg -n "5173|JWT|Sequelize|npm ci|plug-and-play" apps/core/README.md
```

Expected: no `5173`, no JWT/Sequelize. `npm ci` should not appear as the primary install story.

- [ ] **Step 3: Verify every relative link in the new Core README resolves**

Open/resolve each `](...)` target from `apps/core/README.md`.

---

### Task 3: Rewrite AI Tutor top-level README

**Files:**
- Modify: `apps/extensions/ai-tutor/README.md`

- [ ] **Step 1: Replace with thin pointer README**

Use this content as the target (keep campus-specific details out; link nested READMEs):

```markdown
# AI Tutor

Two-agent tutoring extension (primary tutor + pedagogical reviewer) with hierarchical course content (CourseOffering → Module → Lesson → Activity). Session auth is **delegated to EduAI Core** — this app has no local password/JWT login.

## Develop from the monorepo root

```bash
# from repo root
npm install
npm run dev
# AI Tutor only (frontend + API):
npx turbo run dev --filter=ai-tutor --filter=ai-tutor-server
```

| Process | URL |
|---------|-----|
| Frontend | http://localhost:3001 |
| API server | http://localhost:4000 |

Databases: use root Docker Compose (`npm run docker:dev:db` / `npm run dev`), not a separate AI-Tutor-only Compose as the primary path. Details: [root README](../../../README.md).

Nested docs:

- [Frontend (`app/`)](app/README.md)
- [Backend (`server/`)](server/README.md)

## Tech stack

| Layer | Technology |
|-------|------------|
| Frontend | React Router v7 (SPA), Vite, Tailwind v4, `@eduai/ui` |
| Backend | Express 5, Prisma, PostgreSQL |
| Auth | Core `POST /api/sessions/validate` (cookie forwarded) |
| AI | Tutor/supervisor loops via Core `/api/completion` (service key) |

## Content hierarchy

```
CourseOffering → Module → Lesson → Activity
```

Unpublished parents hide children. Topics are scoped per CourseOffering.

## Roles (summary)

| Role | Access |
|------|--------|
| STUDENT | Enrolled courses, activities, AI chat |
| TA | Instructor shell (read-only content); student surfaces where allowed |
| INSTRUCTOR | Course management, authoring, analytics |
| UNIT_ADMIN | Department-scoped management |
| ADMIN | Platform admin surfaces |

See `docs/implementations/rbac-matrix.md` and `app/lib/rbac/permissions.ts`.

## Environment

**Server** (`server/.env`, auto-copied from example via root install):

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | AI Tutor Postgres |
| `CORE_URL` | Yes | Core base URL for session validation |
| `EDUAI_API_KEY` | For Core S2S / AI | Must match Core |
| `EDUAI_BASE_URL` | For AI | Core API base |
| `PORT` | No | Default `4000` |

**Frontend** (Vite):

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_URL` | `http://localhost:4000` | API server |
| `VITE_EDUAI_URL` | `http://localhost:3000` | Core (app switcher) |
| `VITE_QUESTION_MAKER_URL` | `http://localhost:5173` | QM (app switcher) |

## Scripts

Prefer root/turbo. From this package:

| Command | Where | Description |
|---------|-------|-------------|
| `npm run dev` | extension root | Frontend Vite on 3001 |
| `npm run test` | extension root | Frontend Vitest |
| `npm run dev` | `server/` | API on 4000 |
| `npm run test` / `test:unit` / `test:integration` | `server/` | Backend tests |

Full inventory: [`TESTS.md`](../../../TESTS.md).

## Related

- [Root README](../../../README.md) — monorepo install / ports / DBs
- [ARCHITECTURE.md](../../../docs/ARCHITECTURE.md) — extension data + auth flows (§8–9)
- [Two-agent supervisor](docs/two-agent-supervisor-system.md) — if present; else omit link
```

- [ ] **Step 2: Fix / drop any dead links**

If `docs/two-agent-supervisor-system.md` is missing, remove that row rather than leaving a broken link.

```bash
rg -n "docker compose up -d db|JWT|Better Auth \(session-based\)|npm install\ncd server" apps/extensions/ai-tutor/README.md
```

Expected: no primary local-Compose / dual-install story; auth described as Core validation.

---

### Task 4: Align AI Tutor `server/README.md`

**Files:**
- Modify: `apps/extensions/ai-tutor/server/README.md`

- [ ] **Step 1: Add / ensure a monorepo pointer near the top**

After the opening paragraph, ensure this block exists (insert if missing):

```markdown
## Develop with the monorepo

Prefer starting databases and Core from the **repo root** (`npm run dev` or `npm run docker:dev:db`). This server expects Core at `CORE_URL` (default `http://localhost:3000`) for `POST /api/sessions/validate`.

```bash
# from repo root — API only
npx turbo run dev --filter=ai-tutor-server
# or:
cd apps/extensions/ai-tutor/server && npm run dev
```

Do not document a standalone `docker compose up -d db` inside this package as the primary setup path.
```

- [ ] **Step 2: Confirm Authentication section still matches code**

Auth must state: no local Better Auth tables; cookie → Core `sessions/validate`. If the README claims local Better Auth, rewrite that subsection to match `src/middleware/auth.js`.

- [ ] **Step 3: Soften any standalone install section**

If there is an “Installation” that starts with `cd server && npm install` as the only path, prefix with “Dependencies are installed from the monorepo root (`npm install`); use the following only for package-local commands.”

- [ ] **Step 4: Grep stale markers**

```bash
rg -n "Better Auth tables|local login|JWT|docker compose up -d" apps/extensions/ai-tutor/server/README.md
```

---

### Task 5: Fix AI Tutor `app/README.md` stale maps

**Files:**
- Modify: `apps/extensions/ai-tutor/app/README.md`
- Source of truth: `apps/extensions/ai-tutor/app/routes.ts`, `app/app.css`

- [ ] **Step 1: Add monorepo pointer at top**

```markdown
## Develop from the monorepo root

```bash
npx turbo run dev --filter=ai-tutor
```

Frontend: http://localhost:3001 — API expected at `VITE_API_URL` (default `http://localhost:4000`). Platform onboarding: [root README](../../../../README.md), [AI Tutor README](../README.md).
```

(Adjust relative depth: from `apps/extensions/ai-tutor/app/README.md` → root is `../../../../README.md`.)

- [ ] **Step 2: Replace Routing table to match `routes.ts`**

Current routes (keep in sync with `app/routes.ts`):

| Path | Module | Notes |
|------|--------|-------|
| `/` | `home.tsx` | Public sign-in |
| `/unsupported-role` | `unsupported-role.tsx` | Legacy redirect helper → `routeForRole` |
| `/dashboard` | `dashboard.tsx` | Role landing (layout) |
| `/admin` | `admin.tsx` | ADMIN / UNIT_ADMIN as gated |
| `/settings` | `settings.tsx` | Authenticated |
| `/help` | `help.tsx` | Authenticated |
| `/student` … | `student*.tsx` | STUDENT / TA |
| `/instructor` … | `instructor*.tsx` | INSTRUCTOR / TA (read-only where gated) |

**Remove** any `PROFESSOR` role labels — platform role is `INSTRUCTOR`.

Update the Directory Structure bullet for `unsupported-role.tsx`: it is **not** “TA rejection”; it redirects authenticated users via `routeForRole`.

- [ ] **Step 3: Fix Design System section**

Replace Neo-Academic / Satoshi / Fraunces claims with the actual stack:

```markdown
## Design system

Uses shared `@eduai/ui` and tokens in `app.css` (Outfit, UBC-aligned palette, class-based dark mode). See `eduai-design-system/project/SKILL.md` for brand rules.
```

- [ ] **Step 4: Confirm API reference link**

`../docs/api-reference.md` exists — keep the link. If the surrounding sentence still implies a local Better Auth password flow, tighten it to Core/EduAI OAuth + cookie session.

- [ ] **Step 5: Grep stale markers**

```bash
rg -n "PROFESSOR|Neo-Academic|Satoshi|Fraunces|TA role rejection|5173" apps/extensions/ai-tutor/app/README.md
```

Expected: no PROFESSOR / Neo-Academic / Satoshi / Fraunces / “TA role rejection”. `5173` should not be claimed as this frontend’s port (3001).

---

### Task 6: Rewrite Question Maker top-level README

**Files:**
- Modify: `apps/extensions/question-maker/README.md`

- [ ] **Step 1: Replace auth + getting started; keep vLLM + docs index**

Target shape:

```markdown
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

## Environment variables

Copy `.env.example` → `.env` in **this directory**. Full commented list lives in `.env.example`. Highlights:

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | QM Postgres (Docker port `55432` in monorepo dev) |
| `CORE_URL` | Yes | Core base URL for session validation |
| `EDUAI_API_KEY` | For Core S2S / AI | Must match Core |
| `EDUAI_API_URL` | For AI proxy | Core API base |
| `ENCRYPTION_KEY` | Prod / Canvas | Encrypts stored Canvas credentials |
| `CORS_ORIGINS` | Yes | Allowed browser origins |
| `VITE_API_URL` | No | Default `http://localhost:8000` |
| `TEST_DATABASE_URL` | Integration tests | Optional |

Do **not** document `JWT_SECRET` / `BCRYPT_ROUNDS` as the platform auth mechanism.

## Campus vLLM defaults

(keep the existing Campus vLLM defaults table and probe-course notes from the current README unchanged)

## Scripts

| Command | Where | Description |
|---------|-------|-------------|
| `npm run dev` | `app/backend` | API (migrate/generate/seed-if-empty + nodemon) |
| `npm run dev` | `app/frontend` | Vite UI |
| `npm test` / `test:integration` | backend or frontend | See package scripts |
| `npm run dev:up` | extension root | Optional Compose stack |

## Testing

- Backend: `cd app/backend && npm test` / `npm run test:integration`
- Frontend: `cd app/frontend && npm test`
- Inventory: [`TESTS.md`](../../../TESTS.md), [docs/TEST_PLAN.md](docs/TEST_PLAN.md)

## Documentation

(keep the existing Documentation table rows that still resolve; remove broken paths only)
```

When editing, **copy forward** the existing Campus vLLM section and Documentation table verbatim where links still work.

- [ ] **Step 2: Grep stale auth**

```bash
rg -n "JWT|bcrypt|JWT_SECRET|BCRYPT" apps/extensions/question-maker/README.md
```

Expected: no JWT/bcrypt as current auth (mentioning “no local JWT” in a negative sentence is OK).

---

### Task 7: Light-align QM backend README

**Files:**
- Modify: `apps/extensions/question-maker/app/backend/README.md`

- [ ] **Step 1: Prefixed Installation with root-first note**

At the start of `## Installation`, ensure:

```markdown
Platform onboarding (install all workspaces, start Docker DBs + all apps) lives in the
[monorepo root README](../../../../README.md). The steps below are package-local.
```

Keep the existing accurate Core-session auth / Prisma / endpoint summary.

- [ ] **Step 2: Clarify `npm run dev` context**

Where it says `npm run dev`, add “(from `app/backend`, or via root `npm run dev` / turbo filter `question-maker-*`)”.

- [ ] **Step 3: Grep**

```bash
rg -n "JWT|Sequelize as ORM|password login" apps/extensions/question-maker/app/backend/README.md
```

Expected: auth remains Core session; Sequelize only OK in historical baseline-migration narrative.

---

### Task 8: Cross-README verification

**Files:** all touched READMEs

- [ ] **Step 1: Stale-marker sweep**

```bash
rg -n "JWT_SECRET|BCRYPT_ROUNDS|Auth.*JWT|BETTER_AUTH_URL=\"http://localhost:5173\"|PROFESSOR|Neo-Academic|Satoshi|plug-and-play|docker compose up -d db" \
  README.md \
  apps/core/README.md \
  apps/extensions/ai-tutor/README.md \
  apps/extensions/ai-tutor/server/README.md \
  apps/extensions/ai-tutor/app/README.md \
  apps/extensions/question-maker/README.md \
  apps/extensions/question-maker/app/backend/README.md
```

Expected: no hits that assert outdated primary behavior (negative “no JWT” phrases OK).

- [ ] **Step 2: Port consistency**

Confirm across touched files:

- Core 3000, AI Tutor FE 3001, AI Tutor API 4000, QM FE 5173, QM API 8000

- [ ] **Step 3: Confirm out-of-scope files untouched**

```bash
git status --short docs/ARCHITECTURE.md docs/DEPLOYMENT.md TESTS.md
```

Expected: empty (no modifications).

- [ ] **Step 4: Do not commit plan/spec; commit READMEs only if user asks**

```bash
git status --short
```

Leave `docs/superpowers/specs/` and `docs/superpowers/plans/` unstaged unless the user explicitly requests otherwise.

---

## Spec coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| Root light pass | Task 1 |
| Slim Core README / drop cookbook | Task 2 |
| AI Tutor thin top README | Task 3 |
| AI Tutor server align | Task 4 |
| AI Tutor app stale fixes | Task 5 |
| QM top README Core session + root-first | Task 6 |
| QM backend light align | Task 7 |
| Broken links in touched READMEs | Tasks 1–7 + Task 8 |
| Leave ARCHITECTURE / DEPLOYMENT / TESTS | Task 8 step 3 |
| Thin-pointer getting started | Tasks 2–7 |
| No commit of plan/spec | Header + Task 8 step 4 |
