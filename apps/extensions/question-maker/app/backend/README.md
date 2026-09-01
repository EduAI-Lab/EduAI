# Question Maker Backend (EduQuery.ai)

Express/Prisma REST API for the Question Maker extension — question banks, assessments, AI-assisted
question generation, and Canvas LMS import/export. Identity and session auth are delegated entirely to
EduAI Core; this service holds only a local `User` FK row plus QM's own course/question/assessment data.

## Features

- **Question bank**: CRUD for questions and variants, AI-assisted generation and OCR extraction, MCQ/SA/LA
  types with difficulty and reasoning-level tagging
- **Assessments**: sections, ordered questions, and equivalent-form variant assembly (round-robin picks
  from the question bank)
- **Course sync**: courses/topics mirror EduAI Core (the source of truth) and stay linked via `coreCourseId`
- **Canvas LMS integration**: connect a Canvas account, import quizzes as questions, export assessments as
  Canvas quizzes
- **Auth**: no local accounts — every request is authenticated by validating the caller's session cookie
  against Core (`requireAuth` in `src/middleware/auth.js`); RBAC is course-scoped from Core enrollment
  role or unit-admin department match (local course ownership is an FK only — not an access grant; #1114)

## Tech Stack

- **Runtime**: Node.js 18+, Express (ESM)
- **Database**: PostgreSQL via Prisma ORM (`prisma/schema.prisma`)
- **Auth**: session cookie validated against EduAI Core (no local passwords/JWTs issued by this service)
- **AI**: EduAI's hosted chat/generation API, with direct Groq/OpenAI/DeepSeek as optional fallbacks
- **File upload**: none — OCR runs client-side in the frontend; the backend receives the already-extracted text
- **Security**: Helmet, CORS, rate limiting, AES-256-GCM at-rest encryption for stored Canvas API keys,
  and SSRF-safe Canvas networking. Canvas bases are canonical HTTPS origins (explicit HTTPS ports are
  supported); IP literals and every DNS answer must be globally routable, DNS is pinned per request,
  redirects are revalidated, and bearer credentials are removed before any cross-origin redirect.

## Project Structure

```
src/
├── index.js                 # Application entry point
├── app.js                   # Express app wiring (middleware + route mounts)
├── config/
│   ├── database.js          # Prisma client singleton + connection retry
│   └── settings.js          # Environment settings
├── middleware/
│   ├── auth.js               # Core session validation (requireAuth/authenticateToken), role gates
│   ├── courseAccess.js        # Per-course access from Core enrollment/unit-admin (fail closed; #1114)
│   ├── resourceAccess.js       # Ownership guards for variant/question/assessment routes
│   ├── aiAdmission.js          # Caller-keyed AI rate limit + provider-call/deadline budgets for every AI route
│   ├── csrfOrigin.js            # Origin/Referer/Sec-Fetch-Site guard for cookie-authenticated unsafe methods
│   ├── canvasRequestContext.js  # AsyncLocalStorage: cancels in-flight Canvas→Core calls on client disconnect
│   ├── errorHandler.js        # Maps Prisma error codes + generic errors to HTTP responses
│   ├── roles.js                # Role/level rank helpers
│   └── serviceAuth.js           # Service-key auth for Core → QM internal routes
├── routes/                  # course, questions, variants, assessments, assessmentVariant,
│                             # eduai, canvas, topics, auth, bug-reports, internal
├── services/                 # Business logic — one service per domain: questionService/questionMutationFence
│                              # (advisory-lock fence around every question mutation), assessmentService,
│                              # assessmentSectionService, assessmentVariantService (variant workflow assembly),
│                              # canvasService (proxies Canvas LMS via Core), coreApiService (thin Core HTTP client),
│                              # coreWiringService (pushes an approved variant to Core as a Question),
│                              # variant-publish.js / variant-push-gate.js (publish-to-Core orchestration),
│                              # courseListService (RBAC-scoped course listing + Core read-through),
│                              # ensureCourseAnchor (locked create shared by POST/import/ADMIN list),
│                              # questionBankService (Core-backed question banks), modelCatalog, eduaiService, etc.
├── jobs/
│   └── reconcile.js          # Daily cron: cleans up stale Core references (course/topic/question)
└── utils/                    # encryption, logger (Pino), safeLogging (allowlisted upstream-error fields),
                               # pagination.js / listPagination.js (the two list-response contracts),
                               # questionApproval, questionListQuery, questionOrder, assessmentType,
                               # modelSizeRanks, truncateAllTables (test/seed reset)

prisma/
├── schema.prisma            # Source of truth for the data model
└── migrations/               # Applied via `prisma migrate deploy`/`dev`

scripts/                     # Seed scripts (seedUnified, seedIfEmpty, seed-perf, seedProductionQuestions)
                              # and the withPrismaEnv wrapper used by the db:* npm scripts
tests/
├── unit/                    # Mocked-collaborator unit tests
└── integration/             # Route/service tests; real-DB suites need TEST_DATABASE_URL
```

## Installation

Platform onboarding (install all workspaces, start Docker DBs + all apps) lives in the
[monorepo root README](../../../../../README.md). The steps below are package-local.

1. **Install dependencies** (from the repo root, so workspace packages link correctly)
   ```bash
   npm install
   ```

2. **Environment setup** — this backend reads its config from the extension-root `.env`, not a local one
   ```bash
   cp ../../.env.example ../../.env
   # Edit apps/extensions/question-maker/.env — see the Environment Variables section below
   ```

3. **Database** — point `DATABASE_URL` at a Postgres instance, then apply migrations
   ```bash
   npm run db:migrate:deploy
   ```
   (`npm run dev` — from `app/backend`, or via root `npm run dev` / turbo filter `question-maker-*` —
   already does this automatically on every start — see below.)

## Running the Application

### Development
From `app/backend`, or via root `npm run dev` / turbo filter `question-maker-*`:
```bash
npm run dev
```
Runs `db:migrate:deploy && prisma generate && seed:if-empty && nodemon src/index.js` — migrations are
applied (baselining first if needed, see below), the Prisma client is (re)generated, the database is
seeded only if it's empty, then the server starts with hot reload.

### Production
```bash
npm start
```
Runs `db:migrate:deploy && prisma generate && node src/index.js` — same migration/baseline step as `dev`,
without seeding.

### Adopting an existing deployment
`db:migrate:deploy` (`npm run db:migrate:deploy`, also run by `dev`/`start`/the Docker `CMD`) begins with
`scripts/baselineExistingDatabase.js`. QM's pre-Prisma backend booted via
`sequelize.sync({ alter: true })` — no migrations table, but `users`, `courses`, etc. already exist. Running
`prisma migrate deploy` straight against a database like that fails: it tries to `CREATE TABLE` things that
are already there. The baseline script detects that case (no `_prisma_migrations` table, but `users` does
exist) and marks the init migration as already applied (`prisma migrate resolve --applied`) without running
its DDL, so it never touches those tables. Every migration after init still runs for real — that's what
reconciles the data (e.g. deduping rows for constraints the old schema never enforced) with what a fresh
`init` would have produced; see the migrations under `prisma/migrations/` newer than
`20260723215902_init` for the current set. On a genuinely fresh database (no `users` table either), the
script is a no-op and `migrate deploy` runs `init` and everything after it from scratch, as usual. The
script is idempotent — once `_prisma_migrations` exists (baselined or fresh), it no-ops on every later
deploy.

`db:migrate:deploy` then runs `scripts/migrate-canvas-integrations-to-core.mjs` **before**
`prisma migrate deploy`, because that migration renames `canvas_integrations` →
`canvas_integrations_pre_core_backup`. The copier decrypts each stored Canvas token with QM's
`ENCRYPTION_KEY`, re-encrypts it with Core's, and inserts it into Core's `canvas_integrations` only when
Core has no row for that user (Core wins on conflict). It needs, in the QM container environment:

| Variable | Purpose |
|---|---|
| `CORE_DATABASE_URL` | Core Postgres — where the credentials are copied to |
| `CORE_ENCRYPTION_KEY` | Core's AES key, used to re-encrypt each token |
| `QM_ENCRYPTION_KEY` | QM's AES key (falls back to QM's own `ENCRYPTION_KEY`) |

