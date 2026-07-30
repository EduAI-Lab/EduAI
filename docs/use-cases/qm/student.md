# Student actor

**QM is instructor tooling. By design, `STUDENT` is meant to have zero access to QM — no reads, no writes, not even bug-report submission.** ADMIN (and UNIT_ADMIN, department-scoped) retain their usual platform-wide oversight access as expected for any app; STUDENT is the one role QM is not built to serve at all, full stop, with no carve-outs for "harmless" utility routes.

Scenarios below are tagged inline:

- **No tag** — correctly rejected today; matches the zero-access intent (UC-STUDENT-002).
- **`[BUG]`** — currently reachable by a STUDENT session in the deployed code, but should not be. These are documented so they're not lost, not because they're acceptable. Each one states what should happen instead.

Confirmed `[BUG]` surface today: bug-report submission (UC-STUDENT-001), the
ability to ensure a local anchor for a Core course in the student's scoped
catalog (UC-STUDENT-004), and the resulting Core-outage owner fallback
(UC-STUDENT-003). Under normal Core-backed resolution, a `STUDENT` enrollment
still maps to `rank: 0`; the elevation occurs only when the enrollment lookup
fails and local anchor ownership is used instead. The former local sandbox and
automatic demo seeding paths no longer exist.

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
- **Failure modes / what could go wrong:** None here — this is the desired
  state. The remaining `[BUG]` surface is limited to routes that authenticate
  without enforcing a QM author role (`POST /api/course` and
  `POST /api/bug-reports`).
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/middleware/courseAccess.js`
  - `apps/extensions/question-maker/app/backend/src/middleware/roles.js`

---

### UC-STUDENT-003: `[BUG]` Core outage activates the anchor-owner fallback

- **Category:** Error Recovery
- **Actor:** platform `STUDENT` who previously created a Core-linked anchor
  through UC-STUDENT-004
- **Preconditions:** The anchor's `userId` is the student's id; Core becomes
  unreachable
- **Entry point(s):** `middleware/courseAccess.js`, `routes/course.js`
- **Flow:**
  1. Student requests an instructor-gated course operation such as
     `DELETE /api/course/:id`
  2. `getCourseEnrollmentsFromCore` fails because Core is unavailable
  3. `resolveAccessForCourse` catches the failure and returns
     `LEVELS.instructor` because `reqUser.id === course.userId`
  4. The `min: 'instructor'` gate passes and the local anchor is deleted
- **Expected outcome (current, unpatched code):** The Core-down owner fallback
  elevates the student from their real `rank: 0` enrollment to instructor rank
  for course-router operations.
- **Failure modes / what could go wrong:** **`[BUG]`** — a fail-open
  availability fallback becomes an authorization bypass when an ineligible
  role was allowed to own the anchor. A QM-author gate on anchor creation
  prevents new student-owned rows; the fallback itself should also be reviewed
  before treating local ownership as instructor authority during an outage.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/middleware/courseAccess.js`
  - `apps/extensions/question-maker/app/backend/src/routes/course.js`

---

### UC-STUDENT-004: `[BUG]` Student can ensure an anchor for a scoped Core course

- **Category:** Malicious/Adversarial
- **Actor:** platform `STUDENT` enrolled in a published Core course
- **Preconditions:** The course appears in the caller-scoped Core catalog;
  `POST /api/course` has authentication but no QM-author role gate
- **Entry point(s):** `routes/course.js` (`POST /`)
- **Flow:**
  1. Student sends `POST /api/course` with the real `coreCourseId`
  2. `isCoreCourseInScopedList` performs a cookie-scoped `?ids=` lookup; the
     course is visible to the enrolled student, so the check passes
  3. QM creates a globally unique, already-linked anchor with the student as
     `userId`, or returns the existing anchor if another caller created it
  4. Subsequent course routes resolve the real Core enrollment as
     `LEVELS.student` (`rank: 0`), below the `min: 'ta'`/`min: 'instructor'`
     gates; question, assessment, variant, and Canvas routers also reject the
     platform role
- **Expected outcome (current, unpatched code):** The ensure returns `201` for a
  new anchor or `200` for an existing anchor, but the student cannot list,
  open, mutate, or author against it.
- **Failure modes / what could go wrong:** **`[BUG]`** — a role with no QM
  product surface can still cause a database write. Add a QM-author role gate
  to the ensure route if zero student-side effects is the intended contract.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/routes/course.js`
  - `apps/extensions/question-maker/app/backend/src/middleware/courseAccess.js`

---

### UC-STUDENT-005: First login creates only the thin local user record

- **Category:** Happy Path
- **Actor:** Any brand-new platform `STUDENT` (including a course-level TA whose platform role is `STUDENT`)
- **Preconditions:** No local QM `User` row exists yet for this Core user id
- **Entry point(s):** `middleware/auth.js` (`requireAuth`), `services/authService.js` (`findOrCreateUser`)
- **Flow:**
  1. New student's first request (e.g. the frontend's initial `GET /api/auth/me`) triggers `findOrCreateUser`
  2. `prisma.user.upsert` inserts the minimal local identity row
  3. No course, topic, assessment, question, or variant seeding runs
- **Expected outcome:** The local user exists for QM foreign-key integrity and
  owns no demo content. `GET /api/course` returns no author-visible courses for
  a student-only caller.
- **Failure modes / what could go wrong:** None found. Demo data is now limited
  to explicit seed/test utilities and is not part of login provisioning.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/middleware/auth.js`
  - `apps/extensions/question-maker/app/backend/src/services/authService.js`

---

### UC-STUDENT-006: Arbitrary or repeated course-anchor creation is bounded

- **Category:** Malicious/Adversarial
- **Actor:** platform `STUDENT`, scripting `POST /api/course` calls
- **Preconditions:** None
- **Entry point(s):** `routes/course.js` (`POST /`)
- **Flow:**
  1. A missing or non-string `coreCourseId` returns `400`
  2. A real id outside the caller-scoped Core catalog returns
     `403 CORE_COURSE_NOT_AUTHORIZED`
  3. A scoped id can create at most one row because `coreCourseId` is globally
     unique; later calls return the existing row with `200`
- **Expected outcome:** Arbitrary names and unlinked rows cannot be created.
  Repetition is idempotent rather than unbounded.
- **Failure modes / what could go wrong:** A student can still cause the first
  ensure for each distinct scoped course (UC-STUDENT-004), but cannot inflate
  the table with arbitrary or duplicate anchors.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/routes/course.js`
