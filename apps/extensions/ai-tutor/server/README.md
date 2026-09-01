# AiTutor Backend (`server/`)

Express 5 API for AiTutor. Handles authentication, RBAC, course content CRUD, AI tutoring flows, admin operations, bug report management, and Prisma-backed persistence.

## Develop with the monorepo

Prefer starting databases and Core from the **repo root** (`npm run dev` or `npm run docker:dev:db`). This server expects Core at `CORE_URL` (default `http://localhost:3000`) for `POST /api/sessions/validate`.

```bash
# from repo root — API only
npx turbo run dev --filter=ai-tutor-server
# or:
cd apps/extensions/ai-tutor/server && npm run dev
```

Do not document a standalone `docker compose up -d db` inside this package as the primary setup path.

## Architecture

```
server/
  src/
    index.js              # Bootstrap: load env, create app, listen on PORT
    app.js                # Express app factory (createApp), middleware + route mounting
    config/
      database.js         # PrismaClient singleton
      cors.js             # Exact-origin CORS allowlist configuration
      bootstrapAdmins.js  # Hardcoded admin email list
    middleware/
      auth.js             # requireAuth, requireRole, requireRoles, requireInstructorPolicy
      csrf.js              # requireSameOriginMutation: rejects cross-origin cookie-authenticated mutations unless a verified service-key Bearer is present
      serviceAuth.js       # requireServiceKey: gates the /api/internal/* routes
    routes/
      authentication.js   # GET /me, POST /logout
      courses.js          # Course CRUD, EduAI import, publish/unpublish
      modules.js          # Module CRUD, publish/unpublish
      lessons.js          # Lesson CRUD, publish/unpublish
      activities.js       # Activity CRUD, answer submission, AI chat, feedback
      topics.js           # Topic CRUD, EduAI sync, remapping
      prompts.js          # Prompt template management
      suggested-prompts.js# Read-only suggested prompts
      ai-models.js        # AI model listing, API key validation
      ai-status.js         # GET /ai-status, proxies Core's model-fleet status
      admin.js            # User/course/enrollment/settings management
      bug-reports.js      # Bug report creation and admin triage
      internal.js          # Service-to-service routes (course deletion mirror), requireServiceKey only
    services/
      aiGuidance.js       # Core AI chat: dual-loop tutor-supervisor pattern
      aiModelPolicy.js    # Model policy: allowed models, defaults, cost tiers
      activityEvaluation.js # MCQ/SHORT_TEXT answer evaluation
      activityAnalytics.js  # Per-activity metrics, difficulty scoring
      courseCloning.js     # Deep-clone courses (modules, lessons, activities, topics)
      progressCalculation.js # Course/module/lesson progress calculation
      eduaiClient.js      # HTTP client for EduAI API
      eduaiAuth.js        # Extracts the Core session cookie for forwarding on EduAI API calls
      topicSync.js        # Sync topics from EduAI
      enrollmentSync.js   # Sync enrollments from EduAI (creates users/accounts)
      systemSettings.js   # Key-value settings store (DB-backed)
      bugReports.js       # Bug report business logic
      liveCoursePrincipal.js # authorizeLiveCoursePrincipal: re-resolves a staff caller's role against Core on every gated action instead of trusting the local mirror
      # ~15 more single-purpose services not listed here (cloning/analytics/pagination
      # helpers, URL-consistency checks, policy caching, etc.) — see src/services/ for
      # the full, current list
    schemas/
      eduai.js            # Zod schemas for EduAI API responses
    utils/
      mappers.js          # Response mappers (user, course, module, lesson, activity, progress)
      bugReportMappers.js # Bug report response mappers
  prisma/
    schema.prisma         # Database schema (PostgreSQL)
    seed.ts               # Seed script (destructive reset + demo data)
    migrations/           # Migration history
  tests/
    globalSetup.js        # Test DB setup
    setup.js              # Test environment config
    helpers.js            # Test utilities
    unit/                 # Unit tests (5 files)
    integration/          # Integration tests (8 files)
```

