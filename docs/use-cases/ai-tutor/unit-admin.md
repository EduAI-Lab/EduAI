# Unit-admin actor

A UNIT_ADMIN in AI Tutor is a platform user with `role === 'UNIT_ADMIN'` (Core's `UserRole`), whose scope is department-bound via `authorizedUnits` — an array of department strings that arrives on `req.user` straight from Core's `POST /api/sessions/validate` response (`apps/extensions/ai-tutor/server/src/middleware/auth.js`; AI Tutor trusts this array as-is, it has no local table of unit assignments). Department scoping is resolved per-course by `isUnitAdminForCourse(user, course)` (`apps/extensions/ai-tutor/server/src/middleware/auth.js`): `true` only when `course.department` is non-null **and** appears in `user.authorizedUnits` — a course with `department: null` is never reachable via unit scoping, by anyone, regardless of their authorized units (the "§19 unit lock" in the source comment). `isCourseAdmin` OR's this together with the plain `ADMIN` and course-`INSTRUCTOR` checks, so a UNIT_ADMIN gets `isCourseAdmin` on a course either by department match or by *also* being a listed `CourseInstructor` on it — the two paths are independent.

`course.department` is populated from Core's course metadata at import time (`importTaughtCoursesService.js`) — including a backfill path for courses that were seeded/imported before a department was ever set — and there is no admin/instructor-facing endpoint that lets anyone set or change `department` after that; `PATCH /courses/:courseId` only accepts `title`/`description`/`startDate`/`endDate`. So a unit admin's scope cannot be widened or narrowed by tampering with a course's editable fields.

This file covers the unit-admin's dual capability set — the same course-authoring/analytics surface as INSTRUCTOR (see [`instructor.md`](instructor.md)) but scoped by department instead of by individual course assignment, plus the admin-console slice they're allowed into (`/admin/courses/*`) versus the slice they're explicitly excluded from (`/admin/settings/*`, `/admin/users*`, per [`admin.md`](admin.md)).

---

### UC-UNIT-ADMIN-001: Managing every course in an authorized department without being its instructor

- **Category:** Happy Path
- **Actor:** UNIT_ADMIN with `authorizedUnits: ["CPSC"]`, targeting a course with `department: "CPSC"` they are not a `CourseInstructor` on
- **Preconditions:** The course was imported/seeded with `department` set to a unit the actor is authorized for
- **Entry point(s):** `PATCH /courses/:courseId`, `PATCH /courses/:courseId/publish`, `POST /lessons/:lessonId/activities`, `GET /courses/:courseId/analytics` (all shared with INSTRUCTOR — `apps/extensions/ai-tutor/server/src/routes/`)
- **Flow:**
  1. Unit admin opens the course; `GET /courses` includes it because the `UNIT_ADMIN` branch's `where` clause is `{ OR: [{ department: { in: units } }, { instructors: { some: { userId } } }] }` — department membership alone is sufficient, no enrollment or instructor row required
  2. Unit admin edits course metadata or publishes it: every one of these routes resolves `isCourseAdmin(authUser, course)`, which for a `UNIT_ADMIN` evaluates `isUnitAdminForCourse` — `course.department ("CPSC") != null && authUser.authorizedUnits.includes("CPSC")` — `true`
  3. Unit admin authors a lesson/activity on this course exactly as an instructor would (UC-INSTRUCTOR-001's flow, identical code path, identical `requireRole(['INSTRUCTOR','UNIT_ADMIN','ADMIN'])` gates)
- **Expected outcome:** All the same `200`/`201` outcomes as the equivalent instructor scenarios — the unit admin has full course-admin authority over any course in their department(s), independent of whether they personally teach it.
- **Failure modes / what could go wrong:** None on the happy path.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/middleware/auth.js`
  - `apps/extensions/ai-tutor/server/src/routes/courses.js`

---

### UC-UNIT-ADMIN-002: Reviewing AI interaction traces scoped to an authorized unit

- **Category:** Typical Use
- **Actor:** UNIT_ADMIN with `authorizedUnits: ["CPSC", "MATH"]`
- **Preconditions:** Students in both departments' courses have used AI tutoring
- **Entry point(s):** `GET /admin/ai-traces` (`apps/extensions/ai-tutor/server/src/routes/admin.js`)
- **Flow:**
  1. Unit admin requests traces with no `unit` query param: the route builds `courseOfferingWhere.department = { in: authUser.authorizedUnits }` — results span both CPSC and MATH, never any other department
  2. Unit admin narrows to one unit: `GET /admin/ai-traces?unit=CPSC`; the route checks `units.includes(unit)` first — `true` — then sets `courseOfferingWhere.department = "CPSC"` exactly
  3. If `authUser.authorizedUnits` is empty (a UNIT_ADMIN provisioned with no units yet), the route short-circuits to `res.json([])` before running any query at all, rather than an unscoped or error response
- **Expected outcome:** `200` with traces strictly limited to the actor's authorized department(s); an empty-units unit admin sees an empty list rather than everything or an error.
- **Failure modes / what could go wrong:** None found — the same narrow response shape as UC-ADMIN-002 applies here too (no `userMessage`/`finalResponse`/full trace exposed).
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/routes/admin.js`

---

### UC-UNIT-ADMIN-003: Reaching `/admin/courses/*` for enrollment management, blocked from `/admin/settings/*` and `/admin/users*`

- **Category:** Typical Use
- **Actor:** UNIT_ADMIN
- **Preconditions:** None
- **Entry point(s):** `GET /admin/courses/:courseId/enrollments`, `apps/extensions/ai-tutor/server/src/app.js` (isolation gate)
- **Flow:**
  1. Unit admin manages enrollment for a department course: `GET`/`POST`/`DELETE`/`PATCH /admin/courses/:courseId/enrollments...` — these routes are gated `requireRole(['ADMIN','UNIT_ADMIN','INSTRUCTOR'])` plus `isCourseAdmin`, both of which a department-scoped unit admin passes
  2. The `app.js` isolation gate runs *before* any route: for `UNIT_ADMIN`, it explicitly blocks only `req.path.startsWith('/admin/settings')` or `req.path.startsWith('/admin/users')` with `403 { error: 'Unit admins cannot access system configuration' }` — every other `/admin/*` path (including `/admin/courses/*` and `/admin/ai-traces`) passes through to the route's own `requireRole` check
- **Expected outcome:** `200` for `/admin/courses/*` operations within the actor's scope; `403` uniformly for anything under `/admin/settings/*` (EduAI API key, AI model policy) or `/admin/users*`, regardless of what `isCourseAdmin` would otherwise allow.
- **Failure modes / what could go wrong:** None — this is a deliberate, coarse path-prefix carve-out layered in front of (not instead of) each route's own `requireRole`, so even a future route naming mistake under `/admin/settings/` or `/admin/users` would still be blocked for `UNIT_ADMIN` by this gate alone.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/app.js`

---

### UC-UNIT-ADMIN-004: A course seeded without a department is unreachable by unit scoping alone

- **Category:** Error Recovery
- **Actor:** UNIT_ADMIN with `authorizedUnits: ["CPSC"]`, targeting a course with `department: null`
- **Preconditions:** The course was seeded or imported before a department value existed for it, and no instructor has re-triggered the backfill path (`importExternalCourseForUser`'s "already imported" branch, which only backfills `department` on a *subsequent* import attempt by some instructor)
- **Entry point(s):** `apps/extensions/ai-tutor/server/src/middleware/auth.js` (`isUnitAdminForCourse`), any course-admin route
- **Flow:**
  1. Unit admin attempts to edit/publish/manage the course; `isUnitAdminForCourse` evaluates `course.department != null` first — `false` for a `null` department — so the check short-circuits to `false` regardless of `authorizedUnits` contents
  2. Unless the unit admin also happens to be a `CourseInstructor` on this specific course, `isCourseAdmin` has no other path to `true`, and the route returns `403`
  3. The course also won't appear in the unit admin's `GET /courses` department-scoped list (same `department: { in: units }` filter), so the unit admin may not even know the course exists unless they already have another route into it (e.g. `GET /admin/courses` as an `ADMIN`, which lists everything — but that's a different role)
- **Expected outcome:** `403`/invisible-to-listing for a department-less course, even to a unit admin who should plausibly own it; the only recovery path is an instructor re-running the import flow so `importExternalCourseForUser`'s backfill branch sets `department`, or a direct DB fix.
- **Failure modes / what could go wrong:** This is a real operational gap (not a security hole — it fails closed, denying access rather than leaking it) — a unit admin has no self-service way to claim a department-less course into their scope; the "§19 unit lock" is intentionally strict (null never matches), which is safe by default but means a data-hygiene issue (missing department) manifests as an access problem rather than a visible data problem.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/middleware/auth.js`
  - `apps/extensions/ai-tutor/server/src/services/importTaughtCoursesService.js`

---

### UC-UNIT-ADMIN-005: Querying AI traces for a unit outside the actor's `authorizedUnits`

- **Category:** Wrong/Malformed Usage
- **Actor:** UNIT_ADMIN with `authorizedUnits: ["CPSC"]`
- **Preconditions:** A `"MATH"` department (with traces) exists that the actor is not authorized for
- **Entry point(s):** `GET /admin/ai-traces?unit=MATH` (`apps/extensions/ai-tutor/server/src/routes/admin.js`)
- **Flow:**
  1. Actor sends `GET /admin/ai-traces?unit=MATH`, either by mistake (stale UI state) or deliberately probing another department's data
  2. The route checks `units.includes(unit)` — `["CPSC"].includes("MATH")` is `false` — and returns `403 { error: 'Not authorized for this unit' }` immediately, before building any Prisma query
- **Expected outcome:** `403`; no trace data from `MATH` is disclosed even in aggregate.
- **Failure modes / what could go wrong:** None — the `unit` query param is validated as a request for a *specific* authorized unit, not trusted as an additional/replacement scope.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/routes/admin.js`

---

### UC-UNIT-ADMIN-006: Attempting to manage a course outside authorized departments and not personally instructed

- **Category:** Malicious/Adversarial
- **Actor:** UNIT_ADMIN with `authorizedUnits: ["CPSC"]`, targeting a course with `department: "MATH"` where the actor holds no `CourseInstructor` row
- **Preconditions:** None
- **Entry point(s):** `PATCH /courses/:courseId`, `DELETE /lessons/:lessonId`, `POST /admin/courses/:courseId/enrollments`, `POST /courses/:courseId/import` (all routes using `isCourseAdmin`)
- **Flow:**
  1. Attacker sends any course-admin mutation against the MATH course's id
  2. `isUnitAdminForCourse` evaluates `authUser.authorizedUnits.includes("MATH")` — `false`; the `INSTRUCTOR`-or-`UNIT_ADMIN` + `course.instructors.some(...)` branch of `isCourseAdmin` also fails since the actor has no instructor row on this course; `isCourseAdmin` returns `false` overall
  3. Every affected route returns `403` before any read of course content beyond what's needed for the authorization check itself, and before any mutation
- **Expected outcome:** `403 Forbidden` uniformly; a unit admin cannot reach into a department they aren't authorized for by manipulating course/lesson/activity ids, nor by using the `/admin/courses/*` enrollment endpoints against it.
- **Failure modes / what could go wrong:** None found — `authorizedUnits` is sourced exclusively from the Core-validated session on every request (never from the request body/query beyond the *narrowing* `unit` filter in UC-UNIT-ADMIN-002/005), and `department` is not client-settable (UC-UNIT-ADMIN-004's related note), so there's no way to widen `authorizedUnits` or retag a course's `department` from within AI Tutor to manufacture access.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/middleware/auth.js`
  - `apps/extensions/ai-tutor/server/src/routes/courses.js`
  - `apps/extensions/ai-tutor/server/src/routes/admin.js`

---

### UC-UNIT-ADMIN-007: Auto-linking as a course's `LEAD` instructor via re-import, outside department scope

- **Category:** Security
- **Actor:** UNIT_ADMIN with `authorizedUnits: ["CPSC"]`, importing a Core course they have legitimate Core-side access to (per `GET /eduai/courses`'s cookie-scoped listing) but that is tagged `department: "MATH"` in AI Tutor (or has no department yet)
- **Preconditions:** The Core course is already mirrored into AI Tutor as a `CourseOffering` (imported previously by someone else), and the actor's own Core session legitimately has access to import it (Core, not AI Tutor, is the authority on who may import which course)
- **Entry point(s):** `POST /courses/import-external` → `importExternalCourseForUser` (`apps/extensions/ai-tutor/server/src/services/importTaughtCoursesService.js`)
- **Flow:**
  1. Actor calls `POST /courses/import-external { externalCourseId }`; `findEduAiCourseById` confirms the course is in *their own* Core-scoped course list (this is a legitimate Core-side permission check, not a bypassable client claim)
  2. Because the offering already exists locally (`alreadyImported` is truthy), `importExternalCourseForUser` takes the "already imported" branch: it `upsert`s a `CourseInstructor` row linking **this actor** to the course with `role: 'LEAD'`, unconditionally — there is no department check gating this particular write
  3. From this point on, the actor has `isCourseAdmin` on the course via the plain `INSTRUCTOR`-or-`UNIT_ADMIN` + `course.instructors.some(...)` path, **regardless of `department`** — department scoping was never the only way in; being a `CourseInstructor` is an independent and equally sufficient grant
- **Expected outcome:** The actor gains full course-admin rights over a course outside their nominal department scope — but this is authorized *by Core*, since step 1's `findEduAiCourseById` check means Core itself considers this actor a legitimate instructor/course-holder for that Core course. AI Tutor is faithfully mirroring a Core-granted relationship, not creating a new one.
- **Failure modes / what could go wrong:** Not a bug in AI Tutor's own logic — it correctly defers "who may import/instruct this course" to Core — but it's a real trust-boundary detail worth recording: `department` scoping (`authorizedUnits`) and `CourseInstructor` membership are **independently sufficient** paths to `isCourseAdmin`, so a unit admin's *effective* scope is not fully described by their `authorizedUnits` alone. Anyone auditing "what can this unit admin touch" needs to also check their `CourseInstructor` rows, which can be granted via the import flow based on Core-side permissions AI Tutor doesn't itself gate by department.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/services/importTaughtCoursesService.js`
  - `apps/extensions/ai-tutor/server/src/middleware/auth.js`
