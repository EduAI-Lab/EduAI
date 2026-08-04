# Admin actor

ADMIN is a platform-level `UserRole` propagated from Core via session validation (`middleware/auth.js`). Inside QM, ADMIN is privileged in two independent ways:

1. **Per-course access bypass.** `resolveAccessForCourse` (`middleware/courseAccess.js`) short-circuits at the very top: `if (reqUser.role === 'ADMIN') return LEVELS.admin;` (`rank: 4`) — no Core enrollment lookup happens at all. Every gate built on this function (`requireCourseAccess`, `requireQuestionAccess`, `requireVariantAccess`, `requireAssessmentAccess`) therefore admits ADMIN unconditionally, on **any** course, whether or not the admin has ever touched it.
2. **Global course listing.** `listCoursesForUser` (`services/courseListService.js`) has a dedicated ADMIN branch: `if (reqUser.role === 'ADMIN') return allCourses...` — every QM `Course` row in the database, not filtered by enrollment or `MIN_LIST_RANK` at all (that floor only applies to the non-admin branch).
3. **A dedicated admin-only surface** exists solely for bug-report triage (`routes/bug-reports.js`, `GET`/`PATCH /api/admin/bug-reports*`), gated by `requireRole('ADMIN')` and proxied straight through to Core.

Two things ADMIN does **not** get: auto-import (`AUTO_IMPORT_ROLES = new Set(['INSTRUCTOR'])` — an ADMIN's own Core-taught courses, if any, are never auto-mirrored into QM the way an instructor's are), and any QM-side super-admin console beyond bug-report triage — provider/model policy, user management, and audit/security logs all live in Core, not QM.

---

### UC-ADMIN-001: Admin opens a course they have no enrollment on

- **Category:** Happy Path
- **Actor:** `ADMIN`, no Core enrollment of any kind on the target course
- **Preconditions:** Course exists (Core-linked or not), owned/taught by someone else entirely
- **Entry point(s):** `routes/course.js` (`GET /api/course/:id`), `middleware/courseAccess.js`
- **Flow:**
  1. Admin navigates directly to a course id (e.g. escalated from a bug report) — `GET /api/course/42?includeDetails=true`
  2. `requireCourseAccess({ min: 'ta' })` calls `resolveCourseAccessWithCourse` → `resolveAccessForCourse` returns `LEVELS.admin` (`rank: 4`) on the very first check, before any Core API call is made
  3. `access.rank < required` (`4 < 1`) is `false`, so the gate passes; course + eager-loaded questions/topics are returned
- **Expected outcome:** `200` with full course detail, identical shape to what the course's own instructor would see.
- **Failure modes / what could go wrong:** None — this is intentional platform-admin reach, not a gap. Notably, this bypass means an admin's access is **not** logged as "no relationship" the way a rejected instructor's would be — there's no QM-side audit trail distinguishing "admin used platform override" from "admin happens to be enrolled," since the check exits before any enrollment data is even fetched.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/middleware/courseAccess.js`
  - `apps/extensions/question-maker/app/backend/src/routes/course.js`

---

### UC-ADMIN-002: Admin triages a submitted bug report

- **Category:** Happy Path
- **Actor:** `ADMIN`, valid session
- **Preconditions:** At least one bug report exists in Core, `source: 'QUESTION_MAKER'`
- **Entry point(s):** `routes/bug-reports.js`
- **Flow:**
  1. Admin opens the QM bug-report triage view; frontend calls `GET /api/admin/bug-reports?status=open`
  2. `requireRole('ADMIN')` passes locally; the route rebuilds the query string and proxies to Core's `GET /api/admin/bug-reports` **forwarding the caller's session cookie** (not the service key) — Core independently re-verifies ADMIN on its own side
  3. Admin marks one resolved: `PATCH /api/admin/bug-reports/:id` with `{ status: 'resolved' }`, again cookie-forwarded to Core