Core and QM are documented as holding **separate** keys ([`docs/ENVIRONMENT.md`](../../../../../docs/ENVIRONMENT.md)),
so `CORE_ENCRYPTION_KEY` is required whenever legacy rows exist — the copier cannot decrypt Core-bound
ciphertext with QM's key. On a database with no `canvas_integrations` rows the copier is a no-op and the
Core variables may be omitted. If rows *do* exist and `CORE_DATABASE_URL` is unset the copier exits
non-zero rather than silently skipping, which fails the container start — set both variables before
deploying an instance that has ever connected Canvas from QM. Dry run:

```bash
npm run db:migrate:canvas-to-core -w question-maker-backend -- --dry-run
```

The API is available at `http://localhost:8000` by default.

## API Endpoints

All routes except `/healthz`, `/`, and `/api/internal/*` (service-key auth) require a valid Core session
cookie. See each route file under `src/routes/` for full request/response shapes.

| Domain | Base path | Examples |
|---|---|---|
| Courses & topics | `/api/course` | list/create/update/delete a course, `GET /:id/access`, `GET/POST /:id/topics`, `PATCH /:id/link-core`, `POST /:id/sync-topics` |
| Topics | `/api/topics` | `GET /sync-status/:courseId` |
| Questions | `/api/questions` | CRUD, `GET /stats`, `GET /export`, `POST /generate` (AI), `POST /extract` + `/extract/save` (OCR), `POST /approve` |
| Variants | `/api/questions/:id/variants`, `/api/questions/variants/:variantId` | create/list/update/delete a variant, `PATCH /variants/:variantId/testable` |
| Assessments | `/api/assessments` | CRUD, question ordering, sections, section-variant links |
| Variant assembly | `/api/assessment-variant` | `POST /assemble-variants`, `/assemble-by-metadata`, `/generate-bank-variants`, `/review-variant-ai` |
| EduAI proxy | `/api/eduai` | `POST /chat`, `POST /generate-questions`, course/topic lookups, `GET /ai-models` |
| Canvas | `/api/canvas` | connect/disconnect integration, list Canvas courses/quizzes/questions |
| Auth | `/api` | `GET /auth/me`, `POST /auth/logout` (proxies to Core) |
| Bug reports | `/api` | `POST /bug-reports`, admin triage (`/admin/bug-reports`) |
| Internal (service key) | `/api/internal` | `DELETE /courses/:coreCourseId` — cascade delete pushed from Core |

