# AiTutor Backend (`server/`)

Express 5 API for AiTutor. Handles authentication, RBAC, course content CRUD, AI tutoring flows, admin operations, bug report management, and Prisma-backed persistence.

## Architecture

```
server/
  src/
    index.js              # Bootstrap: load env, create app, listen on PORT
    app.js                # Express app factory (createApp), middleware + route mounting
    auth.js               # Better Auth config (EduAI OAuth, Prisma adapter, cookies)
    config/
      database.js         # PrismaClient singleton
      bootstrapAdmins.js  # Hardcoded admin email list
    middleware/
      auth.js             # attachSession, requireAuth, requireRole, requireRoles
    routes/
      authentication.js   # GET /me
      courses.js          # Course CRUD, EduAI import, publish/unpublish
      modules.js          # Module CRUD, publish/unpublish
      lessons.js          # Lesson CRUD, publish/unpublish
      activities.js       # Activity CRUD, answer submission, AI chat, feedback
      topics.js           # Topic CRUD, EduAI sync, remapping
      prompts.js          # Prompt template management
      suggested-prompts.js# Read-only suggested prompts
      ai-models.js        # AI model listing, API key validation
      admin.js            # User/course/enrollment/settings management
      bug-reports.js      # Bug report creation and admin triage
    services/
      aiGuidance.js       # Core AI chat: dual-loop tutor-supervisor pattern
      aiModelPolicy.js    # Model policy: allowed models, defaults, cost tiers
      activityEvaluation.js # MCQ/SHORT_TEXT answer evaluation
      activityAnalytics.js  # Per-activity metrics, difficulty scoring
      courseCloning.js     # Deep-clone courses (modules, lessons, activities, topics)
      progressCalculation.js # Course/module/lesson progress calculation
      eduaiClient.js      # HTTP client for EduAI API
      eduaiAuth.js        # EduAI OAuth access token retrieval
      topicSync.js        # Sync topics from EduAI
      enrollmentSync.js   # Sync enrollments from EduAI (creates users/accounts)
      systemSettings.js   # Key-value settings store (DB-backed)
      bugReports.js       # Bug report business logic
    schemas/
      eduai.js            # Zod schemas for EduAI API responses
    utils/
      mappers.js          # Response mappers (user, course, module, lesson, activity, progress)
      bugReportMappers.js # Bug report response mappers
  prisma/
    schema.prisma         # Database schema (PostgreSQL)
    seed.ts               # Seed script (destructive reset + demo data)
    migrations/           # Migration history
  test/
    globalSetup.js        # Test DB setup
    setup.js              # Test environment config
    helpers.js            # Test utilities
    unit/                 # Unit tests (5 files)
    integration/          # Integration tests (8 files)
```

## Request Flow

The middleware chain in `app.js` processes requests in this order:

1. **CORS** — Open origin with `credentials: true`.
2. **Better Auth** — Mounted at `/api/auth/{*any}` (handles its own body parsing).
3. **JSON parser** — `express.json()` for all subsequent routes.
4. **Health check** — `GET /api/health` runs `SELECT 1` against the database.
5. **Session hydration** — `attachSession` resolves Better Auth cookies and hydrates `req.user` from Prisma.
6. **Auth gate** — `requireAuth` enforced for all `/api/*` except `/api/health` and `/api/auth/*`.
7. **Admin isolation** — Users with `role === 'ADMIN'` can only access `/api/me`, `/api/admin/*`, and `/api/ai-models/*`.
8. **Route modules** — All 11 route files mounted at `/api`.

## Authentication

- **Provider**: Better Auth with EduAI OAuth (OIDC + PKCE) via the `genericOAuth` plugin.
- **Email/password**: Disabled. All authentication goes through EduAI SSO.
- **Session storage**: Better Auth `Session` table in PostgreSQL, exposed as cookies.
- **Role source**: Extracted from EduAI's custom claim `https://eduai.app/role`, normalized to enum values.
- **Cookie config**: Domain from `COOKIE_DOMAIN`, secure in production, `sameSite=lax`.
- **Trusted origins**: `localhost:5173` (dev) and `aitutor.ok.ubc.ca` (production).
- **Account linking**: Enabled with `eduai` as a trusted provider.

## RBAC

### Roles

`STUDENT`, `PROFESSOR`, `TA` (unsupported), `ADMIN`. See [SYSTEM_OVERVIEW.md](../docs/SYSTEM_OVERVIEW.md) for full permissions.

### Middleware