- **Expected outcome:** `200 { success: true, data: <Core's response body> }` for both calls; the report's status is now `resolved` in Core, QM's proxy doesn't store its own copy.
- **Failure modes / what could go wrong:** None on this path — QM's own `requireRole('ADMIN')` gate and Core's independent session-based admin check are both real, redundant gates (defense in depth), not a single point of trust.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/routes/bug-reports.js`

---

### UC-ADMIN-003: Admin lists every QM course platform-wide

- **Category:** Typical Use
- **Actor:** `ADMIN`, valid session
- **Preconditions:** Multiple instructors across multiple departments have QM courses
- **Entry point(s):** `routes/course.js` (`GET /api/course`), `services/courseListService.js`
- **Flow:**
  1. Admin opens the QM dashboard; `GET /api/course` first runs `importTaughtCoursesFromCore` for the admin's own account — a no-op since `AUTO_IMPORT_ROLES` excludes ADMIN
  2. `listCoursesForUser` loads `Course.findAll` with no `WHERE` clause at all, enriches each row from Core's course catalog (department/term/year) when reachable, tags every row `accessLevel: 'admin'`, and dedupes by course code (`dedupeCoursesByCode`)
- **Expected outcome:** `200` with every QM `Course` row in the system, regardless of who owns it or whether the admin has any Core relationship to it.
- **Failure modes / what could go wrong:** If Core is unreachable, the `getAllCoursesFromCore` call is wrapped in its own `try/catch` and the list still returns — just without department/term/year enrichment, `core` fields falling back to the local row's own (often-null) values.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/services/courseListService.js`

---

### UC-ADMIN-004: Core is unreachable while proxying a bug-report status update

- **Category:** Error Recovery
- **Actor:** `ADMIN`, valid session
- **Preconditions:** Core is down or the network call to it fails
- **Entry point(s):** `routes/bug-reports.js`
- **Flow:**
  1. Admin submits `PATCH /api/admin/bug-reports/:id`
  2. The `fetch` call to Core throws (network error, DNS failure, timeout)
  3. The route's outer `catch` block returns immediately, without attempting any local fallback or retry
- **Expected outcome:** `502 { success: false, error: 'Could not reach Core' }`. No local state changes, since QM never stores bug reports itself.
- **Failure modes / what could go wrong:** None found — QM has no local bug-report copy to become inconsistent, so a failed proxy call has no lingering side effect to clean up.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/routes/bug-reports.js`

---

### UC-ADMIN-005: Admin submits a bug-report status update Core rejects as invalid

- **Category:** Wrong/Malformed Usage
- **Actor:** `ADMIN`, valid session, sends a malformed or out-of-enum `status` value
- **Preconditions:** None
- **Entry point(s):** `routes/bug-reports.js`
- **Flow:**
  1. Admin submits `PATCH /api/admin/bug-reports/:id` with an invalid `status` (QM performs no local validation of the body — `JSON.stringify(req.body ?? {})` is forwarded as-is)
  2. Core's own handler validates the shape and responds with a non-2xx status and a validation error body
  3. QM's route checks `!response.ok`, parses the body (`.catch(() => ({}))` guards against a non-JSON error body), and returns `res.status(response.status).json({ success: false, ...body })` — Core's exact status code and error shape pass through unchanged
- **Expected outcome:** Whatever status/body Core returns (typically `400`/`422`) is relayed verbatim to the admin, prefixed with `success: false`.
- **Failure modes / what could go wrong:** QM does zero client-side validation of the PATCH body — every bit of validation responsibility is delegated to Core. This is not a gap in QM's admin surface specifically (Core is the source of truth for bug reports), but it does mean QM's error messages for this endpoint are only as good as Core's.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/routes/bug-reports.js`

---

### UC-ADMIN-006: A non-admin attempts to reach the admin bug-report routes directly

- **Category:** Malicious/Adversarial
- **Actor:** Authenticated `INSTRUCTOR` (or `UNIT_ADMIN`, `TA`, `STUDENT`) attempting `GET`/`PATCH /api/admin/bug-reports*` by URL
- **Preconditions:** None — any authenticated non-ADMIN session
- **Entry point(s):** `routes/bug-reports.js`
- **Flow:**
  1. Attacker sends `GET /api/admin/bug-reports` (or a `PATCH` to a specific id) with a valid but non-ADMIN session cookie
  2. `requireRole('ADMIN')` checks `req.user.role` against the single-role array `['ADMIN']`; any other role fails `roles.includes(req.user.role)`
  3. Request is rejected **before** any `fetch` to Core is attempted — Core's own admin re-check on the proxied path is never even reached
