# Student actor

**QM is instructor tooling. By design, `STUDENT` is meant to have zero access to QM — no reads, no writes, not even bug-report submission.** ADMIN (and UNIT_ADMIN, department-scoped) retain their usual platform-wide oversight access as expected for any app; STUDENT is the one role QM is not built to serve at all, full stop, with no carve-outs for "harmless" utility routes.

Scenarios below are tagged inline:

- **No tag** — correctly rejected today; matches the zero-access intent (UC-STUDENT-002).
- **`[BUG]`** — currently reachable by a STUDENT session in the deployed code, but should not be. These are documented so they're not lost, not because they're acceptable. Each one states what should happen instead.

Confirmed `[BUG]` surface today: bug-report submission (UC-STUDENT-001), manual local-course creation (UC-STUDENT-004), automatic demo-course seeding on first login (UC-STUDENT-005), and unbounded course creation as a consequence of both (UC-STUDENT-006). All four trace back to two things: (1) `routes/bug-reports.js`'s `POST /bug-reports` uses `requireAuth` with no role check, and (2) `routes/course.js` has no `requireRole` gate anywhere in the router. Closing both is the fix — reject `STUDENT` in `course.js` the same way `questions.js`/`assessments.js`/`variants.js`/`canvas.js` already do, and reject `STUDENT` in `bug-reports.js`'s submission route too (leaving Core's own cross-app bug-report channel, if any, as the place a student-reported issue would need to go instead — not something to resolve inside this doc-only pass).

---

### UC-STUDENT-001: `[BUG]` Student can currently submit a bug report — should be blocked

- **Category:** Malicious/Adversarial
- **Actor:** platform `STUDENT`
- **Preconditions:** `EDUAI_API_KEY` configured
- **Entry point(s):** `routes/bug-reports.js`
- **Flow:**
  1. Student submits `POST /api/bug-reports` with a description
  2. `requireAuth` is the only gate — no `requireRole` check of any kind — so any authenticated platform role, including `STUDENT`, passes
  3. The route proxies to Core with the service key, tagging `source: 'QUESTION_MAKER'`, `userId: req.user.id`
- **Expected outcome (current, unpatched code):** `201 { success: true }` — the report is accepted and forwarded to Core exactly as it would be for an instructor.
- **Failure modes / what could go wrong:** **`[BUG]`** — given the stated zero-access intent, this should be `403`, not `201`. Unlike Core's or AI Tutor's bug-report routes (which do serve students, since those apps *have* a student product surface), QM's version of this route has no reason to accept a STUDENT caller if QM has nothing for students to report bugs about. Recommended fix (not applied here): add a role check to `POST /api/bug-reports` in QM specifically, or otherwise scope student issue-reporting to an app that actually serves them.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/routes/bug-reports.js`

---

### UC-STUDENT-002: Student is correctly rejected everywhere else in QM

- **Category:** Wrong/Malformed Usage
- **Actor:** platform `STUDENT` with a genuine Core `STUDENT` enrollment on a real, Core-linked, populated course
- **Preconditions:** None
- **Entry point(s):** `routes/course.js`, `routes/topics.js`, `routes/questions.js`, `routes/assessments.js`, `routes/canvas.js`
- **Flow:**
  1. Student tries `GET /api/course/:id?includeDetails=true` — `requireCourseAccess({ min: 'ta' })`; `rank: 0 < 1` → `403`
  2. Student tries `GET /api/course/:id/topics` or `GET /api/course/:id/enrollments` — same `min: 'ta'` gate → `403`
  3. Student tries `GET /api/questions?courseId=...` — blocked at the flat `requireRole(QM_AUTHORIZED)` gate before course access is even considered → `403`
  4. Same outcome for any `assessments.js`/`assessmentVariant.js`/`variants.js`/`canvas.js` route, and for any `course.js` route gated by `requireCourseAccess` on a course they don't own
- **Expected outcome:** `403` on every one of these — this is the correct, intended behavior.
- **Failure modes / what could go wrong:** None here — this is the desired state. The `[BUG]` surface is entirely elsewhere: routes with **no role/course gate at all** (`POST /api/course`, `POST /api/bug-reports`), not routes whose gate a student merely fails to clear.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/middleware/courseAccess.js`
  - `apps/extensions/question-maker/app/backend/src/middleware/roles.js`

---

### UC-STUDENT-003: Core is unreachable while a student's local course-creation `[BUG]` is being exercised

- **Category:** Error Recovery
- **Actor:** platform `STUDENT` who has created a local unlinked QM course (see UC-STUDENT-004 — a `[BUG]`-tagged scenario) and attempts to link it to a real Core course while Core is down
- **Preconditions:** Local `Course` row exists, `coreCourseId: null`; Core is unreachable
- **Entry point(s):** `routes/course.js` (`PATCH /:id/link-core`)
- **Flow:**
  1. Student (still holding instructor-rank on their own unlinked row per UC-STUDENT-004) submits `PATCH /api/course/:id/link-core` with a `coreCourseId`
  2. `isCoreCourseInScopedList(coreCourseId, cookie)` calls `listCoursesFromCore`, which throws
  3. The route's `catch` reads `Number.isInteger(err?.status) ? err.status : 502` and returns that status with `err.message || 'Failed to verify Core course access'`
- **Expected outcome:** Typically `502 { success: false, error: 'Failed to verify Core course access' }`; the local row is untouched.
- **Failure modes / what could go wrong:** This scenario only exists because of the UC-STUDENT-004 `[BUG]` — a STUDENT should 403 before ever reaching `PATCH /:id/link-core`. The Core-outage handling itself (fails closed, no partial state) is fine; it's the reachability that's wrong.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/routes/course.js`

---

### UC-STUDENT-004: `[BUG]` Student creates a local course and holds instructor rank on it — should be blocked

- **Category:** Malicious/Adversarial
- **Actor:** platform `STUDENT`, no special enrollment anywhere
- **Preconditions:** None — `POST /api/course` has no role gate of any kind
- **Entry point(s):** `routes/course.js` (`POST /`, `PUT /:id`, `DELETE /:id`, `POST /:id/topics`, `PATCH /:id/link-core`)
- **Flow:**
  1. Student sends `POST /api/course` with `{ name: 'Fake Course' }` — `authenticateToken` is the *only* gate on this route; a `Course` row is created with `userId: <student's id>`, `coreCourseId: null`
  2. Student now requests `PUT /api/course/:id` (rename), `POST /api/course/:id/topics` (add topics), or `DELETE /api/course/:id` — every one of these is gated `requireCourseAccess({ min: 'instructor' })`
  3. `resolveAccessForCourse`'s first branch fires: `if (!course.coreCourseId) { if (reqUser.id === course.userId) return LEVELS.instructor; ... }` — this check runs **before any platform-role check at all**, so `STUDENT` never gets filtered out; being the creator of an unlinked row alone is sufficient for `rank: 2`
  4. Student can fully manage this fake course (rename, add/delete local topics, delete the course) for as long as it stays unlinked; authoring questions/assessments/variants on it is still blocked by the separate flat `requireRole(QM_AUTHORIZED)` gate on those routers
  5. If the student links this row to a real Core course they're genuinely enrolled in **as a STUDENT**, `isCoreCourseInScopedList` only checks list membership, not enrollment role, so the link succeeds — but this also causes `resolveAccessForCourse` to stop using the owner-fallback (course is no longer unlinked) and fall through to the real enrollment-based branch, which resolves `STUDENT → rank: 0`. The elevated rank evaporates the instant the course is linked to anything real.
- **Expected outcome (current, unpatched code):** A STUDENT can create, rename, and manage a local-only course row at instructor rank — `201`/`200` throughout.
- **Failure modes / what could go wrong:** **`[BUG]`** — every step here should `403` immediately at `POST /api/course`, before a `Course` row is ever created. No real course data is exposed and no real content can be authored (the flat `QM_AUTHORIZED` gate on `questions.js`/`assessments.js`/etc. still holds), but the root cause — course-row ownership, not platform role, determines instructor-rank access on unlinked rows — is precisely the kind of gap the "students shouldn't be able to access it at all" requirement rules out. Recommended fix (not applied here, doc-only pass): add `requireRole(QM_AUTHORIZED)` to `course.js`'s router the same way every other QM router does.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/routes/course.js`
  - `apps/extensions/question-maker/app/backend/src/middleware/courseAccess.js`

---

### UC-STUDENT-005: `[BUG]` Every new student account is auto-seeded with 7 instructor-rank-accessible demo courses — should never happen

- **Category:** Malicious/Adversarial
- **Actor:** Any brand-new platform `STUDENT` (or course-level TA, whose platform role is also `STUDENT`), on their very first authenticated request to QM — no deliberate action required
- **Preconditions:** No local QM `User` row exists yet for this Core user id
- **Entry point(s):** `middleware/auth.js` (`requireAuth`), `services/authService.js` (`findOrCreateUser`), `services/seedNewUserService.js`
- **Flow:**
  1. New student's first request (e.g. the frontend's initial `GET /api/auth/me`) triggers `findOrCreateUser`
  2. `User.findOrCreate` creates the row; since `coursesSeededAt` is `null` and `courseCount === 0`, the seeding gate `!['INSTRUCTOR', 'UNIT_ADMIN'].includes(role)` evaluates `true` for `STUDENT` (and, since TA has no distinct platform role, for TAs too)
  3. `seedCoursesForNewUser(user.id)` bulk-creates 7 demo `Course` rows (`Machine Architecture`, `Computer Programming II`, etc.) owned by the new student, each with real topics, a `Practice Exam` assessment, and several approved (`isDraft: false`) sample questions — all `coreCourseId: null`
  4. Because these rows are unlinked and owned by the student, `resolveAccessForCourse`'s pre-link fallback (the same mechanism as UC-STUDENT-004) grants the student `LEVELS.instructor` (`rank: 2`) on every one of them
  5. `GET /api/course` lists all 7, tagged `accessLevel: 'instructor'`; `GET /api/course/:id?includeDetails=true` — gated only by `requireCourseAccess({ min: 'ta' })`, **not** by `requireRole(QM_AUTHORIZED)` — returns full question/topic detail for each, since this specific route has no flat role gate at all