| Function | Purpose |
|----------|---------|
| `attachSession(req, res, next)` | Resolves session from cookies, hydrates `req.user` |
| `requireAuth(req, res, next)` | Returns 401 if `req.user` is null |
| `requireRole(role)` | Returns 403 if `req.user.role !== role` |
| `requireRoles([...])` | Returns 403 if `req.user.role` not in array |

### Admin Isolation

After authentication, an explicit isolation rule blocks admins from non-admin endpoints. If `req.user.role === 'ADMIN'`, the only allowed paths are:
- `/api/me`
- `/api/admin/*`
- `/api/ai-models/*`

All other `/api/*` requests return `403 Admins can only access admin endpoints`.

## API Surface

All routes are mounted under `/api`. See [docs/api-reference.md](../docs/api-reference.md) for the complete endpoint reference with request/response shapes.

### Quick Reference

| Module | Endpoints | Auth |
|--------|-----------|------|
| System | `GET /health` | None |
| Auth | `GET /me` | Any authenticated |
| Courses | 9 endpoints | PROFESSOR (write), course member (read) |
| Modules | 5 endpoints | PROFESSOR (write), course member (read) |
| Lessons | 5 endpoints | PROFESSOR (write), course member (read) |
| Activities | 9 endpoints | PROFESSOR (write), course member (read/submit) |
| Topics | 4 endpoints | PROFESSOR (write), course member (read) |
| Prompts | 2 endpoints | PROFESSOR |
| Suggested Prompts | 1 endpoint | Any authenticated |
| AI Models | 2 endpoints | Any authenticated |
| Admin | 12 endpoints | ADMIN |
| Bug Reports | 3 endpoints | STUDENT/PROFESSOR (create), ADMIN (manage) |

## AI Tutoring System

### Three Chat Modes

| Mode | Prompt Template | Purpose |
|------|----------------|---------|
| Teach | `learning-prompt` | Concept explanation, calibrated to knowledge level |
| Guide | `exercise-prompt` | Problem-solving help without revealing answers |
| Custom | Activity's `customPrompt` | Instructor-authored, activity-specific prompt |

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

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `DATABASE_URL` | Yes | - | PostgreSQL connection string |
| `PORT` | No | `4000` | Express listen port |
| `NODE_ENV` | No | - | `production` enables secure cookies |
| `BETTER_AUTH_SECRET` | Yes | - | Session signing secret |
| `BETTER_AUTH_URL` | No | `http://localhost:4000/api/auth` | Better Auth base URL |
| `COOKIE_DOMAIN` | No | `localhost` | Session cookie domain |
| `EDUAI_DISCOVERY_URL` | Yes | - | EduAI OIDC discovery endpoint |
| `EDUAI_CLIENT_ID` | Yes | - | OAuth client ID |
| `EDUAI_CLIENT_SECRET` | Yes | - | OAuth client secret |
| `EDUAI_USERINFO_URL` | Yes | - | EduAI user info endpoint |
| `EDUAI_BASE_URL` | No | `http://localhost:5174/api` | EduAI API base URL |
| `EDUAI_API_KEY` | Recommended | - | Default EduAI API key |
| `EDUAI_MODEL` | No | `google:gemini-2.5-flash` | Default tutor model |

### EduAI API Key Precedence

1. Admin override in `SystemSetting` (set via `/api/admin/settings/eduai-api-key`).
2. Fallback to `EDUAI_API_KEY` environment variable.
3. If neither exists, EduAI-dependent endpoints fail with configuration errors.

## Database

### Schema

15 domain models + 3 Better Auth tables. Key relationships:

```
CourseOffering ─┬─ Module ─── Lesson ─── Activity ─┬─ Submission
                ├─ CourseInstructor                 ├─ AiChatSession ── AiInteractionTrace
                ├─ CourseEnrollment                 ├─ ActivityFeedback
                └─ Topic ──────────────────────────┘├─ ActivityAnalytics
                                                    └─ ActivityStudentMetric
```

See `server/prisma/schema.prisma` for the full schema.

### Migrations

```bash
# Apply migrations
cd server && bunx prisma migrate deploy

# Create a new migration after schema changes
cd server && bunx prisma migrate dev --name description_of_change
```

### Seed Data

```bash
cd server && bun run seed
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
- **Mock auth**: `createApp({ mockUser })` bypasses Better Auth for testing

### Commands

```bash
cd server
bun run test              # All tests
bun run test:unit         # Unit tests only
bun run test:integration  # Integration tests only
bun run test:watch        # Watch mode
```

### Test Structure

```
test/
  globalSetup.js          # Database preparation
  setup.js                # Environment config
  helpers.js              # createTestApp(), test utilities
  unit/                   # 5 unit test files
  integration/            # 8 integration test files
```