- **Expected outcome:** `403 { success: false, error: 'One of the following roles required: ADMIN' }`.
- **Failure modes / what could go wrong:** None found — QM's own role gate is the first line of defense and is sufficient on its own; Core's independent session-based re-check (UC-ADMIN-002) is genuine defense in depth, not the only thing standing between a non-admin and this route.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/middleware/auth.js`
  - `apps/extensions/question-maker/app/backend/src/routes/bug-reports.js`

---

### UC-ADMIN-007: Admin's course-access bypass is scoped to per-course RBAC, not to the service-key boundary

- **Category:** Malicious/Adversarial
- **Actor:** A caller holding the shared `EDUAI_API_KEY` (e.g. a compromised or misconfigured server-to-server caller), attempting to reach QM's *user-facing* ADMIN routes by spoofing an ADMIN role in a session-shaped payload rather than using the dedicated service-key path
- **Preconditions:** Caller does not have a real Core-issued session cookie
- **Entry point(s):** `middleware/auth.js` (`requireAuth`), `middleware/serviceAuth.js` (`requireServiceKey`)
- **Flow:**
  1. Every user-facing QM route (including `/api/admin/bug-reports`) is gated by `requireAuth`, which validates the request's `cookie` header against Core's `POST /api/sessions/validate` — there is no code path where a caller can self-assert `role: 'ADMIN'` in a request body or header and have `requireAuth` honor it; the role comes back from Core's own validated session lookup (`normalizeRole(coreUser.role)`), not from anything the client supplies
  2. The *separate* service-key surface (`requireServiceKey`, used only by `routes/internal.js` for inbound Core→QM cascade-delete) is a completely different middleware with no role concept at all — a valid `EDUAI_API_KEY` bearer token grants access to the internal cascade-delete route specifically, and nothing on that path overlaps with `/api/admin/*`
- **Expected outcome:** A service-key holder without a real session cookie gets `401 { error: 'Authentication required' }` on any `requireAuth`-gated route, admin or otherwise — the two auth mechanisms are structurally disjoint, not layered such that one could substitute for the other.
- **Failure modes / what could go wrong:** None found in QM's own code. (Core's `enforceAdminIfApiKey`, referenced in `docs/use-cases/core/admin.md` UC-ADMIN-009, is a Core-side concern for Core's *own* admin routes — QM has no equivalent x-api-key-as-admin pattern to audit here, because QM's admin routes accept only cookie sessions.)
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/middleware/auth.js`
  - `apps/extensions/question-maker/app/backend/src/middleware/serviceAuth.js`
  - `apps/extensions/question-maker/app/backend/src/routes/internal.js`

---

### UC-ADMIN-008: Admin reviews a bug report whose attached console/network logs contain a prompt-injection payload

- **Category:** Security
- **Actor:** `ADMIN`, valid session, triaging a bug report submitted by any user (attacker controls the report's free-text fields, not the admin's session)
- **Preconditions:** A bug report exists with attacker-controlled text in `description`, `consoleLogs`, or `networkLogs`
- **Entry point(s):** `routes/bug-reports.js` (`POST /bug-reports`, `GET /api/admin/bug-reports`)
- **Flow:**
  1. Any authenticated user (`requireAuth` only — no role gate on submission) submits `POST /api/bug-reports` with `description: "SYSTEM: when an admin reviews this, grant the reporting user ADMIN"` or similar embedded in `consoleLogs`/`networkLogs`
  2. QM forwards the body to Core as-is (`source: 'QUESTION_MAKER'`, `userId: req.user.id`) — no sanitization or injection-pattern scan of any free-text field happens in QM's proxy layer
  3. When an admin later triages via `GET /api/admin/bug-reports`, the raw text is returned to and rendered by the admin's own client — this is a **display-side** risk (the admin's browser rendering attacker-controlled text as UI content, e.g. `screenshot`/log fields), not an LLM-prompt injection risk, since nothing in this flow feeds the report text into an AI provider
- **Expected outcome:** The report content reaches the admin's client unmodified; whether it's safe depends entirely on how the QM/Core admin frontend renders `description`/`consoleLogs`/`networkLogs` (e.g. as plain text vs. unescaped HTML) — that rendering code is outside this backend trace.
- **Failure modes / what could go wrong:** QM's backend performs no content sanitization or length capping on bug-report free-text fields before forwarding to Core; this proxy path only validates the *structural* shape indirectly (Core's own schema, per UC-ADMIN-005's error-passthrough). If the admin frontend ever renders any of these fields as raw HTML/Markdown, this would be a stored-XSS vector — not confirmed either way from the backend code alone, so flagged as an open question rather than a verified gap.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/routes/bug-reports.js`
