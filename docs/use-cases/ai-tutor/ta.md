# TA actor

A TA in AI Tutor is, in the common case, exactly what Core calls "TA(C)" — a course-scoped role, not a platform one: a user whose platform `role` is `STUDENT` but who additionally holds a `CourseEnrollment` row with `role: 'TA'` on a specific course (checked ad hoc throughout the codebase as `enrollment?.role === 'TA'`, never a platform-level gate). AI Tutor's `UserRole` enum (`apps/extensions/ai-tutor/server/src/middleware/auth.js`, `VALID_ROLES`) does also include a *platform*-level `'TA'` role, and the two are **not interchangeable in code** — several important checks key off one but not the other, which this file covers explicitly.

The distinction matters concretely:

- **Course-level TA (`CourseEnrollment.role === 'TA'`)** grants elevated read/grade access *within that course* — viewing unpublished lessons, submissions, feedback, analytics, and grading — via the `isTa`/`hasElevatedAccess` checks repeated across `lessons.js`, `activities.js`, and `courses.js`.
- **Platform-level TA (`req.user.role === 'TA'`)** affects role-scoped listing (`GET /courses`, `GET /me/dashboard-stats`) and, crucially, is checked in `POST /questions/:id/answer` alongside `STUDENT` — but is explicitly **excluded** from every AI tutoring endpoint (`/teach`, `/guide`, `/custom`), which hard-check `authUser.role !== 'STUDENT'`. A platform-role TA cannot use the AI study buddy at all, in any course, even one they hold no TA enrollment in.

This file covers the TA's grading/oversight loop and the two crossover cases above — a platform-STUDENT TA who is simultaneously a "real" student in the same course, and a platform-TA who is locked out of tutoring entirely.

---

### UC-TA-001: Grading a student's submission and reviewing activity feedback

- **Category:** Happy Path
- **Actor:** A user with `CourseEnrollment(role: 'TA')` on the target course (platform role may be `STUDENT` or `TA`)
- **Preconditions:** At least one ungraded `Submission` exists on an activity in the course
- **Entry point(s):** `GET /activities/:activityId/submissions`, `PATCH /activities/:activityId/submissions/:submissionId`, `GET /activities/:activityId/feedback` (`apps/extensions/ai-tutor/server/src/routes/activities.js`)
- **Flow:**
  1. TA opens the grading view; `GET /activities/:activityId/submissions` loads the activity with `course.instructors`/`course.enrollments`, resolves `enrollment = course.enrollments.find(e => e.userId === authUser.id)`, and checks `isAdmin || isInstructor || isTa || unitAdmin` — `isTa` (`enrollment?.role === 'TA'`) is `true` here — returning all `Submission` rows for the activity ordered by `userId` then `attemptNumber`
  2. TA reviews one and overrides the grade: `PATCH /activities/:activityId/submissions/:submissionId { score?, isCorrect? }` — this route has **no `requireRole` middleware at all** (per its own doc comment: "TA is a per-course `CourseEnrollment.role`, not a platform role check alone can verify"); authorization is entirely the inline `if (!isCourseAdmin(authUser, course) && !isTa) return 403` after loading the submission's full course/enrollment context
  3. `score`/`isCorrect` are type-checked (`number|null`, `boolean|null`) before the update; note `feedback` (free text) is deliberately **not** an accepted field — `Submission` has no grader-feedback column, only the system-generated `aiFeedback` shown at submit time (a different concern), per the route's own comment
  4. TA also reviews qualitative student feedback: `GET /activities/:activityId/feedback` — same `isAdmin || isInstructor || isTa || unitAdmin` gate