## Request Flow

The middleware chain in `app.js` processes requests in this order:

1. **CORS** — Exact-origin allowlist via `CORS_ORIGINS` with `credentials: true`.
2. **JSON parser** — `express.json()` for all routes.
3. **Health check** — `GET /api/health` runs `SELECT 1` against the database.
4. **Auth gate** — `requireAuth` (`middleware/auth.js`) posts the incoming cookie to Core's
   `POST /api/sessions/validate` and populates `req.user` from the response; enforced for all
   `/api/*` except `/api/health` and `POST /api/logout`.
5. **Admin isolation** — see [Admin Isolation](#admin-isolation) below for the full allowed-path
   list; `UNIT_ADMIN` is additionally blocked from `/api/admin/settings/*` and `/api/admin/users*`.
6. **CSRF** — `requireSameOriginMutation` (`middleware/csrf.js`) rejects a cross-origin,
   cookie-authenticated mutation unless the request carries a verified service-key Bearer token.
7. **Route modules** — All 13 route files mounted at `/api`; `internal.js` sits outside the
   `requireAuth` gate and is protected only by `requireServiceKey` (`middleware/serviceAuth.js`).

## Authentication

- **Provider**: None locally — session validation is proxied to Core via `CORE_URL`
  (`middleware/auth.js`). There is no local login flow, OAuth client, or session store; this
  server has no `auth.js` and no Better Auth tables in its Prisma schema.
- **Session check**: Every `/api/*` request (except `/api/health` and `POST /api/logout`)
  forwards its `Cookie` header to Core's `POST /api/sessions/validate`; a non-OK response is a 401.
- **Role source**: Whatever `role` Core's validate response reports, normalized to one of
  `STUDENT`, `INSTRUCTOR`, `TA`, `ADMIN`, `UNIT_ADMIN` (unrecognized values fall back to
  `STUDENT`).
- **Logout**: `POST /api/logout` proxies to Core's `/api/auth/sign-out` server-to-server,
  bypassing browser CORS; it's excluded from the auth gate so signing out an invalid session
  is a no-op, not a 401.

## RBAC

### Roles

`STUDENT`, `INSTRUCTOR`, `TA`, `ADMIN`, `UNIT_ADMIN`. See [SYSTEM_OVERVIEW.md](../docs/SYSTEM_OVERVIEW.md) for full permissions.

### Middleware

| Function                        | Purpose                                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `requireAuth(req, res, next)`   | Validates the session cookie against Core and hydrates `req.user`; returns 401 if absent/invalid          |
| `requireRole(role)`             | Returns 403 if `req.user.role !== role`                                                                   |
| `requireRoles([...])`           | Returns 403 if `req.user.role` not in array                                                               |
| `requireInstructorPolicy(flag)` | Returns 403 for an `INSTRUCTOR` when the named Core policy flag is disabled (ADMIN/UNIT_ADMIN unaffected) |
| `requireSameOriginMutation` (`middleware/csrf.js`) | Rejects a cross-origin, cookie-authenticated mutation unless the request also carries a verified service-key Bearer token |
| `requireServiceKey` (`middleware/serviceAuth.js`)  | Gates `/api/internal/*`; the only routes exempt from the normal `requireAuth` cookie flow |
| `authorizeLiveCoursePrincipal` (`services/liveCoursePrincipal.js`) | The actual staff-authorization engine behind most write endpoints — re-resolves the caller's role against Core on every gated action rather than trusting the local `CourseInstructor`/`CourseEnrollment` mirror |

Configurable permissions are owned by Core. `services/policyService.js` fetches `GET {EDUAI_BASE_URL}/policies` with the service key and caches the result on a short TTL (falling back to the last known-good value on a Core outage). `requireInstructorPolicy('instructors.canCreateCourses')` gates `POST /courses` so an admin can enable/disable instructor course creation centrally.

### Admin Isolation

After authentication, an explicit isolation rule blocks admins from most non-admin endpoints — but not
all of them. If `req.user.role === 'ADMIN'`, `isAllowedAdminPath()` in `app.js` permits:

- `/api/me`
- `/api/admin/*`
- `/api/ai-status`, `/api/ai-models`, `/api/ai-models/*`
- `/api/bug-reports`
- `/api/prompts`, `/api/prompts/*`
- The shared course/module/lesson/activity/topic tree: `/api/courses`, `/api/courses/*`,
  `/api/modules/*`, `/api/lessons/*`, `/api/activities/*`, `/api/topics`, `/api/topics/*` — admins
  share the same Courses dashboard instructors use, rather than being fenced out of course content
  entirely.

All other `/api/*` requests return `403 Admins can only access admin endpoints`. `UNIT_ADMIN` gets a
narrower additional block on top of the ordinary role checks: `/api/admin/settings/*` and
`/api/admin/users*` stay `ADMIN`-only.

## API Surface

All routes are mounted under `/api`. See [docs/api-reference.md](../docs/api-reference.md) for the complete endpoint reference with request/response shapes.

### Quick Reference

| Module            | Endpoints     | Auth                                                                             |
| ----------------- | ------------- | --------------------------------------------------------------------------------- |
| System            | `GET /health` | None                                                                             |
| Auth              | 2 endpoints   | Any authenticated (`POST /logout` bypasses the auth gate entirely)              |
| Courses           | 16 endpoints  | INSTRUCTOR/UNIT_ADMIN/ADMIN (write), course member (read)                       |
| Modules           | 10 endpoints  | INSTRUCTOR/UNIT_ADMIN/ADMIN (write), course member (read)                       |
| Lessons           | 11 endpoints  | INSTRUCTOR/UNIT_ADMIN/ADMIN (write), course member (read)                       |
| Activities        | 21 endpoints  | INSTRUCTOR/UNIT_ADMIN/ADMIN (write), STUDENT-in-course (submit/AI chat), course staff (grading) |
| Topics            | 4 endpoints   | INSTRUCTOR/UNIT_ADMIN/ADMIN (write), course member (read)                       |
| Prompts           | 2 endpoints   | INSTRUCTOR/UNIT_ADMIN/ADMIN                                                     |
| Suggested Prompts | 1 endpoint    | Any authenticated                                                                |
| AI Models         | 2 endpoints   | Any authenticated                                                                |
| AI Status         | 1 endpoint    | Any authenticated                                                                |
| Admin             | 14 endpoints  | ADMIN (enrollment endpoints also allow course-authorized UNIT_ADMIN/INSTRUCTOR) |
| Bug Reports       | 4 endpoints   | Any authenticated (create), ADMIN (manage)                                      |
| Internal          | 1 endpoint    | Service key only — not reachable by browser clients                             |

See [`../docs/rbac-endpoints-ai-tutor.md`](../docs/rbac-endpoints-ai-tutor.md) for the complete per-endpoint auth-gate table.

## AI Tutoring System

### Three Chat Modes

| Mode   | Prompt Template           | Purpose                                            |
| ------ | ------------------------- | -------------------------------------------------- |
| Teach  | `learning-prompt`         | Concept explanation, calibrated to knowledge level |
| Guide  | `exercise-prompt`         | Problem-solving help without revealing answers     |
| Custom | Activity's `customPrompt` | Instructor-authored, activity-specific prompt      |

### Dual-Loop Supervisor

Configurable via admin AI model policy. See [SYSTEM_OVERVIEW.md](../docs/SYSTEM_OVERVIEW.md) for the conceptual explanation.

Implementation specifics:

- Supervisor feedback is prepended to tutor retries as `[SUPERVISOR FEEDBACK: ...]`.
- Loops up to `maxSupervisorIterations` (configurable 1–5, default 3).
- If all iterations fail, a safe fallback message is returned.

### Interaction Logging

Every AI interaction is recorded in `AiInteractionTrace` with:

- Mode, knowledge level, user message, final response
- Final outcome: `approved`, `single_pass`, `safe_fallback`, or `error`
- Iteration count and full trace (all tutor drafts + supervisor verdicts)

See [docs/two-agent-supervisor-system.md](../docs/two-agent-supervisor-system.md) for the full design.

## Environment Variables

Source of truth: `server/.env.example`.

| Variable                        | Required    | Default                                                                                                         | Purpose                                                                                                                                                                  |
| ------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                  | Yes         | -                                                                                                               | PostgreSQL connection string                                                                                                                                             |
| `NODE_ENV`                      | Yes         | `development` in the generated local `.env`                                                                     | Selects runtime defaults; production deployments must set `production` explicitly                                                                                        |
| `PORT`                          | No          | `4000`                                                                                                          | Express listen port                                                                                                                                                      |
| `CORE_URL`                      | Yes         | `http://localhost:3000`                                                                                         | Core base URL — session validation is proxied here (`middleware/auth.js`), not handled locally                                                                           |
| `CORE_AUTH_TIMEOUT_MS`          | No          | `5000`                                                                                                          | Deadline in milliseconds for Core session-validation and logout requests; invalid or non-positive values use the default                                                 |
| `EDUAI_BASE_URL`                | No          | `http://localhost:3000/api`                                                                                     | Core API base URL (course import/sync, policies, chat completion)                                                                                                        |
| `EDUAI_API_KEY`                 | Recommended | -                                                                                                               | Default EduAI API key                                                                                                                                                    |
| `EDUAI_MODEL`                   | No          | `google:gemini-2.5-flash`                                                                                       | Default tutor model                                                                                                                                                      |
| `CORS_ORIGINS`                  | No          | `http://localhost:3001` only when `NODE_ENV` is explicitly `development` or `test`; otherwise empty/fail-closed | Comma-separated canonical browser origins with no wildcards, paths, queries, fragments, or credentials; deployments must configure every trusted frontend origin         |
| `POLICY_CACHE_TTL_MS`           | No          | `30000`                                                                                                         | TTL for the cached Core RBAC policy flags (`policyService`)                                                                                                              |
| `EDUAI_ENFORCE_URL_CONSISTENCY` | No          | -                                                                                                               | Set to `1` to fail startup (instead of only warning) when `CORE_URL` and `EDUAI_BASE_URL` resolve to different origins — see `services/urlConsistency.js` (#225 SEAM-05) |
| `ENCRYPTION_KEY`                | Recommended | -                                                                                                               | AES-256-GCM key that encrypts the admin `EDUAI_API_KEY` override at rest in `SystemSetting`; without it the admin key-write endpoint fails closed (503) instead of persisting the secret in plaintext |
| `CORE_PUBLIC_ORIGIN`            | No          | Falls back to `CORE_URL`                                                                                       | Overrides the origin used to build the Core sign-out redirect target in `POST /logout`, for setups where the browser-facing Core origin differs from `CORE_URL` |
| `CORE_MIRROR_THROTTLE_MS`       | No          | `60000`                                                                                                         | Minimum interval between background Core auto-import mirror runs for the same user (`importTaughtCoursesService.js`); a freshly-imported course only appears on the caller's *next* request |
| `AI_KEY_VALIDATION_TIMEOUT_MS`  | No          | `5000` (Google/OpenAI); `45000` for the OpenCode probe                                                         | Deadline for a `POST /ai-models/validate-key` provider round-trip |
| `AI_KEY_VALIDATION_MAX_TRACKED_USERS` | No    | `10000`                                                                                                         | Hard cap on distinct user identities tracked by the in-process key-validation rate limiter |

When `EDUAI_BASE_URL` is unset, `services/eduaiClient.js` still falls back to `http://localhost:5174/api` (legacy); use `.env.example` or set it explicitly for local dev.

### EduAI API Key Precedence

1. Admin override in `SystemSetting` (set via `/api/admin/settings/eduai-api-key`).
2. Fallback to `EDUAI_API_KEY` environment variable.
3. If neither exists, EduAI-dependent endpoints fail with configuration errors.

## Database

Dependencies are installed from the monorepo root (`npm install`); use the following only for package-local commands.

### Schema

18 domain models — no Better Auth tables (session validation is delegated to Core). Key relationships:

```
CourseOffering ─┬─ Module ─── Lesson ─── Activity ─┬─ Submission
                ├─ CourseInstructor                 ├─ AiChatSession ── AiInteractionTrace
                ├─ CourseEnrollment                 ├─ ActivityFeedback
                └─ Topic ──────────────────────────┘├─ ActivityAnalytics
                                                    └─ ActivityStudentMetric
```

See `server/prisma/schema.prisma` for the full schema.

Submission attempt numbers are unique per `(userId, activityId)`. The answer-submission path
allocates the next number inside an interactive transaction, while the database constraint is the
final concurrency guard and only collisions on that exact constraint are retried.

### Indexes

Every foreign key in the tree above can be seeked on by its leading column (#1374). Postgres
does not auto-index FK child columns and Prisma only emits indexes for `@id` / `@unique` /
`@@unique`, so **adding a relation means making sure its column leads some index** — otherwise
the parent-to-children read and the `ON DELETE CASCADE` both fall back to a sequential scan.

That does not always mean a new `@@index`. A column that appears only in the *trailing* half of
a composite key is not covered — a btree on `(userId, activityId)` cannot serve
`WHERE activityId = ?` — but a column that already *leads* a PK or unique is, and giving it a
standalone index just duplicates that one on every write.

The same rule applies to `userId`, which carries no FK at all (Core owns the User table) and is
therefore invisible to that audit: it leads its own index on `CourseEnrollment` because the "my
courses" read filters on it alone, and on `Submission` it needs no index of its own because
`@@unique([userId, activityId, attemptNumber])` already leads with it.

`tests/integration/foreignKeyIndexes.test.js` enforces this against the live test database, so a
new unindexed relation fails CI rather than quietly regressing. The one intentional exception
(`Activity.promptTemplateId`, never filtered on and never orphaned) is pinned there and
explained in `docs/perf/backend/foreign-key-indexes-ai-tutor.md`.

### Migrations

```bash
# Apply migrations
cd apps/extensions/ai-tutor/server && npx prisma migrate deploy

# Create a new migration after schema changes
cd apps/extensions/ai-tutor/server && npx prisma migrate dev --name description_of_change
```

### Seed Data

```bash
cd apps/extensions/ai-tutor/server && npm run seed
```

> **Warning:** The seed script is destructive. It calls `clearDatabase()` and deletes all existing rows before inserting demo data.

Seed creates:

- 4 users (2 students, lead instructor, assistant instructor)
- 3 courses with full module/lesson/activity trees
- 5 prompt templates (knowledge-check, debugging, learning, exercise, supervisor)
- 8 suggested prompts (4 teach, 4 guide)
- 1 global base system prompt
- Sample submissions and instructor assignments

## Testing

- **Runner**: Vitest 4 with supertest for HTTP assertions
- **Config**: `server/vitest.config.js` (node environment, forks pool, 15s timeout)
- **Test DB**: Configured via `.env.test` (database `aitutor_test`, port 4001)
- **Mock auth**: `createApp({ mockUser })` bypasses the Core session-validation call and injects `mockUser` as `req.user` directly

### Commands

```bash
cd apps/extensions/ai-tutor/server
npm run test              # All tests
npm run test:unit         # Unit tests only
npm run test:integration  # Integration tests only
npm run test:watch        # Watch mode
```

### Test Structure

```
tests/
  globalSetup.js          # Database preparation
  setup.js                # Environment config
  helpers.js              # createTestApp(), test utilities
  unit/                   # 5 unit test files
  integration/            # 8 integration test files
```