- **Expected outcome (current, unpatched code):** A brand-new STUDENT account, without doing anything unusual, ends up owning and able to browse 7 real demo courses with real question content at instructor rank.
- **Failure modes / what could go wrong:** **`[BUG]`**, and the worst of the four: this requires zero action from the student — it happens to every new STUDENT/TA account by default. Two independent fixes are needed, not one: (a) reject STUDENT in `course.js` (closes UC-STUDENT-004 too), and (b) `findOrCreateUser`'s seeding gate itself should not run `seedCoursesForNewUser` for `STUDENT`/`TA` at all — fixing only (a) would still let seeding happen, it would just make the seeded courses unreachable rather than not-created.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/middleware/auth.js`
  - `apps/extensions/question-maker/app/backend/src/services/authService.js`
  - `apps/extensions/question-maker/app/backend/src/services/seedNewUserService.js`
  - `apps/extensions/question-maker/app/backend/src/routes/course.js`

---

### UC-STUDENT-006: `[BUG]` Unbounded local course creation by a role that shouldn't be creating any

- **Category:** Malicious/Adversarial
- **Actor:** platform `STUDENT`, scripting repeated `POST /api/course` calls
- **Preconditions:** None
- **Entry point(s):** `routes/course.js` (`POST /`)
- **Flow:**
  1. Attacker scripts `POST /api/course` in a loop with arbitrary `name` values
  2. No role gate, no per-user row cap, no rate limiting, and no uniqueness constraint on `name`/`code` — each call is a plain `Course.create`
  3. `GET /api/course` then does an unfiltered `Course.findAll` for the ADMIN branch, and loops every row through `resolveAccessForCourse` for non-admin callers (see `unit-admin.md` UC-UNIT-ADMIN-007 for the per-row Core-call amplification this causes for `UNIT_ADMIN` specifically)
- **Expected outcome (current, unpatched code):** Each call succeeds with `201`; the `Course` table grows without bound, driven entirely by a role that's supposed to have no write access to QM at all.
- **Failure modes / what could go wrong:** **`[BUG]`**, entirely downstream of UC-STUDENT-004 — since STUDENT shouldn't reach `POST /api/course` at all, this isn't a separate missing-rate-limit issue so much as evidence the same missing role gate has no ceiling on it. Closing UC-STUDENT-004's gap (reject STUDENT on `course.js` entirely) closes this one too.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/routes/course.js`
  - `apps/extensions/question-maker/app/backend/src/services/courseListService.js`
