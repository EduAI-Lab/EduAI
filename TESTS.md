# TESTS.md

## Table of Contents

1. [Purpose](#purpose)
2. [Policy](#policy)
3. [Structure](#structure)
4. [How to Run Tests](#how-to-run-tests)
5. [Populating TESTS.md](#populating-testsmd)
6. [EduAI Full Platform End-to-End Tests](#eduai-full-platform-end-to-end-tests)
7. [EduAI Unit Tests](#eduai-unit-tests)
8. [EduAI Integration Tests](#eduai-integration-tests)
9. [AI Tutor Unit Tests](#ai-tutor-unit-tests)
10. [AI Tutor Integration Tests](#ai-tutor-integration-tests)
11. [AI Tutor Server Unit Tests](#ai-tutor-server-unit-tests)
12. [AI Tutor Server Integration Tests](#ai-tutor-server-integration-tests)
13. [Question Maker Unit Tests](#question-maker-unit-tests)
14. [Question Maker Integration Tests](#question-maker-integration-tests)
15. [Extending This Document](#extending-this-document)

---

## Purpose

This file is the canonical test inventory for the EduAI monorepo. It tracks every test suite across all apps and packages — what exists, what it covers, and what is still missing.

It serves two purposes:

1. **For the team** — a single place to understand the current test coverage picture without having to read every test file individually.
2. **For AI-assisted development** — before writing new tests, reference this file to avoid duplication and to understand coverage gaps. After writing new tests, update this file to keep the inventory current.

## Policy

- Tests are written **before** implementation (test-first approach).
- Every new feature or significant change must have corresponding tests recorded here.
- After any test-related work, update this file to reflect what the tests actually test.

### Coverage

Each app exposes a `test:coverage` script (Vitest V8 coverage), and the monorepo root aggregates them:

```bash
npm run test:coverage   # root — runs coverage for edu-ai, ai-tutor-server, and question-maker-backend via Turborepo
```

Per app, from the app directory:

| App | Command |
|-----|---------|
| EduAI (core) | `npm run test:coverage` |
| AI Tutor server | `npm run test:coverage` |
| Question Maker backend | `npm run test:coverage` |
| Question Maker frontend | `npm run test:coverage` |

Generated coverage report directories are gitignored.

The **Question Maker backend** `test:coverage` (`vitest.coverage.config.js`) measures the unit **and** integration suites together over `src/**` (excluding the `src/index.js` bootstrap and operational `scripts/`). The integration suite needs a PostgreSQL test database via `TEST_DATABASE_URL`; without it the integration tests self-skip and only unit coverage is reported. A `globalSetup` syncs the schema once up front so the shared-worker run is deterministic.

## Structure

Tests are organized into three locations across the monorepo:

- There may be some differences because of how some apps are structured, look at the path information to see where tests are stored

```
EduAI/
├── tests/
│   └── e2e/                          # End-to-end tests spanning EduAI and all extensions
├── apps/
│   └── core/
│       └── app/
│           └── tests/
│               ├── unit/             # Unit tests for EduAI
│               └── integration/      # Integration tests for EduAI
└── apps/
    └── extensions/
        └── <extension-name>/
            └── app/
                └── tests/
                    ├── unit/         # Unit tests for the extension
                    └── integration/  # Integration tests for the extension
```

---

## Populating TESTS.md

Each section below corresponds to a test directory. When you add, change, or remove tests in that directory, update the matching section here.

### What to add per test file

For each test file in a directory, add a row to that section's table. The table should capture:

- **Test file** — the file name (e.g. `auth.test.ts`), linked to its path in the repo
- **What it tests** — a plain-English description of the behaviour being tested

### Table format

Each section should use this format:

```markdown
| Test file | What it tests |
|-----------|---------------|
| `example.test.ts` | Description of what is being tested |
```

### Rules

- One row per test file, not per individual test case.
- The "What it tests" column should describe the **behaviour**, not the implementation — write it so someone unfamiliar with the code understands what would break if this test failed.
- If a test file is added as part of a feature branch, add the row here in the same PR.

### Example

| Test file | What it tests |
|-----------|---------------|
| `auth.test.ts` | JWT token validation and expiry handling |
| `chat-retrieval.test.ts` | RAG pipeline returns course-relevant context for a given query |

---

## EduAI Full Platform End-to-End Tests

**Path:** `tests/e2e/`

> _To be populated._

---

## Monorepo Automation Tests

**Path:** `eduai-summer-2026/tests/`

| Test file | What it tests |
|-----------|---------------|
| [`team-time-report.test.js`](eduai-summer-2026/tests/team-time-report.test.js) | Verifies weekly time-report parsing rules, base-time duplicate handling, issue/PR reference extraction, PR analytics metric extraction, and the rule that PR process time is reported separately from total tracked hours. |

---

## EduAI Unit Tests

**Path:** `apps/core/app/tests/unit/`

| Test file | What it tests |
|-----------|---------------|
| `course-access.server.test.ts` | The RBAC keystone helpers: `resolveCourseAccess` / `resolveCourseAccessWithCourse` resolution for every role (ADMIN bypass, UNIT_ADMIN unit lock incl. null-department courses, lazy `authorizedUnits` fetch, enrollment.role→access mapping — INSTRUCTOR enrollment returns `instructor`, TA enrollment returns `ta`, other returns `student` — active vs inactive enrollment, no relationship), 404-vs-403 course fetch split, `buildCourseListFilter` per-enrollment-role publish gating (grad-TA mixed case), and `stripAnswerForStudents` answer visibility per access level. |
| `units.test.ts` | `UnitSchema` accepts the canonical subject codes (and confirms each has a `UNIT_LABELS` entry) and rejects unknown codes, wrong casing, and empty values. |
| `enrollments.server.test.ts` | `addEnrollment`, `updateEnrollmentRole`, and `deactivateEnrollment`: the §6 permission matrix (INSTRUCTOR may add STUDENT/TA but never a fellow INSTRUCTOR), `ALREADY_ENROLLED` / `USER_NOT_FOUND` errors, and the transactional instructor-floor invariant — any demotion or deactivation leaving a course with zero active instructors is rejected with 409, with no ADMIN override. |
| `courses.enrollments.enrollmentId.test.ts` | `PATCH` and `DELETE /api/courses/:id/enrollments/:enrollmentId` routes: auth and role gates per caller, INSTRUCTOR-enrollment changes restricted to ADMIN/UNIT_ADMIN, instructor-floor 409 surfaced through the route, 404s, and soft removal via `isActive=false`. |
| `me.test.ts` | `GET` and `PATCH /api/me`: 401 anonymous, profile shape per role, and the `{name, image}` update whitelist — role/isActive unreachable and unknown keys stripped. |
| `users.rbac.test.ts` | `PATCH /api/users/:id` guards: self-role-change 403 (alongside the existing self-deactivation lockout), ADMIN-only `authorizedUnits` assignment validated with `UnitSchema`, `422 ROLE_MISMATCH` for non-UNIT_ADMIN targets, and same-request promotion to UNIT_ADMIN. |
| `chat.rbac.test.ts` | `POST /api/chat` §10 course gate: 404 missing course, 403 with no course relationship, students require an active enrollment AND a published course, proxyUser resolution uses the proxied user's access, and chats without a course context stay ungated. |
| `chats.delete.test.ts` | `DELETE /api/chats/:chatId`: owner-only 204, ADMIN may delete any chat, non-owner and missing chats both return 404 (no existence leak), 401 anonymous. |
| `ai-config.rbac.test.ts` | `GET /api/ai-providers` and `GET /api/ai-models` are ADMIN-only — 401 anonymous, 403 for every non-admin role, 200 for ADMIN — plus a regression check that `GET /api/ollama-models` stays ADMIN-only. |
| `admin-bug-reports.test.ts` | `GET /api/admin/bug-reports` (ADMIN-only list, `source`/`status` filter validation against the enums, limit/offset pagination, anonymity masking nulling `userId`/email/name on `isAnonymous` reports), `PATCH /api/admin/bug-reports/:id` status triage (422 invalid status, 404 missing report), and `GET /api/bug-reports?mine=true` returning own reports for any authenticated user. |
| `adhd-assist.test.ts` | Tests that `composeSystemPrompt` is identity when `adhdAssist` is false, prepends the verbatim policy block when true, preserves any existing course-context line in the base prompt, returns the block alone for an empty or whitespace-only base, and that `ADHD_ASSIST_POLICY_BLOCK` retains the verbatim §3 anchors (`=== ADHD ASSIST MODE ===`, `RESPONSE SHAPE:`, `Top summary`, `Next?`, `=== END ADHD ASSIST MODE ===`). Also tests that `resolveEffectiveAdhdAssist` uses the request-body value when the `adhdAssist` field is present (overriding the persisted chat in both directions) and falls back to the persisted `chat.adhdAssist` when the field is absent (for both `true` and `false` persisted values). |
| `adhd-metrics.test.ts` | Tests `computeAdhdResponseMetrics` literal `**Top summary**` / `**Next?**` anchor detection, failure when `Next?` is inline but not in the marked tail block, custom word-cap enforcement, and `withStructuralPass` / `isStructuralCompliancePass` aggregation. |
| `assistive-events.server.test.ts` | Tests `recordResponseComplianceEvent` persists derived metrics (including `structuralPass`, model, `finishReason`) without storing assistant message text; `sanitizeClientMetrics` keeps allowed scalar fields and drops unknown keys; `isAssistiveClientEventType` accepts known client event types and rejects server-only types. |
| `assistive-events.route.test.ts` | Route tests for `POST /api/assistive-events` (#521): 405 for non-POST, 401 when unauthenticated, 422 on invalid JSON / schema rejection / event types outside the client allowlist (e.g. server-only `response_compliance`), 404 when `chatId` is not owned by the caller, and 201 on a successful create — defaulting `adhdAssist` to the chat flag for chat-scoped events and to `false` for session-less events, with `metricsJson` sanitized. |
| `ai-schemas.test.ts`| AI provider and model schemas reject missing required fields, invalid URLs, negative pricing, and unknown enum values, and apply the correct defaults when optional fields are omitted |
| `auth-schemas.test.ts`| Tests that auth schemas validate credentials, enforce password matching, and restrict role values across sign-in, sign-up, reset, and user management flows. |
| `auth-handler-request.test.ts` | Tests that internal Better Auth sub-requests omit session cookies on sign-in (clean re-login after logout) and forward cookies on sign-out. |
| `bug-reports.test.ts` | `createBugReport` service: rejects null/missing payloads, invalid or CORE source values, empty userId, non-string/missing description, descriptions over 2000 chars; accepts exactly 2000 chars; returns USER_NOT_FOUND when the user doesn't exist; trims userId before DB lookup; passes AI_TUTOR and QUESTION_MAKER source through to the create call; persists userId even when isAnonymous is true; defaults isAnonymous to false; passes all optional fields through unchanged; stores null for absent optional fields. |
| `chat-api-keys.schema.test.ts` | Validates `clientApiKeysBodySchema` and `toUserProviderSettings` coercion defaults for chat `apiKeys` body parsing. |
| `chat-rag.test.ts` | Tests `buildCappedRagContextText` and `capRagHitsForTool` chunk/char caps for hybrid and tool RAG paths. |
| `canvas-client.test.ts` | `parseAndValidateCanvasUrl` SSRF guard (HTTPS required except local dev hosts) and `verifyCanvasCredentials` success, invalid token, Canvas error statuses, and unreachable Canvas. |
| `canvas-encryption.test.ts` | AES-256-GCM encrypt/decrypt round-trip, empty input, legacy plaintext passthrough, strict encrypted-format detection, and missing `ENCRYPTION_KEY`. |
| `canvas-schemas.test.ts` | `ConnectCanvasSchema` validates canvasUrl normalization, requires apiKey outside test mode, allows test mode without apiKey, and rejects invalid URLs. |
| `courses.enrollments.test.ts` | `GET /api/courses/:id/enrollments` loader: 400 missing id, 401 no session, 403 invalid service key, 403 user not enrolled, 404 course not found (both auth paths), 200 via service key and user OAuth (STUDENT/INSTRUCTOR), role mapping, null `enrolledAt`, active + inactive returned together, and empty enrollment list. |
| `courses.materials.test.ts` | `GET /api/courses/:courseId/materials` loader and `POST /api/courses/:courseId/materials` action: auth, status codes, and material list/upload behaviour. |
| `courses-schemas.test.ts`| Tests that course schemas require non-empty fields, reject fractional years, and enforce that topic deletion specifies at least one identifier. |
| `courses.server.test.ts` | `getCourses`, `createCourse`, `updateCourse`, `getCourse`, `getCourseTopics`, `getCourseTopic`, and `deleteCourseTopic` — verifies ADMIN scoping, instructor-enrollment creation in a transaction, `deletedAt: null` queries, and soft-delete updates. |
| `courses.id.test.ts` | `courses.id` loader: 400/401/403, service-key and session auth, 404 `COURSE_NOT_FOUND`, 200 flat course. |
| `courses.topics.test.ts` | Topics `loader` and `action` unit tests: GET list/by-id and POST/DELETE auth, status codes, and error bodies (mocked server + auth). |
| `embedding.test.ts` | Tests that chunk generation returns no chunks for empty input, keeps short content as one chunk, never produces chunks that exceed the size limit, applies word overlap between adjacent chunks, handles punctuation-free slide-deck input without throwing, and tests `getExpectedEmbeddingDimension` and `wantsLocalEmbeddingProvider` for 1024-dim local embed env defaults. |
| `embedding-config.test.ts` | Tests per-course embedding settings resolution (`resolveEffectiveEmbeddingSettings`), stale-index detection, settings update validation, and env provider aliases for local/cloud overrides. |
| `process-material-embeddings.test.ts` | Tests that re-embed replace mode clears old chunks only after embeddings succeed (failed embed leaves existing vectors intact). |
| `providers.test.ts` | OpenRouter chat provider: `parseModelIdentifier` for slash model ids, `validateProviderConfig` / `isProviderConfigured`, and `createAIProviderRegistry` OpenRouter client wiring via OpenAI-compatible base URL. |
| `re-embed-job.test.ts` | Tests async re-index job terminal status resolution (`resolveReEmbedJobStatus`) and client polling/message helpers for background re-embed jobs. |
| `courses.server.test.ts` | `getCourses` (role-scoped via `buildCourseListFilter`), `createCourse` (incl. UNIT_ADMIN department lock), `updateCourse` (rank gating, UNIT_ADMIN can't move a course outside their units), new `deleteCourse` soft-delete, `getCourse`, `getCourseTopics`, `getCourseTopic`, and `deleteCourseTopic` — instructor-enrollment creation in a transaction, `deletedAt: null` queries, and soft-delete updates. |
| `courses.id.test.ts` | `courses.id` loader and action: 400/401, `resolveCourseAccess` gating (403 unrelated user, student publish gate), service-key and session auth, 404 `COURSE_NOT_FOUND`, 200 flat course, rank-gated PATCH, and new soft-DELETE → 204. |
| `courses.topics.test.ts` | Topics `loader` and `action` unit tests: §8 role matrix per verb (student/TA/instructor), the student publish gate, POST/DELETE opened to rank ≥ 2, new PATCH rename route (200/404/409), TA own-only edit/delete via `createdBy` with ownerless rows denied to TAs, and unchanged service-key paths. |
| `embedding.test.ts` | Tests that chunk generation returns no chunks for empty input, keeps short content as one chunk, never produces chunks that exceed the size limit, applies word overlap between adjacent chunks, and handles punctuation-free input without throwing. |
| `file-processing.test.ts` | Tests that text sanitization removes invalid characters and normalises whitespace, checksums are stable and unique, file validation enforces allowed types and the 50 MB limit, semantic chunking splits content at logical boundaries without producing empty or oversized chunks, and file extraction strips the extension and computes the checksum from sanitized content. |
| `form-utils.test.ts` | Form validation errors are reported per field, combined into one message when multiple fields fail, and fields signal valid/invalid correctly |
| `forward-session-cookies.test.ts` | Tests that all `Set-Cookie` headers from a Better Auth response are forwarded (multiple cookies, single-header fallback, empty response). |
| `guards.server.test.ts` | `requireServiceKey`: 401 on missing header, 401 on non-Bearer scheme, 403 on wrong token, 403 on unconfigured env var, null on correct token, 403 on prefix/suffix length-variant tokens. `validateRedirectUrl`: returns /dashboard for null/empty/non-path inputs, passes through valid relative paths, allows localhost and production subdomains, and rejects external domains, protocol-relative URLs, and javascript: URIs. |
| `LoginForm.test.tsx`| The login form renders all inputs and buttons correctly, shows field-level error messages with error styling, and disables all inputs and updates the button label while signing in |
| `questions.server.test.ts` | `createQuestion` (validation + idempotency-key dedupe), `listQuestions` (filtering), `getQuestionById`, and `updateQuestionTestable` server helpers. |
| `rate-limit.server.test.ts` | `isRateLimited`: returns false under the limit, true once exceeded, tracks IPs independently, expires hits outside the time window, and reads the default limit from `SESSION_VALIDATE_RATE_LIMIT`. |
| `RegisterForm.test.tsx`| The register form renders all four fields and buttons correctly, shows field-level error messages with error styling on each input, and disables all inputs and updates the button label while creating an account |
| `use-api-keys.test.ts` | Tests that the useApiKeys hook hydrates from localStorage, persists and removes provider settings, and correctly identifies which providers are fully configured. |
| `use-mobile.test.ts` | Tests that useIsMobile returns the correct breakpoint state on mount, updates when the viewport changes, and removes its listener on unmount. |
| `utils.test.ts` | Tests that the cn() utility merges conflicting Tailwind classes, drops falsy values, and handles conditional objects and nested arrays. |
| `bug-reports.test.ts` | `createBugReport` service: rejects null/missing payloads, invalid or CORE source values, empty userId, non-string/missing description, descriptions over 2000 chars; accepts exactly 2000 chars; returns USER_NOT_FOUND when the user doesn't exist; trims userId before DB lookup; passes AI_TUTOR and QUESTION_MAKER source through to the create call; persists userId even when isAnonymous is true; defaults isAnonymous to false; passes all optional fields through unchanged; stores null for absent optional fields. |
| `courses.enrollments.test.ts` | `GET /api/courses/:id/enrollments` loader (§6: TA-and-up see all, enrolled STUDENT → 403, 404 course not found on both auth paths, 200 via service key and user OAuth, role mapping, active + inactive returned together) and new `POST /api/courses/:id/enrollments` action (ADMIN/UNIT_ADMIN any role, INSTRUCTOR may add STUDENT/TA but not INSTRUCTOR, `409 ALREADY_ENROLLED`, `422 USER_NOT_FOUND`). |
| `courses.materials.test.ts` | `GET` (student publish gate, 404/403 split via `resolveCourseAccess`), `POST` (STUDENT uploads blocked — TA-and-up only), and new `DELETE /api/courses/:id/materials/:materialId` (ADMIN/UNIT_ADMIN/INSTRUCTOR plus TA own-only via `uploadedBy`, ownerless rows denied to TAs, 204 hard delete): the full §7 role × op matrix. |
| [`user-preferences.test.ts`](apps/core/app/tests/unit/user-preferences.test.ts) | Tests that `parsePreferenceUpdates` keeps a boolean `assistDefault`, ignores non-boolean and unknown fields, trims a course code and normalizes a blank one to null, treats an explicit null as a clear, and returns an empty object for non-object payloads; and that `resolveSelectedCourse` keeps the current course only while it remains in the available list, otherwise returning null (no selection, empty list, or a course the user can no longer access). |
| [`user-preferences.server.test.ts`](apps/core/app/tests/unit/user-preferences.server.test.ts) | Tests the chat-preferences persistence service against a mocked Prisma client: `getUserPreference` returns defaults when no row exists, restores the stored toggle + course when still available, clears and persists `null` when the stored course is stale, `saveUserPreference` upserts scoped to the user id and returns the stored values, and `clearUserPreference` deletes the user's row on logout. |
| [`preferences.test.ts`](apps/core/app/tests/unit/preferences.test.ts) | Tests `GET`/`PATCH /api/preferences`: 401 when unauthenticated, GET defaults when no row exists, PATCH persists `assistDefault` and returns saved values, 405 for unsupported methods, 400 for invalid or empty payloads, and malformed JSON bodies. |
| [`AssistiveUiProvider.test.tsx`](apps/core/app/tests/unit/AssistiveUiProvider.test.tsx) | Tests the shell-wide assistive context: `data-assistive` is absent on `<html>` when OFF (baseline untouched), present when ON, toggling ON/OFF updates the DOM and PATCHes `/api/preferences`, and `useAssistiveUi` throws outside the provider. |
| [`assistive-reading.test.ts`](apps/core/app/tests/unit/assistive-reading.test.ts) | Verifies `READING_SURFACE_CLASS` matches assistive-reading.css hooks and that typography rules are scoped under `[data-assistive]` with spacing-based defaults (16px base, 1.625 line-height, 65ch measure, no font-family swap). |
| [`ChatViews.test.tsx`](apps/core/app/tests/unit/ChatViews.test.tsx) | Verifies `ChatGlobalView` and `ChatCourseScopedView` render their role-specific banner text, and that clicking the Assistive Mode switch calls `onAssistChange` with the toggled boolean. |
| [`NavMain.test.tsx`](apps/core/app/tests/unit/NavMain.test.tsx) | Verifies nav items render as SPA `<Link>` elements, the active item receives `aria-current="page"` based on the current pathname, child routes (e.g. `/courses/abc`) also activate the parent nav item, and an empty items list renders without throwing. |
| [`SiteHeader.test.tsx`](apps/core/app/tests/unit/SiteHeader.test.tsx) | Verifies the header renders an explicit `title` prop, derives the page title from the current route when no prop is passed, renders optional action slots, and replaces the `<h1>` with the `breadcrumbs` node when that prop is provided. |

---

## EduAI Integration Tests

**Path:** `apps/core/app/tests/integration/`

| Test file | What it tests |
|-----------|---------------|
| `courses.materials.integration.test.ts` | Materials RBAC on the test DB: an INSTRUCTOR upload → list → DELETE cycle, TA deleting their own upload vs another's (403), and the student upload block. |
| `me.integration.test.ts` | `GET`/`PATCH /api/me` round-trip against the test DB for each role (STUDENT/INSTRUCTOR/UNIT_ADMIN/ADMIN): profile shape and a name update persisting while role/isActive stay untouched. |
| `preferences.integration.test.ts` | Assistive preference round-trip against the test DB: defaults OFF, PATCH ON persists and root loader reports assistive, PATCH OFF returns baseline, per-account isolation, guest baseline + 401 on PATCH, and `assistDefault` updates do not clobber `lastCourseCode`. |
| `courses.integration.test.ts` | `GET /api/courses` and `POST /api/courses` against the test DB: 401 when unauthenticated, per-role list scoping (ADMIN all; UNIT_ADMIN authorized units; INSTRUCTOR/TA enrolled regardless of publish state; STUDENT enrolled + published; the grad-TA mixed-enrollment case), and course creation incl. UNIT_ADMIN inside vs outside their `authorizedUnits`. |
| `courses.id.integration.test.ts` | `GET /api/courses/:id` on the test DB: 401 without auth, 200 via session or service key, `resolveCourseAccess` gating (403 unrelated user, student publish gate), `COURSE_NOT_FOUND` for missing courses, and the soft-delete disappearance cycle (DELETE → 404 on re-fetch). |
| `courses-topic.integration.test.ts` | Topics on the test DB (session + service key): the INSTRUCTOR create → PATCH rename → soft-delete lifecycle, the student publish-gate round-trip, `TOPIC_ALREADY_EXISTS`, soft-delete filtering, and soft-delete on DELETE. |
| `service-key.integration.test.ts` | Verifies that `requireServiceKey` correctly rejects (403) wrong-key Bearer requests and never calls downstream DB logic, accepts (200) correct-key requests and calls `getCourseTopics`, and that requests with no Authorization header fall through to session auth (401 Unauthorized) — all tested through the real `GET /api/courses/:id/topics` loader with DB and session layers mocked. |
| `sessions-validate.integration.test.ts` | `POST /api/sessions/validate` contract: valid session cookie → 200 with correct user shape; missing or expired session → 401; rate-limited IP → 429; non-POST method → 405; `x-forwarded-for` IP extraction; `role` field defaults to `STUDENT` when absent from the session. |
| `bug-reports.integration.test.ts` | `POST /api/bug-reports` against the test DB (401/403 service-key failures, 422 validation and USER_NOT_FOUND, 201 with correct source tag, anonymous reports persisting userId with isAnonymous=true, optional-field round-trip) plus the admin lifecycle: a submitted report surfaces in `GET /api/admin/bug-reports` with the right `source`, a PATCH status transition persists, and the anonymity-masking round-trip (identity nulled in the response, intact in the DB). |
| `courses.enrollments.integration.test.ts` | Enrollments against the test DB: the §6 GET gates (401, 403 invalid key, enrolled STUDENT → 403, 404 nonexistent course, 200 via service key and TA-and-up OAuth, role mapping, active + inactive together) and the management lifecycle — create course with instructor → add a second instructor → remove the first → removing the last active instructor hits the 409 instructor floor. |
| `questions.integration.test.ts` | `GET /api/questions` (list/filter), `POST /api/questions` (validated create with idempotency-key dedupe), `GET /api/questions/:id`, and `PATCH /api/questions/:id` (testable toggle) against the test DB — now per §9: course-scoped access for enrolled vs non-enrolled users per role, STUDENT → 403, TA own-vs-other edits, and answer fields preserved for TA-and-up. |

---

## AI Tutor Unit Tests

**Path:** `apps/extensions/ai-tutor/app/tests/unit/`

| Test file | What it tests |
|-----------|---------------|
| `api.test.ts` | Unauthorized requests redirect to the login page, server errors surface as exceptions, and successful requests return parsed data |
| `BugReportDialog.test.tsx` | The bug report form rejects descriptions that are too short, takes a screenshot on open, and submits diagnostic data including the reporter's anonymous preference |
| `BugReportProvider.test.tsx` | Page location and diagnostic capture tools are available to any component that needs to file a bug report |
| `BugReportsTab.test.tsx` | Admins can view, update status, and copy bug reports; anonymous submissions hide reporter identity in the copied output |
| `Nav.test.tsx` | The Report Bug button is visible to students and professors but hidden from admins |
| `useLocalUser.test.tsx` | Users can log in, log out, and have their session available across the app; accessing the session outside its provider throws an error |

> **Coverage gap:** `home.tsx` role-based routing (STUDENT→/student, INSTRUCTOR→/instructor, TA/UNIT_ADMIN→/unsupported-role, ADMIN→/admin) and `unsupported-role.tsx` role guard (UNIT_ADMIN and TA stay on page; other roles are redirected to their correct route) are not currently covered by unit tests.

---

## AI Tutor Integration Tests

**Path:** `apps/extensions/ai-tutor/app/tests/integration/`

> _To be populated._

---

## AI Tutor Server Unit Tests

**Path:** `apps/extensions/ai-tutor/server/tests/unit/`

| Test file | What it tests |
|-----------|---------------|
| `activityAnalytics.test.js` | An activity's difficulty is calculated correctly from how often students ask for help, answer incorrectly, and rate it poorly, and the result is labeled LOW, MEDIUM, or HIGH based on defined thresholds |
| `activityEvaluation.test.js` | Student answers are marked correct or incorrect for multiple-choice and short-answer questions, and missing questions or answers return a null result rather than crashing |
| `aiGuidance.test.js` | Tutor prompts include the right question, options, and student answer for each question type; topic and knowledge-level placeholders are replaced correctly; and supervisor verdicts normalize missing or malformed fields to safe defaults |
| `aiModelPolicy.test.js` | Only models that are actually available can be selected, defaults fall back gracefully when the preferred model is missing, and the number of supervisor loop iterations is kept within a safe range |
| `auth.middleware.test.js` | `requireAuth` populates `req.user` from Core's session validation response, returns 401 on invalid or missing sessions and when Core is unreachable, forwards the cookie header exactly, normalizes unknown roles to `STUDENT`, and preserves all five valid roles; `requireRole` calls next for permitted roles, returns 403 for the wrong role, returns 401 when no user is set, and includes the required roles in the error; `requireRoles` is the same function reference as `requireRole` |
| `mappers.test.js` | Sensitive fields like passwords are stripped before data leaves the server, IDs resolve correctly whether stored flat or nested, and missing optional fields default to safe values |
| `eduai.schemas.test.js` | `EduAiEnrollmentSchema` and related EduAI response schemas validate and parse Core payloads and reject malformed shapes |
| `eduaiClient.testableQuestions.test.js` | `listCourseTestableQuestions` fetches a course's testable questions from Core with the service key and maps/handles the response and error cases |
| `enrollmentSync.test.js` | `syncCourseEnrollments` — early-return guards, the `options.course` shortcut, and the create path for syncing Core enrollments into AI Tutor |

---

## AI Tutor Server Integration Tests

**Path:** `apps/extensions/ai-tutor/server/tests/integration/`

| Test file | What it tests |
|-----------|---------------|
| `activities.test.js` | Students see completion status on activities while professors do not, answers are graded correctly, feedback requires a prior submission, and non-members and unenrolled users are blocked |
| `admin.test.js` | Admins can list courses and view API key status; role-update returns 410 (managed by EduAI); all admin endpoints reject non-admin users with 403 |
| `auth.test.js` | The current user is returned without their password field; admins are blocked from non-admin endpoints while retaining access to `/api/me` |
| `bugReports.test.js` | Students and professors can submit bug reports (201, `postCoreBugReport` called with correct userId); admins are rejected with 403; unauthenticated requests return 401; descriptions that are too short or too long return 400; anonymous reports still pass the real userId to Core; Core errors surface as 500 |
| `courseCloning.test.js` | Cloning a course copies all modules, lessons, and activities in order, maps topics by name to the target course creating them when missing, and reuses existing topics on name collision |
| `courses.test.js` | Professors and students see the correct courses for their role, courses can be created and edited, and unpublishing a course cascades to its modules and lessons |
| `lessons.test.js` | Professors see all lessons including drafts while students only see published ones, lessons can be created and published, and publishing is blocked when the parent module is unpublished |
| `modules.test.js` | Professors see all modules including drafts while students only see published ones, modules can be created and published, and unpublishing cascades to lessons |
| `progressCalculation.test.js` | A student's progress at course, module, and lesson level counts only correct answers against published content, and the latest attempt takes precedence over earlier ones |
| `smoke.test.js` | The server is reachable and the health endpoint returns a healthy response |
| `topics.test.js` | Topics can be listed and created for authorized members, duplicate names and empty values are rejected, students cannot create topics, and activities can be remapped from one topic to another |

---

## Question Maker Unit Tests

**Path:** `apps/extensions/question-maker/app/backend/tests/unit`

| Test file | What it tests |
|-----------|---------------|
| `aiExtract.test.js` | The AI extraction service returns an empty result immediately when the input text is blank or whitespace, without calling any external service |
| `aiExtractEduaiMocked.test.js` | Questions are extracted and structured correctly from text when the AI service and database are replaced with fakes |
| `aiServiceGenerate.test.js` | `generateQuestions` provider routing (Groq/OpenAI/DeepSeek) with parse fallbacks and HTTP errors; `extractQuestionsFromText` EduAI extraction — sanitization, MCQ choices, retry-on-empty, topic prompting, missing-course code, not-configured guard (collaborators mocked) |
| `assessmentVariantMetadataScoring.test.js` | Questions are scored for how well their metadata matches a slot's requirements, with each matching attribute contributing the correct weight |
| `assessmentVariantUtils.test.js` | `aggregateStructure` and related variant utilities compute assessment structure correctly |
| `auth.middleware.test.js` | `requireAuth` populates `req.user` from Core's session validation, calls `findOrCreateUser` to maintain the local FK row, returns 401 JSON on invalid or missing sessions and when Core is unreachable, forwards the cookie header, normalizes unknown roles to `STUDENT`; `requireRole` passes permitted roles, returns 403 for wrong roles, returns 401 when no user is set; `authenticateToken` is the same function reference as `requireAuth` |
| `authService.test.js` | `findOrCreateUser` returns an existing user without seeding, creates a new user row and seeds courses on first login, stores null when name is absent, and passes the correct `findOrCreate` call shape to Sequelize |
| `canvasExport.test.js` | MCQ answer choices are parsed correctly from text, and question payloads are built in the format Canvas expects |
| `canvasExportMocked.test.js` | Assessments are exported to Canvas correctly when the Canvas API, database, and integration lookup are replaced with fakes |
| `canvasServiceConvert.test.js` | Pure canvas converters: `convertCanvasQuestionToVariant` (MCQ/true-false/essay/short-answer/text-fallback/unsupported), `convertVariantToCanvasQuestion`, `stripHtmlTags`, `parseChoicesFromQuestionText`, `normalizeCanvasQuestionType`, `parseMCQOptions` |
| `coreApiService.test.js` | `getCourseTopicsFromCore`, `pushTopicToCore`, `pushQuestionToCore`, and `patchQuestionTestableOnCore` — request shape, service-key auth, and response/error handling against a mocked Core |
| `coreWiringService.test.js` | `pushVariantToCore` maps variant payloads to Core, lowercases enum values, handles CUID topic ids, and surfaces `INVALID_TOPIC_IDS` |
| `eduaiService.test.js` | `EduAIService` (axios mocked): `chat` success/timeout/unreachable/reset/HTTP-error paths, `generateQuestions` parsing/normalization (MCQ choices, answer-letter, topic dedupe, error envelopes, retries), `listCourses`/`getCourseTopics`/`listAIModels` success and error handling, `testApiKey` outcomes |
| `encryption.test.js` | Encrypted values round-trip back to the original string, and edge cases like empty input are handled without errors |
| `extraction.test.js` | Question text is split into individual blocks at numbered boundaries and chunked so multipart questions are never split across chunks |
| `errorHandler.test.js` | `notFound` and `errorHandler` Express middleware return the correct status codes and JSON error envelopes |
| `generateBankVariants.test.js` | `generateBankVariantsForQuestions` — validation guards, per-question orchestration, and MCQ choice-count retry |
| `courseAccess.test.js` | `resolveCourseAccess` derives the caller's access level (ADMIN/UNIT_ADMIN/INSTRUCTOR/TA/STUDENT) from course ownership, Core enrollments, and unit-department matching, and the `requireCourseAccess` middleware enforces a minimum rank — 401 unauthenticated, 404 missing course, 403 below the required rank. |
| `resourceAccessIdGuard.test.js` | The resource-access loaders (`requireVariantAccess`/`requireQuestionAccess`/`requireAssessmentAccess`) reject a non-integer id with 404 before any DB query, so a `NaN` never reaches the INTEGER PK and leaks a 500. |

---

## Question Maker Integration Tests

**Path:** `apps/extensions/question-maker/app/backend/tests/integration/`

| Test file | What it tests |
|-----------|---------------|
| `assessmentsAuth.test.js` | All assessment routes reject unauthenticated requests |
| `assessmentServiceGaps.integration.test.js` | `deleteAssessment` and `getQuestionsInAssessment` service paths against the test DB |
| `assessmentSectionService.integration.test.js` | Section CRUD (`createAssessmentSection`/`getSectionsForAssessment`/`updateAssessmentSection`/`deleteAssessmentSection`), variant linking (`addVariantToSection`/`removeVariantFromSection`/`updateVariantOrderInSection`), and `checkQuestionInAssessments`/`removeQuestionFromAllSections`, including ownership and not-found paths |
| `assessmentVariantService.integration.test.js` | `setAssessmentStudyRole`, `getBlueprintSnapshot`, `getBaselineVariantReadiness`, and `assembleEquivalentExamVariants` against the test DB |
| `assessmentVariantAuth.test.js` | All assessment variant routes reject unauthenticated requests |
| `assessmentVariantHttp.integration.test.js` | Assessment variant routes reject requests with missing or invalid required fields |
| `bugReports.integration.test.js` | Unauthenticated requests return 401; authenticated requests proxy to Core and return 201; QUESTION_MAKER source and userId are forwarded correctly; 422 validation errors from Core pass through; 502 is returned when Core is unreachable |
| `canvasAuth.test.js` | All Canvas integration routes reject unauthenticated requests |
| `canvasImportExport.integration.test.js` | `canvasService` stateful flows in Canvas test mode against the test DB: `saveCanvasIntegration`/`getCanvasIntegration`, the test-mode read endpoints, `importQuizFromCanvas` (assessment/section/variant creation, validation guards), `exportAssessmentToCanvas` round-trip, and `getCanvasCourseMapping` |
| `coreWiring.integration.test.js` | `PATCH /api/course/:id/link-core`, `POST /api/course/:id/sync-topics`, and `PATCH /api/questions/variants/:variantId/testable` routes with Core mocked |
| `coreWiringDb.integration.test.js` | Core wiring routes against the test DB — link-core, sync-topics, topic push, and variant testable toggle persist correctly |
| `eduaiAuth.test.js` | All EduAI proxy routes reject unauthenticated requests |
| `eduaiHttpValidation.integration.test.js` | EduAI chat and question-generation routes reject requests with missing required fields |
| `health.test.js` | The health and root endpoints respond correctly when the server is running |
| `planCoverage.integration.test.js` | Users cannot access another user's courses, saved questions persist correctly, and variant assembly rotates picks fairly across runs without repeating the baseline |
| `questionAssessments.integration.test.js` | Questions and assessments can be created and retrieved, invalid inputs are rejected, and variants can be added to questions |
| `questionsAuth.test.js` | All question and extraction routes reject unauthenticated requests |
| `questionsExtractValidation.integration.test.js` | The question extraction and save endpoints reject requests with missing or invalid text, courseId, or question list |
| `saveExtractedQuestions.integration.test.js` | `POST /extract/save` — topic fallback resolution, MCQ questions, and saving with an assessment payload |
| `syncTopicsCounter.integration.test.js` | `POST /api/course/:id/sync-topics` returns the correct synced counter, including name-updated topics |
| `variantApproval.integration.test.js` | `PUT /api/questions/variants/:id` pushes the approved variant to Core on approval |
| `assessmentRbac.test.js` | Assessment route RBAC: STUDENT is 403 on every operation, TA may GET (200) but is blocked on all writes (POST/PUT/DELETE/PATCH → 403), INSTRUCTOR has full create/update/delete authoring plus variant assembly, and section/variant write routes forward the authorized course id (`req.qmCourse.id`) to the service. |
| `authMeBugReport.test.js` | `GET /api/auth/me` returns `isBugReportAdmin=true` only for ADMIN, with the legacy `BUG_REPORT_ADMIN_EMAILS` allowlist ignored so UNIT_ADMIN/INSTRUCTOR/TA/STUDENT all resolve to false. |
| `canvasRbac.test.js` | Canvas RBAC: integration save/get/delete are INSTRUCTOR-only own-scoped (TA/STUDENT → 403), and course-mapping reads and assessment export are course-scoped INSTRUCTOR-only (TA → 403). |
| `questionRbac.test.js` | Question route RBAC: STUDENT blocked from all writes (403), TA may view the whole course bank but edit/delete only their own questions (`createdBy`, else 403), and INSTRUCTOR may create/edit/delete any question in the course. |
| `variantRbac.test.js` | Variant route RBAC: STUDENT blocked from edits/deletes/creates (403), TA own-only draft edit/delete (`createdBy`, else 403), INSTRUCTOR-only approval and draft-revert (TA → 403/409), approved variants locked against edits (409 `VARIANT_LOCKED`), and `PATCH` testable INSTRUCTOR-gated ahead of payload validation. |
| `crossCourseScoping.integration.test.js` | Section/variant/question write services reject a child resource from a different course owned by the same user (cross-course linking, section/variant hijack, and `addQuestionToAssessment`/`removeQuestionFromAssessment`), while same-course writes still succeed. |
| `questionOrderRbac.test.js` | Question-order routes (`PUT /:id/order`, `DELETE /:id/order/:assessmentId`) are instructor-only (TA → 403, §17) and reject an `assessmentId` from a different course than the question (→ 404). |
| `approveTopicValidation.test.js` | `POST /api/questions/approve` rejects a question with no/invalid `primaryTopicId` with 400 before reaching the service, and forwards a real CUID topic id unchanged. |
| `canvasImportSkip.integration.test.js` | `importQuizFromCanvas` skips a question whose persistence fails (recording it in `skippedQuestions`) instead of aborting the whole import with a `ReferenceError` from the catch block. |
| `variantReadinessScope.test.js` | `GET /api/assessment-variant/assessments/:id/variant-readiness` derives `courseId` from the authorized assessment's course, ignoring a mismatched `?courseId=` and no longer requiring the query param. |

---

## Question Maker Frontend Unit Tests

**Path:** `apps/extensions/question-maker/app/frontend/src/tests/unit/`

| Test file | What it tests |
|-----------|---------------|
| `LoginPage.test.tsx` | The login page submits credentials, shows errors, switches to registration, renders loading state, and redirects authenticated users |

---

## Question Maker Frontend Integration Tests

**Path:** `apps/extensions/question-maker/app/frontend/src/tests/integration/`

| Test file | What it tests |
|-----------|---------------|
| `api.test.ts` | The axios client sends Authorization headers, clears auth on `401`, and redirects to `/login` without looping |

---

## Extending This Document

If a new extension is added to the platform or a new category of tests is introduced, update this file to match:

1. **Update the Structure section** — add the new directory to the folder tree and the summary table so the layout stays accurate.
2. **Add a new entry to the Table of Contents** — follow the same naming convention used for existing entries (e.g. `<Extension Name> Unit Tests`, `<Extension Name> Integration Tests`).
3. **Add the corresponding section** — place it after the existing test sections, include the **Path** line, and start with `> _To be populated._` until tests are written.

Keep naming, formatting, and ordering consistent with what is already here.
