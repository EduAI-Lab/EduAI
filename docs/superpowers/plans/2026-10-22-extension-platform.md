# Extension Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Already-built honours projects join EduAI as extensions through a scoped API, one registry entry and a runnable starter, without hand-editing shared code for each new extension.

**Architecture:**
- Core gains a second kind of caller, an *extension principal*. It is resolved once in root middleware and checked against a default-deny route policy.
- A JSON registry drives the launcher, bug-report identity, callbacks, local setup, CI and ops.
- New extensions start from a starter (React Router web + Express server) built on a thin SDK.

**Tech Stack:** React Router 7, Vite, Tailwind 4, `@eduai/ui`, Express 5, Prisma 6 + Postgres, zod, Vitest, Playwright, turbo, node:test, systemd + Apache.

**Spec:** `docs/superpowers/specs/2026-10-22-extension-platform-design.md`. Decisions and evidence: `docs/implementations/extension-platform-review.md`.

**How to use this plan:** it fixes scope, files, interfaces, tests and order. Before coding a milestone, write that milestone's step-by-step TDD plan with superpowers:writing-plans from its section below.

## Global Constraints

**Process**
- PRs target `development`, one milestone per PR series.
- Link #2000 on each PR with the `addCloseIssueReferences` GraphQL mutation; `Closes #N` does not link here.
- Never commit `MEMORY.md` changes; restore it from `origin/development`.
- No CHANGELOG entries.
- Each new test file gets one row appended at the end of `TESTS.md`; existing rows are never edited.

**Prisma**
- Hand-edit `schema.prisma` (never `prisma format`), then run `prisma validate`.
- Trim `prisma migrate diff` output to the new statements.
- Integration tests use `db push`, so any raw-SQL part of a migration must also be applied in `apps/core/app/tests/globalSetup.ts`.

**Lint and local runs**
- oxlint, oxfmt and the anti-slop rules must pass: no `unknown` params or returns, no union-valued dictionaries, no bare `object` params.
- The one known local unit failure (reembed, caused by local `.env`) is not a regression.
- In a git worktree: copy `apps/core/.env` in, and never run `npm i` or `prisma generate`. Symlinked `node_modules` resolve `@eduai/*` to the main checkout.