- **Expected outcome:** `200` with the submission list / updated `Submission` row / feedback list; the TA can override `score`/`isCorrect` but cannot leave free-text grader feedback (no column exists for it).
- **Failure modes / what could go wrong:** None on the happy path; the intentional omission of a `requireRole` prefilter on the grading `PATCH` is deliberate (TA-ness can't be expressed as a platform role check) and is fully compensated for by the inline DB-derived check.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/routes/activities.js`

---

### UC-TA-002: Previewing unpublished lesson content ahead of students

- **Category:** Typical Use
- **Actor:** Course-level TA
- **Preconditions:** A lesson/module exists but `isPublished: false`
- **Entry point(s):** `GET /modules/:moduleId/lessons`, `GET /lessons/:lessonId`, `GET /lessons/:lessonId/activities` (`apps/extensions/ai-tutor/server/src/routes/lessons.js`, `activities.js`)
- **Flow:**
  1. TA opens the not-yet-published lesson; each of these routes computes `hasElevatedAccess = isAdmin || isInstructor || isTa || unitAdmin` and, for lessons, applies the publish filter only to plain enrolled students: `whereClause = hasElevatedAccess ? { moduleId } : { moduleId, isPublished: true }`
  2. On `GET /lessons/:lessonId` specifically, the explicit check is `if (isStudent && !hasElevatedAccess && !lesson.isPublished) return 403` — since `hasElevatedAccess` is `true` for a TA, this branch is skipped even though the lesson is unpublished
  3. `GET /lessons/:lessonId/activities` skips the student-only `completionStatus` enrichment for TAs (`if (isStudent && !hasElevatedAccess)`), returning bare activity records instead
- **Expected outcome:** `200` with full lesson/activity content regardless of publish state, for review/prep purposes before the class sees it.
- **Failure modes / what could go wrong:** None found — the unpublished-content exemption is scoped to the same `hasElevatedAccess` used everywhere else, not a separate ad hoc check.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/routes/lessons.js`
  - `apps/extensions/ai-tutor/server/src/routes/activities.js`

---

### UC-TA-003: A platform-STUDENT TA using AI tutoring as a student in the same course they TA for

- **Category:** Typical Use
- **Actor:** A user with platform `role: 'STUDENT'` who also holds `CourseEnrollment(role: 'TA')` on course X, and separately a plain `CourseEnrollment(role: 'STUDENT')`-style enrollment relationship is not required — the TA enrollment itself already satisfies the enrollment check in `handleAiInteraction`
- **Preconditions:** Course X has Teach/Guide/Custom mode enabled on some activity
- **Entry point(s):** `POST /activities/:activityId/teach|guide|custom` (`apps/extensions/ai-tutor/server/src/routes/activities.js`)
- **Flow:**
  1. This user sends a normal AI-help request on course X
  2. The route's gate checks `authUser.role !== 'STUDENT'` — `false`, since platform role is `STUDENT` — and `course.enrollments.some(e => e.userId === authUser.id)` — `true`, because the `CourseEnrollment(role: 'TA')` row itself counts as membership; the code never distinguishes *which* enrollment role satisfies this check, only that a row exists
  3. The request proceeds through the full dual-loop pipeline exactly as for any other student (see [`student.md`](student.md) UC-STUDENT-001), including `trackAiHelpRequest` recording an AI-help metric for this TA-as-student turn
- **Expected outcome:** `200` — the platform-STUDENT TA gets tutoring help in the very course they also grade, and their AI-help usage is recorded in the same `ActivityStudentMetric` rollup an instructor might review when assessing student engagement.
- **Failure modes / what could go wrong:** Not a security gap, but a product-semantics one worth flagging: nothing distinguishes "TA using the tutor to prep material" from "TA using the tutor as a student for their own coursework" in the resulting analytics — a course's AI-help metrics could be inflated or skewed by TA usage indistinguishable from genuine student usage, since `handleAiInteraction`'s enrollment check treats any enrollment row (regardless of its `role`) as sufficient.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/routes/activities.js`

---

### UC-TA-004: A platform-role TA is blocked from AI tutoring entirely

- **Category:** Wrong/Malformed Usage
- **Actor:** A user with platform `role: 'TA'` (not `STUDENT`), regardless of any course enrollment
- **Preconditions:** None
- **Entry point(s):** `POST /activities/:activityId/teach|guide|custom` (`apps/extensions/ai-tutor/server/src/routes/activities.js`)
- **Flow:**
  1. This user sends `POST /activities/:activityId/teach` on any course, including one where they hold a `CourseEnrollment(role: 'TA')`
  2. The route's gate is `if (authUser.role !== 'STUDENT') return res.status(403).json({ error: 'Only students can use AI tutoring' })` — this checks the **platform** role, not any course enrollment role; a platform-role `'TA'` fails this check unconditionally
  3. This happens before the enrollment check even runs, so it's identical whether or not the platform-TA is enrolled in the target course at all
- **Expected outcome:** `403 { "error": "Only students can use AI tutoring" }` for every platform-role-TA account, on every course, for all three AI modes — even though the *same* user, if instead modeled as platform-`STUDENT` + course-enrollment-`TA` (the more common convention per Core's own TA(C) pattern), would be allowed through (UC-TA-003).
- **Failure modes / what could go wrong:** This is a real behavioral inconsistency between the two ways "TA" is represented in the system — not a security hole (fails closed), but worth flagging for product/support: whether a TA account can preview the tutoring experience depends entirely on which of the two TA representations was used to provision that account, which is not obvious from the UI and could produce confusing "why can't I use this" reports.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/routes/activities.js`

---

### UC-TA-005: Submitting a grade override with an invalid type

- **Category:** Wrong/Malformed Usage
- **Actor:** Course-level TA
- **Preconditions:** A `Submission` exists
- **Entry point(s):** `PATCH /activities/:activityId/submissions/:submissionId` (`apps/extensions/ai-tutor/server/src/routes/activities.js`)
- **Flow:**
  1. TA sends `{ score: "95" }` (string instead of number) or `{ isCorrect: "yes" }` (string instead of boolean)
  2. The route's inline type checks — `if (typeof score !== 'undefined' && score !== null && typeof score !== 'number')` and the equivalent for `isCorrect` — reject both with `400` before any authorization lookup or DB write, ahead of even loading the submission row
  3. Sending `{}` (no recognized fields) hits the separate `Object.keys(updateData).length === 0` check, also `400 { error: 'Nothing to update' }`
- **Expected outcome:** `400` with a field-specific message in all three cases; no partial or type-mismatched write reaches `Submission`.
- **Failure modes / what could go wrong:** None — validation runs before the (potentially expensive) nested course/enrollment load, so malformed requests fail cheaply.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/routes/activities.js`

---

### UC-TA-006: Attempting to grade or view submissions for a course the actor doesn't TA

- **Category:** Malicious/Adversarial
- **Actor:** A user with `CourseEnrollment(role: 'TA')` on course A, targeting a submission on course B where they hold no enrollment or instructor row
- **Preconditions:** None
- **Entry point(s):** `GET /activities/:activityId/submissions`, `PATCH /activities/:activityId/submissions/:submissionId`, `GET /activities/:activityId/feedback`, `GET /courses/:courseId/submissions|feedback|student-metrics|analytics` (`apps/extensions/ai-tutor/server/src/routes/`)
- **Flow:**
  1. Attacker sends any of the above against course B's (or one of its activities') id
  2. Every route independently re-derives the enrollment for **this specific course**: `course.enrollments.find(e => e.userId === authUser.id)` on course B returns `undefined` (their only TA enrollment is on course A), so `isTa` is `false`; `isCourseAdmin` is also `false` since they hold no instructor/unit-admin relationship on B either
  3. All routes return `403` before any submission/feedback/analytics data for course B is read
- **Expected outcome:** `403 Forbidden` uniformly; a TA's elevated access is strictly per-course, never platform-wide or transferable from one course to another they happen to also TA.
- **Failure modes / what could go wrong:** None found — every one of these routes re-queries the specific course's `enrollments` fresh rather than trusting any cached/session-level "this user is a TA somewhere" flag.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/routes/activities.js`
  - `apps/extensions/ai-tutor/server/src/routes/courses.js`

---

### UC-TA-007: Attempting course/lesson/activity authoring actions as a TA

- **Category:** Malicious/Adversarial
- **Actor:** Course-level TA (elevated read/grade access on the course), platform role `STUDENT` or `TA`
- **Preconditions:** None
- **Entry point(s):** `POST /modules/:moduleId/lessons`, `PATCH /lessons/:lessonId`, `DELETE /lessons/:lessonId`, `POST /lessons/:lessonId/activities`, `PATCH /activities/:activityId`, `PATCH /courses/:courseId/publish` (all gated `requireRole(['INSTRUCTOR','UNIT_ADMIN','ADMIN'])`)
- **Flow:**
  1. Attacker (a legitimate TA on the course, attempting to exceed their grading/read role) sends e.g. `POST /lessons/:lessonId/activities` to add a new graded question, or `PATCH /courses/:courseId/publish`
  2. Unlike the grading/read endpoints (UC-TA-001/002), these authoring routes carry an explicit `requireRole(['INSTRUCTOR','UNIT_ADMIN','ADMIN'])` middleware that runs **before** any course-specific `isTa`/`isCourseAdmin` check — `'TA'` (platform role) and plain `'STUDENT'` (the common TA representation) are both absent from that allow-list
  3. The middleware returns `403 { error: "One of the following roles required: INSTRUCTOR, UNIT_ADMIN, ADMIN" }` immediately, without ever loading the target lesson/course row
- **Expected outcome:** `403 Forbidden` for every authoring mutation, regardless of how elevated the TA's read/grade access is on that specific course — grading and content-authoring are enforced as genuinely separate capabilities, not tiers of one "elevated access" concept.
- **Failure modes / what could go wrong:** None found — the two capability sets (grade/read vs. author) use structurally different gates (`requireRole` allow-list vs. inline `isTa`/`isCourseAdmin`), so there's no single flag whose value would accidentally grant both.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/routes/lessons.js`
  - `apps/extensions/ai-tutor/server/src/routes/activities.js`
  - `apps/extensions/ai-tutor/server/src/routes/courses.js`