## Environment Variables

Full reference with comments: `apps/extensions/question-maker/.env.example`. Key variables:

| Variable | Description | Required |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `CORE_URL` | Base URL of EduAI Core (session validation, course/enrollment reads) | Yes |
| `CORE_AUTH_TIMEOUT_MS` | Deadline in milliseconds for Core session-validation and logout calls (default `5000`) | No |
| `EXTENSION_URL` | This service's public URL (post-Core-login redirect target) | Yes |
| `CORS_ORIGINS` | Comma-separated allowed browser origins | Yes |
| `ENCRYPTION_KEY` | 32-byte hex key for encrypting stored Canvas API keys | Yes in production |
| `EDUAI_API_URL` / `EDUAI_API_KEY` | Core/EduAI service integration; `EDUAI_API_KEY` must match Core for session validation | `EDUAI_API_KEY`: Yes; URL: Yes for AI features |
| `GROQ_API_KEY` / `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` | Direct provider fallbacks for question generation | No |
| `TEST_DATABASE_URL` | Postgres URL for the integration test suite | Only for `npm run test:integration` |

## Database Schema

The schema is defined in [`prisma/schema.prisma`](prisma/schema.prisma) — read that file directly rather
than a hand-copied summary here, since it's the actual source of truth and this doc will drift otherwise.

Note that QM no longer owns a `CanvasIntegration` model: Canvas credentials are stored once, in Core, and
QM reaches Canvas through Core's proxy routes (#1084). Any pre-existing QM `canvas_integrations` rows are
copied into Core on deploy — see "Adopting an existing deployment" above.

## Development

### Adding new features
1. Add/extend models in `prisma/schema.prisma`, then `npx prisma migrate dev --name <change>`
2. Add business logic in `src/services/`
3. Add/extend routes in `src/routes/`
4. Add or update tests in `tests/unit/` and `tests/integration/`, and document them in the repo-root
   `TESTS.md`

### Testing
```bash
npm test              # unit + integration
npm run test:coverage # coverage report
```
Integration tests need `TEST_DATABASE_URL` set; without it they self-skip and only unit tests run.

### Linting
```bash
npm run lint
```

## Deployment

- `Dockerfile` — production image; baselines (if needed), copies any QM-only Canvas credentials into Core,
  then runs `prisma migrate deploy` before starting the server — see "Adopting an existing deployment"
  above and [`docs/DEPLOYMENT.md`](../../../../../docs/DEPLOYMENT.md)
- `Dockerfile.dev` — development image; runs `npm run dev` (migrate + seed:if-empty + nodemon)
- Environment-based configuration (see Environment Variables above)
- Rate limiting, Helmet, and CORS are enabled by default

## License

MIT License - see LICENSE file for details