**Credentials and access**
- Personal `x-api-key` grants (#2040) and legacy `EDUAI_API_KEY` callers behave exactly as today.
- A new extension never receives the legacy key.
- Extension keys travel only in `x-extension-key: <keyId>.<secret>`. They never share a header with personal keys or the legacy Bearer key, so no existing Bearer-first branch can treat one as unscoped service access.
- Default deny: an extension caller reaches only routes in the permission matrix (Task 1.1).
- Key plus cookie needs both the extension permission and the user's own course/role permission.
- An invalid or expired key never falls back to cookie access.
- Browser bundles get only the registry's public fields.
- Extensions never hold Core DB or encryption secrets.

**Deployment and inference**
- No live deployment of the starter or a pilot before Task 2.5's isolation checks pass under maintainer-controlled deployment.
- Production inference is campus models only. Tests mock completion; the e2e stack has no chat model.

## Milestones

| # | Deliverable | Size | Needs |
|---|---|---|---|
| 1 | Permission matrix, API reference, ownership and intake docs | S | — |
| 2 | Extension principal, route policy, budgets and usage, isolated deployment profile | L | 1 |
| 3 | Registry, launcher, bug-report identity, per-extension callbacks | M | 1, plus 2.1 |
| 4 | SDK and starter | M | 2, 3 |
| 5 | Scaffold, dev/CI/build/ops discovery, fourth-extension acceptance, pilot port | M–L | 4, the professor's option, a named pilot |

Milestones 2 and 3 can overlap once 1 is agreed.

---

## Milestone 1: Contracts (docs only)

### Task 1.1: Permission matrix and API reference

**Files:**
- Create: `docs/extensions/API.md`
- Modify: `docs/EXTENSION_ONBOARDING.md` §7. Link to API.md, and drop the "share `EDUAI_API_KEY`" step for new extensions.
- Fix in the same file: the onboarding doc says a bare service key can `POST /api/questions`. In the code, POST requires a session.

**Matrix.** Each row gives the permission, the method and path, the actor, the course check, the response projection and the error codes. Files are under `apps/core/app/routes/api/`.

| Permission | Route (file) | Actor |
|---|---|---|
| `sessions:validate` | `POST /api/sessions/validate` (`sessions.validate.ts`) | key + cookie |
| `courses:read` | `GET /api/courses` (`courses.$.ts`), `GET /api/courses/:id` (`courses.id.ts`) | key + cookie |
| `topics:read` | `GET /api/courses/:courseId/topics` (`courses.topics.$.ts`) | key + cookie |
| `enrollments:read` | `GET /api/courses/:id/enrollments` (`courses.enrollments.ts`) | key + cookie of an instructor, TA or admin of that course |
| `models:read` | `GET /api/models` (`models.ts`) | key, optional cookie; approved models only |
| `completion` | `POST /api/completion` (`completion.ts`) | key, optional cookie; approved models, extension budgets |
| `policies:read` | `GET /api/policies` (`policies.ts`) | key; public values only |
| `bug-reports:write` | `POST /api/bug-reports` (`bug-reports.ts`) | key + cookie; source = the extension's id |
| `questions:read`, `questions:write` | `/api/questions` (`questions.ts`), `/api/questions/:id` (`questions.$id.ts`) | key + cookie; answers stripped for students |
| `banks:read`, `banks:write` | `/api/courses/:courseId/banks[/*]` (`courses.banks.$.ts`) | key + cookie |
| `lifecycle:read` | `GET /api/extensions/courses/status?ids=` (new in Task 3.4) | key only; returns `{ id, deleted }` |

Denied to every extension key: auth, account and admin routes, `/api/ai-models`, `/api/chat`, materials, Canvas and embeddings.

Write API.md language-neutral, with a curl example for every row, so a team with a non-Node backend can implement the contract without the SDK.

**Done when:** every path resolves in `apps/core/app/routes.ts`, and a Core reviewer and a security reviewer approve.

### Task 1.2: Ownership rules and intake template

**Files:**
- Create: `docs/extensions/OWNERSHIP.md`. Copy spec A5 as written: the Core-owned list, the three-rule intake test and the promotion recipe.
- Create: `docs/extensions/intake-template.md`, with fields for:
  - student lead, Core reviewer, ops owner
  - porting option, original repo and commit
  - every model, screen and API, each with its intake class
  - data handling and retention
  - permissions requested
  - promotion dependencies
  - review and demo dates
  - decommission steps: revoke the key, take a final dump, and drop the database after the retention period

**Done when:** the lead dev signs off. The professor's option is recorded when chosen.

---

## Milestone 2: Extension principal (L, 5 PRs)

### Task 2.1: Principal config and resolver

**Files:**
- Create: `apps/core/app/lib/extensions/principals.server.ts`
- Test: `apps/core/app/tests/unit/extension-principals.test.ts`
- Modify: `docs/ENVIRONMENT.md`, `infra/production/core.env.example` (add `EXTENSION_KEYS_FILE`)

**Produces:**
```ts
export type ExtensionPermission =
  | "sessions:validate" | "courses:read" | "topics:read" | "enrollments:read"
  | "models:read" | "completion" | "policies:read" | "bug-reports:write"
  | "questions:read" | "questions:write" | "banks:read" | "banks:write"
  | "lifecycle:read";

export interface ExtensionPrincipal {
  extensionId: string;
  keyId: string;
  expiresAt: Date;
  permissions: ReadonlySet<ExtensionPermission>;
  approvedModels: readonly string[];
  budget: { requestsPerDay: number; tokensPerDay: number; maxInflight: number };
}

export type ExtensionCaller =
  | { kind: "none" }
  | { kind: "invalid"; reason: "malformed" | "unknown" | "expired" | "disabled" }
  | { kind: "extension"; principal: ExtensionPrincipal };

export function resolveExtensionCaller(request: Request): ExtensionCaller;
export function getCallbackSecret(extensionId: string): string | null;
```

**Behaviour:**
- `EXTENSION_KEYS_FILE` names a root-owned JSON file:
  `{ keys: [{ extensionId, keyId, secretSha256, enabled, expiresAt, permissions, approvedModels, budget }], callbackSecrets: { "<extensionId>": "<secret>" } }`
- The file is loaded once at startup and validated with zod. An invalid file stops Core from starting.
- Digests are compared with `timingSafeEqual`, the same way `apps/core/app/lib/auth/service-key.server.ts` does.
- Rotating or removing a key means editing the file and restarting Core; document this in `docs/ENVIRONMENT.md`.

**Tests:**
- No header → `none`.
- A malformed, unknown, expired or disabled key → `invalid` with the matching reason.
- A valid key → `extension`, with its permissions.
- A legacy Bearer key or a personal `x-api-key` → `none`.
- An invalid config file → load throws.

### Task 2.2: Route policy at the root boundary

**Files:**
- Create: `apps/core/app/lib/extensions/route-policy.server.ts`
- Modify: `apps/core/app/root.tsx`, the middleware array at `:95` (CROSS_ORIGIN_MUTATION guard at `:123`)
- Test: `apps/core/app/tests/unit/extension-route-policy.test.ts`

**Produces:**
```ts
// null = not in the matrix → deny
export function requiredExtensionPermission(method: string, pathname: string): ExtensionPermission | null;
// memoized per Request in a WeakMap, so credentials resolve once
export function getExtensionCaller(request: Request): ExtensionCaller;
```

**Behaviour**, in order:
1. A caller of kind `invalid` → `401 { error: "EXTENSION_KEY_INVALID" }`, with no cookie fallback.
2. An extension caller whose route is unmapped, or whose permission isn't held → `403 { error: "EXTENSION_FORBIDDEN" }`.
3. An authorized extension mutation skips the CROSS_ORIGIN_MUTATION check.
4. Requests without the header are unchanged.

**Tests:**
- Every matrix row is allowed.
- Unknown, admin, auth and `/api/ai-models` paths are denied.
- The mutation bypass applies only to permitted calls.
- Header-less requests are untouched.

### Task 2.3: Routes honour "key plus user"

**Files:**
- Modify, all under `apps/core/app/routes/api/`: `sessions.validate.ts`, `courses.$.ts`, `courses.id.ts`, `courses.topics.$.ts`, `courses.enrollments.ts`, `models.ts`, `completion.ts`, `policies.ts`, `bug-reports.ts`, `questions.ts`, `questions.$id.ts`, `courses.banks.$.ts`
- Test: `apps/core/app/tests/integration/extension-auth.integration.test.ts`

**Rule for each route:**
- The legacy Bearer branch is unchanged.
- An extension caller with a cookie runs the existing user branch, with the same course access checks and answer stripping.
- An extension caller without a cookie gets `401`, unless the matrix marks the route key-only.

**Tests**, against the integration DB:
- An expired key with a valid cookie → `401`.
- A valid key plus a student not enrolled in the course → `403` on the roster.
- A valid key plus that course's instructor → `200` on the roster.
- A key with no cookie on the roster → `401`.
- A student actor gets questions without answers.
- The existing legacy and personal-key suites still pass.

### Task 2.4: Budgets and usage records

**Files:**
- Modify: `apps/core/prisma/schema.prisma`
- Create: `apps/core/prisma/migrations/<timestamp>_extension_usage/migration.sql`
- Create: `apps/core/app/lib/extensions/usage.server.ts`
- Modify: `completion.ts`, `models.ts`, `apps/core/app/lib/db.log-retention-policy.server.ts`
- Test: `apps/core/app/tests/unit/extension-usage.test.ts`, `apps/core/app/tests/integration/extension-completion.integration.test.ts`

**Models:**
```prisma
model ExtensionUsage {
  id               String   @id @default(cuid())
  extensionId      String
  keyId            String
  actorUserId      String?
  route            String   // route template, never the raw URL
  status           Int
  latencyMs        Int
  promptTokens     Int?
  completionTokens Int?
  createdAt        DateTime @default(now())
  @@index([extensionId, createdAt])
  @@map("extension_usage")
}

model ExtensionSessionCheckDaily {
  extensionId String
  day         DateTime @db.Date
  count       Int      @default(0)
  @@id([extensionId, day])
  @@map("extension_session_check_daily")
}
```

**Produces:**
```ts
export interface ExtensionUsageEntry {
  extensionId: string; keyId: string; actorUserId: string | null; route: string;
  status: number; latencyMs: number; promptTokens: number | null; completionTokens: number | null;
}
export function recordExtensionUsage(entry: ExtensionUsageEntry): Promise<void>;
export function countSessionCheck(extensionId: string): Promise<void>;
export function checkExtensionBudget(principal: ExtensionPrincipal): Promise<
  { ok: true } | { ok: false; limit: "requests" | "tokens"; retryAfterSeconds: number }
>;
// copies the pattern in apps/core/app/lib/api-keys/granted-slots.server.ts
export function acquireExtensionSlot(principal: ExtensionPrincipal): (() => void) | null;
```

**Behaviour:**
- An unapproved model → `403 EXTENSION_MODEL_NOT_ALLOWED`.
- Over budget → `429 EXTENSION_LIMIT`, with `Retry-After`.
- Over `maxInflight` → `503 EXTENSION_BUSY`, with `Retry-After`.
- The slot is released on every path, including stream end and client abort.
- Successful session checks only bump the daily counter; denials and errors get a row each.
- Cookies, keys and bodies are never stored.
- Personal-grant limits don't apply to extensions.

**Tests:**
- Budget arithmetic.
- The slot is released on abort.
- Usage rows contain no secrets.
- 403, 429 and 503 responses carry the right codes and `Retry-After`.

### Task 2.5: Isolated deployment profile

**Files:**
- Create: `infra/production/systemd/eduai-extension@.service`
- Modify: `infra/production/admin-helper.sh`. Add generic `install-extension-env <id>`, `install-extension-unit <id>` and `disable-extension <id>`, each checking `<id>` against a root-owned allow-list.
- Modify: `infra/production/preflight.sh`, `infra/production/SUDOERS_SETUP.md`
- Modify: `infra/s378/go-live-env.sh`, so the dev Core gets its own cookie prefix
- Test: `infra/production/tests/extension-helper.test.sh`

**Unit settings:**
- `User=eduai-ext-%i`, `Group=eduai-ext-%i`
- `NoNewPrivileges=yes`, `ProtectSystem=strict`, `PrivateTmp=yes`
- `IPAddressDeny=any`, `IPAddressAllow=localhost`

**Files and database:** the env file is `root:eduai-ext-<id> 0640`. The extension gets its own Postgres role, limited to its own database.

**Preflight fails if:**
- the extension user can read Core's or another extension's env file
- its env holds any `CORE_*` secret
- its DB role can connect to Core's database

**Tests:**
- The helper rejects ids outside the allow-list, and path tricks.
- The preflight checks pass and fail correctly against fixture files.

---

## Milestone 3: Registry (M, 4 PRs)

### Task 3.1: Registry file, validation, public projection

**Files:**
- Create: `config/extensions.json`, `scripts/extensions/registry.mjs`, `scripts/extensions/generate-public.mjs`
- Create: `packages/types/src/extensions.generated.ts` (generated, committed)
- Modify: `packages/types/src/index.ts`, root `package.json` (scripts `extensions:generate` and `extensions:check`), `.github/workflows/pr-tests.yml` (the lint job runs `extensions:check`)
- Test: `scripts/extensions/registry.test.mjs` (node:test)

**Entry fields**, validated with zod; unknown fields are rejected:
- `id` (kebab-case, unique), `name`, `description`, `icon`, `color`, `roles` (null = everyone)
- `web { path, urlEnv, devPort }`
- `server { path, devPort, callbackUrlEnv, healthPath, legacyServiceKey }` (optional)
- `db { name, backup }` (optional)
- `deploy { profile }`
- `owner`

The AI Tutor and QM entries keep today's env names (`VITE_AI_TUTOR_URL`, `VITE_QUESTION_MAKER_URL`, `AI_TUTOR_SERVER_URL`, `QM_BACKEND_URL`) and dev ports (3001/4000, 5173/8000, per `docs/EXTENSION_ONBOARDING.md` §9). Copy health paths and DB names from `infra/production/preflight.sh` and `infra/cron/lib.sh`.

**Produces:** in `extensions.generated.ts`, `export const EXTENSIONS = [...] as const`, containing only the public fields `id`, `name`, `description`, `icon`, `color`, `roles` and `urlEnv`.

**Tests:**
- The committed file equals a fresh generation.
- The projection has no `server`, `db`, `deploy` or `owner` key.
- Duplicate ids and unknown fields are rejected.

### Task 3.2: Launcher reads the registry

**Files:**
- Modify: `packages/ui/src/launcher-registry.tsx`
- Modify: `packages/ui/src/app-launcher.tsx`; roles now come from the registry, replacing `QUESTION_MAKER_ROLES`
- Modify: `apps/core/app/lib/apps.tsx`; `parseExtraExtensions` moves into `@eduai/ui` so all three apps honour `VITE_EXTRA_EXTENSIONS`
- Modify: `apps/extensions/ai-tutor/app/lib/apps.tsx`, `apps/extensions/question-maker/app/frontend/src/lib/apps.tsx`
- Modify: the icon maps in `apps/core/app/components/app-sidebar.tsx` (~`:57`) and `apps/core/app/components/command/command-palette.tsx` (~`:74`)
- Test: `packages/ui/src/tests/launcher-registry.test.tsx`; update `packages/ui/src/tests/app-launcher.test.tsx`

**Produces:**
```ts
export type LauncherAppId = "core" | (typeof EXTENSIONS)[number]["id"];
export function getLauncherApps(options: {
  currentAppId: LauncherAppId;
  readEnv: (name: string) => string | null;  // each app: (n) => import.meta.env[n]?.trim() || null
  coreCourseId?: string | null;
}): LauncherApp[];
```

**Behaviour:** unchanged for AI Tutor and QM:
- the same names, colours, roles and `coreCourseId` deep links
- an entry is hidden when its URL env is unset

Core's sidebar permissions (`NavItemKey` in `apps/core/app/lib/rbac/types.ts`) are not derived from app ids and stay as they are.

**Tests:**
- N registry entries → N apps.
- An unset URL hides its entry.
- `coreCourseId` is preserved.
- QM's role gate still applies.
- The existing nav and app-layout tests pass.

### Task 3.3: Bug-report identity

**Files:**
- Modify: `schema.prisma`, changing the `BugReportSource` enum (`CORE`, `AI_TUTOR`, `QUESTION_MAKER`) to `source String`
- Create: a migration that maps the stored values to `core`, `ai-tutor` and `question-maker`
- Modify: `apps/core/app/lib/bug-reports/server.ts` (~`:8`), `apps/core/app/routes/api/bug-reports.ts` (~`:73`), `apps/core/app/hooks/api/types.ts` (~`:38`), `apps/core/app/lib/agent-tools/admin-context.server.ts` (~`:298`), and every other `BugReportSource` reference (grep), including the admin filter
- Test: `apps/core/app/tests/integration/bug-report-source.integration.test.ts`

**Behaviour:**
- An extension caller's source is always its own `extensionId`. Claiming any other source → `403`.
- Legacy-key callers may still send `AI_TUTOR` or `QUESTION_MAKER`; these map to the new values. AI Tutor sends `source: "AI_TUTOR"` today (`apps/extensions/ai-tutor/server/src/services/bugReports.js:330`).

**Tests:**
- Historical rows can still be read and filtered.
- A spoofed source is rejected.
- Today's AI Tutor and QM payloads are still accepted.

### Task 3.4: Per-extension callbacks and lifecycle status

**Files:**
- Modify: `apps/core/app/lib/courses/cascadeDelete.server.ts`
- Create: `apps/core/app/routes/api/extensions.courses.status.ts`
- Modify: `apps/core/app/routes.ts`, and add the `lifecycle:read` row in `route-policy.server.ts`
- Test: extend `apps/core/app/tests/unit/cascadeDelete.server.test.ts`; create `apps/core/app/tests/integration/extension-course-status.integration.test.ts`

**Behaviour:**
- The callback targets are:
  - the legacy targets (`QM_BACKEND_URL`, `AI_TUTOR_SERVER_URL`, sent with `EDUAI_API_KEY`), unchanged
  - every registry entry whose `server.callbackUrlEnv` is set, each sent `Authorization: Bearer <getCallbackSecret(id)>`
- Delivery stays best-effort, and one failing target never blocks the others.
- A callback URL must use http(s) on `localhost` or a `*.eduai.ok.ubc.ca` host. Any other target is skipped and logged, and preflight (Task 5.3) fails on it.
- The status route takes `GET ?ids=a,b` (at most 200 ids) and returns `{ data: [{ id, deleted }] }` and nothing else. It is key-only, and unknown ids report `deleted: true`.

**Tests:**
- Each extension is sent its own secret.
- Legacy targets are unchanged.
- A failing target is isolated.
- The status route returns only `id` and `deleted`, caps the id count, and rejects keys without the permission.

---

## Milestone 4: SDK and starter (M, 4 PRs)

### Task 4.1: `packages/extension-sdk`

**Files:**
- Create: `packages/extension-sdk/{package.json, tsconfig.json, src/index.ts, src/core-client.ts, src/middleware.ts, src/lifecycle.ts, src/logger.ts, src/errors.ts}`
- Test: `packages/extension-sdk/src/tests/*.test.ts`
- Contract test: `apps/core/app/tests/integration/extension-sdk-contract.integration.test.ts`
- The turbo `build` task produces `dist`; generated output is not committed.

**Produces:**
```ts
export function createCoreClient(options: { coreUrl: string; extensionKey: string; timeoutMs?: number }): CoreClient;
export interface CoreClient {
  validateSession(cookie: string, signal?: AbortSignal): Promise<SessionResult>;
  asUser(cookie: string): CoreRequester; // key + cookie
  asService(): CoreRequester;            // key only: lifecycle:read, approved completion jobs
}
export interface CoreRequester {
  getJson<T>(path: string, init?: { signal?: AbortSignal }): Promise<T>;
  // Core's list envelope; page and pageSize are required by Core (1–200)
  getPage<T>(path: string, page: { page: number; pageSize: number }, init?: { signal?: AbortSignal }): Promise<{ data: T[]; total: number; page: number; pageSize: number }>;
  postJson<T>(path: string, body: JsonValue, init?: { signal?: AbortSignal }): Promise<T>;
  stream(path: string, body: JsonValue, signal: AbortSignal): Promise<ReadableStream<Uint8Array>>;
}
export interface CoreUser { id: string; email: string; name: string; image: string | null; role: UserRole; authorizedUnits: string[] }
export type SessionResult = { kind: "user"; user: CoreUser } | { kind: "anonymous" } | { kind: "unavailable" };
export class CoreError extends Error { status: 401 | 403 | 429 | 503; code: string; retryAfterSeconds: number | null }
export function requireAuth(client: CoreClient, options: { coreUrl: string; extensionUrl: string }): RequestHandler;
export function requireRole(...roles: UserRole[]): RequestHandler;
export function requireSameOriginMutation(allowedOrigins: readonly string[]): RequestHandler;
export function createCourseDeletedHandler(options: {
  client: CoreClient; callbackSecret: string; archiveCourse: (coreCourseId: string) => Promise<void>;
}): RequestHandler;
export function reconcileCourses(options: {
  client: CoreClient; listPointerIds: () => Promise<string[]>; archiveCourse: (coreCourseId: string) => Promise<void>;
}): Promise<{ checked: number; archived: number }>;
// pino; redacts cookie, authorization, x-extension-key, x-api-key
// (starting from apps/extensions/question-maker/app/backend/src/utils/logger.js:26)
export function createLogger(): Logger;
```
`JsonValue` and `UserRole` come from `@eduai/types`.

**Behaviour:**
- `requireAuth`:
  - anonymous page request → redirect to `${coreUrl}/login?redirect=…`
  - anonymous API request → `401` JSON
  - Core unavailable → `503`, never a login loop
- `createCourseDeletedHandler`:
  - a wrong secret → `401`
  - otherwise it re-checks `lifecycle:read` and archives only when `deleted === true`
  - a timeout or outage → `503`; nothing is archived, and the nightly reconcile retries later
  - duplicate calls are no-ops
- Works on Express 4 and 5.

**Tests:**
- Unit tests, with fetch mocked:
  - headers are forwarded
  - a timeout maps to `unavailable` or `503`
  - a `429` carries `retryAfterSeconds`
  - a restored course is not archived, and neither is one during an outage
  - the logger redacts all four headers
- Contract tests send SDK-built requests through Core's real handlers for session validation, courses, completion (model mocked) and the status route.

### Task 4.2: Starter server

**Files:**
- Create: `apps/extensions/starter/server/{package.json ("starter-server"), .oxlintrc.json, src/app.ts, src/routes/{me,courses,notes,ai,internal}.ts, src/jobs/reconcile.ts, prisma/schema.prisma, .env.example}`
- Test: `apps/extensions/starter/server/src/tests/*.test.ts`
- Modify: root `package.json`, adding the workspace globs `apps/extensions/*/web` and `apps/extensions/*/server`. npm already dedupes AI Tutor's `server` and skips folders without a `package.json`.
- Modify: `config/extensions.json`, adding a `starter` entry with `deploy.profile: "none"`. It is never deployed, and its URL env is unset outside local dev.
- Modify: `.github/workflows/pr-tests.yml`, wiring the starter the same way the AI Tutor server is wired today (DB env, `prisma generate`, turbo filter). Task 5.2 replaces this with registry discovery.
- The starter's `.oxlintrc.json` (web and server) adds `no-restricted-imports` for `apps/core` paths. This is the spec's "CI prohibits imports from `apps/core`".

**Schema:**
```prisma
model CoursePointer {
  id           String    @id @default(cuid())
  coreCourseId String    @unique
  archivedAt   DateTime?
  notes        Note[]
}
model Note {
  id              String        @id @default(cuid())
  coursePointerId String
  authorUserId    String
  body            String
  createdAt       DateTime      @default(now())
  coursePointer   CoursePointer @relation(fields: [coursePointerId], references: [id])
}
```

**Routes:**
- `GET /api/me`
- `GET /api/courses`, through `asUser`
- `GET` and `POST /api/courses/:coreCourseId/notes`; `DELETE` is instructor-only
- `POST /api/ai/complete`: streams; a client abort cancels upstream; Core's 403, 429 and 503 reach the client
- `POST /api/internal/courses/:coreCourseId/deleted`, using the SDK handler
- A nightly `reconcileCourses` run, followed by a purge of pointers archived longer than `ARCHIVE_RETENTION_DAYS`

An authorized live re-access reactivates an archived pointer, until the purge removes it.

**`.env.example`:** `CORE_URL`, `EXTENSION_URL`, `EXTENSION_KEY`, `CALLBACK_SECRET`, `DATABASE_URL`, with empty values.

**Tests** (supertest with a mocked `CoreClient`):
- Page versus API auth behaviour.
- A student gets `403` on instructor-only delete.
- Archive and reactivate.
- A client abort propagates upstream.

### Task 4.3: Starter web

**Files:**
- Create: `apps/extensions/starter/web/{package.json ("starter-web"), react-router.config.ts (ssr: false), vite.config.ts, app/root.tsx, app/nav.ts, app/lib/apps.tsx, app/routes/{courses,course,ai,components}.tsx}`
- Test: `apps/extensions/starter/web/app/tests/*.test.tsx`
- Modify: `scripts/e2e-in-docker.sh` and `docker-compose.e2e.yml`, adding the starter as a fixed entry; Task 5.2 replaces this with registry discovery

**UI:**
- `@eduai/ui` `AppShell`, the sidebar from `nav.ts`, the launcher (Task 3.2), theme sync and the bug-report trigger.
- States: loading, empty, error, archived-course notice, instructor-only control, AI streaming with cancel, access denied, inference unavailable.
- The components page lists `@eduai/ui`'s exports.
- With `VITE_USE_FIXTURES=true`, data comes from `app/fixtures/`, and every screen shows a visible "sample data" badge. This is for offline UI work, or work that waits on a promotion.

**Tests:**
- Testing Library covers each state.
- Playwright: Core login → starter course list → add a note → AI answer (completion mocked) → cancel.

### Task 4.4: Docs, first-day guide, retire `example-extension`

**Files:**
- Create: `apps/extensions/starter/README.md`, containing:
  - the porting table from spec B
  - a first-day guide: Node 24, npm 11.12.1, Docker, `EDUAI_LOCAL_SEED_PASSWORD`, localhost demo logins, how to get inference access, who to contact
- Modify: `docs/EXTENSION_ONBOARDING.md`, pointing at the starter and `docs/extensions/API.md`
- Then delete `apps/extensions/example-extension` and fix every reference to it (`grep -rn example-extension`):
  - `apps/core/Dockerfile` (~`:11`)
  - the AI Tutor and QM frontend Dockerfiles (~`:11`)
  - `.syncpackrc` (~`:33-34`)
  - `scripts/setup-env.js` (~`:13`)

**Done when:** the starter's e2e passes, then full CI is green after the deletion.

---

## Milestone 5: Scaffold, discovery, pilot (M–L)

### Task 5.1: Scaffold and local dev

**Files:**
- Create: `scripts/extensions/new-extension.mjs`
- Test: `scripts/extensions/new-extension.test.mjs` (node:test)
- Modify: root `package.json`, adding the scripts `new-extension` and `dev:ext`. Core keeps its `db:seed` script, and the root `dbseed` stays as it is.
- Modify: `turbo.json`, adding the tasks `db:generate`, `seed` and `e2e`
- Modify: `docker-compose.dev.yml` and `scripts/dev-db.js` (extension databases come from the registry's `db.name`)
- Modify: `scripts/kill-ports.js` and `scripts/setup-env.js` (ports and env names come from the registry)

**`npm run new-extension -- <id>`:**
1. Rejects ids that aren't kebab-case or are already taken.
2. Copies the starter.
3. Renames its packages to `<id>-web` and `<id>-server`.
4. Appends the registry entry.
5. Writes `.env.example`.
6. Runs `extensions:generate`.

**`npm run dev:ext -- <id>`:** starts Core plus that extension only.

**Tests:**
- A scaffold into a temp copy leaves a valid registry and unique names, and the generated projection includes the new id.
- Reusing an existing id fails.

### Task 5.2: CI and builds discover extensions

**Files:**
- Modify: `.github/workflows/pr-tests.yml`. Map changed paths to registry entries:
  - a change only inside one extension runs that extension's lint, typecheck and tests, plus the contract tests
  - a shared change runs today's full matrix
- Modify: `scripts/e2e-in-docker.sh` and `docker-compose.e2e.yml`, driven by the registry
- Modify: the Dockerfiles that copy every workspace's `package.json` (`apps/core/Dockerfile`, `docker/tests/Dockerfile.eduai` and the other `docker/tests` Dockerfiles). They copy a generated list instead, which `extensions:check` keeps current.

**Tests:**
- A change confined to one extension runs only that extension's jobs.
- The required checks still report.

### Task 5.3: Ops discovery

**Files:**
- Modify: `infra/cron/lib.sh` and `infra/cron/backup-nightly.sh`, so the DB list comes from the registry
- Modify: `infra/production/preflight.sh`, looping over the registry's deploy profiles to check port, health, env references and permissions
- Modify: `infra/production/admin-helper.sh`, so `RELEASE_UNITS` come from the registry and one extension can be disabled without a Core rollback
- Create: `infra/production/apache/extension.conf.template`
- Test: `infra/production/tests/registry-discovery.test.sh`. Also confirm `infra/cron/dry-run-local.sh` lists the registry's databases.

Shell scripts read the JSON through `node -e`, since production hosts already run Node, so there's no jq dependency.

**Done when:** a backup and restore drill is documented for one extension database.

### Task 5.4: Fourth-extension acceptance job

**Files:**
- Modify: `.github/workflows/pr-tests.yml`, adding a `fourth-extension` job

**The job:**
1. Scaffold `zz-acceptance` inside the CI workspace.
2. Run npm install, build, typecheck and test.
3. Check that the launcher lists it.
4. Check that a bug report from its key is accepted with its source.
5. Check that the course-deleted callback and the reconcile pass.
6. Check that the preflight dry run and backup discovery include it.

**Done when:** the job passes with no hand edits to shared files. That is spec A1's acceptance test.

### Task 5.5: Pilot port

**Needs:** the professor's option, a named pilot and its stack, and confirmation that maintainers control the deployment.

**Steps:**
1. Write the intake record at `docs/extensions/<id>/intake.md`.
2. Run promotion PRs in parallel with the port. Students may author them; maintainers review them and run migrations with temporary credentials.
3. Port the project onto a scaffolded starter.
4. Verify one real campus-model completion.
5. Pass the go-live checklist in spec D.
6. Maintainers deploy.

Build option 2 or 3 tooling, or a non-Node adapter, only if the decision calls for it.

---

## Not in this plan (file as separate issues)

- **Existing-app isolation.** The repo templates run Core, AI Tutor and QM as `service_eduai:eduai`; Core's env is `root:eduai 0640`; QM's env example carries `CORE_DATABASE_URL` and `CORE_ENCRYPTION_KEY`. Live hosts were not inspected.
- **Missing callback URL.** `infra/production/core.env.example` has no `QM_BACKEND_URL`. That is a template gap; the live config was not inspected.
- **Deferred:**
  - moving AI Tutor and QM onto the SDK or extension keys
  - a Core deletion outbox
  - a full mock Core
  - package publishing (option 2 only)
  - host-only sessions with federation, needed before any untrusted deployment

## Spec coverage

| Spec section | Tasks |
|---|---|
| A1 registry, consumers, acceptance | 3.1–3.4, 5.1–5.4 |
| A2 extension identity | 2.1–2.4 |
| A3 API contract | 1.1, 2.3, 3.4 |
| A4 SDK and lifecycle | 3.4, 4.1, 4.2 |
| A5 ownership and promotion | 1.2, 5.5 |
| B template, guide, non-Node contract | 1.1, 4.2–4.4 |
| C porting options | 1.2, 5.5 |
| D intake and deployment gates | 1.2, 2.5, 5.3, 5.5 |
| E delivery order | Milestones table |
