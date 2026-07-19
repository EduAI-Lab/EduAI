# Unit Admin actor

UNIT_ADMIN is a platform-level `UserRole`. Unlike ADMIN, it does **not** get an unconditional bypass in `resolveAccessForCourse` (`middleware/courseAccess.js`) — it gets a **department-scoped** one, and only when the course is already Core-linked:

```js
if (!course.coreCourseId) {                       // unlinked course: no department to check at all
  if (reqUser.id === course.userId) return LEVELS.instructor;
  return null;                                      // UNIT_ADMIN gets nothing here, same as anyone else
}
if (reqUser.role === 'UNIT_ADMIN') {
  const coreCourse = await getCourseFromCore(course.coreCourseId, { cookie });
  const department = coreCourse?.department ?? null;
  if (department !== null) {
    const units = await getAuthorizedUnits(reqUser, cookie);   // live Core lookup, see below
    if (units.includes(department)) return LEVELS.unit;         // rank 3
  }
  // outside their units (or department is null) — falls through to the same
  // enrollment-based check every other role goes through
}
```

Three consequences worth calling out:

1. **`rank: 3` clears every gate an instructor (`rank: 2`) clears**, plus the `rank >= 3` gates Core reserves for department-scoped actions — QM has no such higher gate of its own, so in practice `unit` and `instructor` access behave identically inside QM once granted.
2. **`authorizedUnits` is not carried on the QM session at all.** Core's `POST /api/sessions/validate` returns only `id/email/name/role`, so `getAuthorizedUnits` (`middleware/courseAccess.js`) fetches it fresh via `GET /api/me` (`getMyProfileFromCore`) **on every single course-access check** where the fast-path (`reqUser.authorizedUnits` already an array) doesn't apply — which, for a UNIT_ADMIN, is essentially always, since nothing in the request pipeline populates it. This means listing many courses (`listCoursesForUser`) can issue one `/api/me` call *per course row* for a UNIT_ADMIN.
3. **No auto-import.** `AUTO_IMPORT_ROLES = new Set(['INSTRUCTOR'])` excludes UNIT_ADMIN exactly like it excludes ADMIN — a department course never appears in QM automatically just because a unit admin is authorized over it; someone with `INSTRUCTOR` platform role must have opened QM at least once (or the unit admin must manually `POST /api/course` + `PATCH /:id/link-core`).

---

### UC-UNIT-ADMIN-001: Unit admin manages a course in their department without being its instructor

- **Category:** Happy Path
- **Actor:** `UNIT_ADMIN` with `authorizedUnits: ['CPSC']`, no Core enrollment on the target course
- **Preconditions:** Course is Core-linked (`coreCourseId` set), Core reports `department: 'CPSC'` for it
- **Entry point(s):** `middleware/courseAccess.js`, `routes/course.js` (`PUT /api/course/:id`)
- **Flow:**
  1. Unit admin opens a CPSC course they've never taught and edits its name (`PUT /api/course/:id`, `requireCourseAccess({ min: 'instructor' })`)
  2. `resolveAccessForCourse` sees the course is Core-linked, is not the unit admin's own (`course.userId` mismatch, so the pre-link fallback doesn't apply), and the role is `UNIT_ADMIN`
  3. `getCourseFromCore(course.coreCourseId, { cookie })` returns `{ department: 'CPSC', ... }`
  4. `getAuthorizedUnits` — `reqUser.authorizedUnits` is not an array on the QM session object, so it calls `getMyProfileFromCore(cookie)` (`GET /api/me` with the caller's own session cookie) and reads `profile.authorizedUnits`
  5. `'CPSC'` is in the returned list → `LEVELS.unit` (`rank: 3`) is returned; `3 >= 2` (the route's `min: 'instructor'`) passes
- **Expected outcome:** `200`, course updated — identical result to the course's actual instructor performing the same edit.
- **Failure modes / what could go wrong:** None on this path. This does mean a stale `/api/me` response (e.g. Core-side caching) could grant or withhold department access slightly out of step with the latest Core state, but there's no evidence of caching on that endpoint in this codebase.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/middleware/courseAccess.js`
  - `apps/extensions/question-maker/app/backend/src/routes/course.js`

---

### UC-UNIT-ADMIN-002: Unit admin imports a Canvas quiz into a department course

- **Category:** Typical Use
- **Actor:** `UNIT_ADMIN`, in-unit access (`rank: 3`) on the target course
- **Preconditions:** Course is Core-linked and in the admin's authorized department; admin has their own personal Canvas integration connected (`CANVAS_ROLES` includes `UNIT_ADMIN`)
- **Entry point(s):** `routes/canvas.js` (`POST /api/canvas/import/:canvasCourseId/quizzes/:quizId`)
- **Flow:**
  1. Unit admin connects their own Canvas credentials (`POST /api/canvas/connect`) — this is always personal/own-scoped (`req.user.id`), independent of which courses they administer
  2. Unit admin imports a quiz into the department course (`requireCourseAccess({ min: 'instructor' })` — passes at `rank: 3`)
  3. Import proceeds exactly as it would for the course's real instructor (UC-INSTRUCTOR-008's topic pre-check applies identically)
- **Expected outcome:** `200`, quiz questions imported and owned in the DB by `req.qmCourse.userId` (the course's original linker), not by the unit admin who triggered the import — `createdBy`/ownership semantics are unchanged by *who* had sufficient rank to act.
- **Failure modes / what could go wrong:** None found — but worth noting the imported content is attributed to the course owner, not the acting unit admin, so QM's own records don't distinguish "the instructor did this" from "a unit admin did this on their behalf."
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/routes/canvas.js`

---

### UC-UNIT-ADMIN-003: Core is unreachable while resolving department access

- **Category:** Error Recovery
- **Actor:** `UNIT_ADMIN`, attempting to open a Core-linked course while Core is down
- **Preconditions:** Course is Core-linked; `getCourseFromCore` throws (network error/5xx, not a 404)
- **Entry point(s):** `middleware/courseAccess.js`
- **Flow:**
  1. Unit admin requests a course they administer by department, but not by enrollment
  2. `resolveAccessForCourse`'s `UNIT_ADMIN` branch wraps `getCourseFromCore` in `try/catch`: on failure, `if (reqUser.id === course.userId) return LEVELS.instructor;` — for a unit admin who isn't the course's linker, this fallback doesn't apply, so execution **falls through** past the unit-check entirely (no `department`/`units` lookup happens) into the ordinary enrollment-based check
  3. `getCourseEnrollmentsFromCore` is then attempted for the enrollment path; if that *also* fails, its own catch returns `LEVELS.instructor` only if `reqUser.id === course.userId` (still false), otherwise `null`
- **Expected outcome:** `403`/`404` (access denied) for a unit admin who is neither the course's Core-side owner-of-record nor independently enrolled, **even though they may genuinely be authorized over that department** — a Core outage silently downgrades a legitimate unit admin to no access, with no distinct error message calling out *why* (it looks identical to "not authorized at all").
- **Failure modes / what could go wrong:** This is a fail-closed behavior (safe direction for RBAC), but it's also indistinguishable from a genuine authorization failure from the unit admin's point of view — they'd see the same `403` whether Core is down or they truly lack access, with nothing prompting a retry-when-Core-recovers.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/middleware/courseAccess.js`

---

### UC-UNIT-ADMIN-004: Unit admin tries to reach a same-department course that was never linked to Core

- **Category:** Wrong/Malformed Usage
- **Actor:** `UNIT_ADMIN` with `authorizedUnits: ['CPSC']`, target course is a CPSC course in Core but its QM `Course` row has never been `link-core`'d
- **Preconditions:** A QM `Course` row exists (created locally by someone, e.g. via `POST /api/course`) with `coreCourseId: null`
- **Entry point(s):** `middleware/courseAccess.js`
- **Flow:**
  1. Unit admin requests the course by its QM id
  2. `resolveAccessForCourse`'s very first branch fires: `if (!course.coreCourseId) { if (reqUser.id === course.userId) return LEVELS.instructor; return null; }` — this check happens **before** the `UNIT_ADMIN` role check, so the department lookup is never attempted at all
  3. The unit admin is not `course.userId` (they didn't create this local row)
- **Expected outcome:** `access` resolves to `null` → `403`/`404` depending on the route, even though the course genuinely belongs to their department in Core.
- **Failure modes / what could go wrong:** A real access gap for the "new local course not yet linked" window: a unit admin's department authority is meaningless until *someone* links the QM row to Core (`PATCH /:id/link-core`, itself gated at `min: 'instructor'`, which the unit admin also can't reach on this unlinked row) — a deadlock the unit admin cannot resolve alone unless they also happen to hold a direct enrollment on the course.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/middleware/courseAccess.js`
  - `apps/extensions/question-maker/app/backend/src/routes/course.js`

---

### UC-UNIT-ADMIN-005: Unit admin attempts to manage a course outside their authorized department

- **Category:** Malicious/Adversarial
- **Actor:** `UNIT_ADMIN` with `authorizedUnits: ['CPSC']`, targeting a course Core reports as `department: 'MATH'`
- **Preconditions:** Course is Core-linked; attacker has no enrollment on it either
- **Entry point(s):** `middleware/courseAccess.js`, any course/question/assessment/variant route
- **Flow:**
  1. Attacker sends e.g. `DELETE /api/course/:id` for the MATH course, guessed or discovered elsewhere
  2. `getCourseFromCore` returns `department: 'MATH'`; `getAuthorizedUnits` returns `['CPSC']`; `units.includes('MATH')` is `false`
  3. Falls through to the enrollment check; attacker has no active enrollment and is not `course.userId` → `null`
- **Expected outcome:** `403 Forbidden`, no deletion. The department check is re-derived from Core on every request — a unit admin's authority never expands beyond whatever Core currently reports for `authorizedUnits`, and there is no QM-side cache that could go stale in the attacker's favor.
- **Failure modes / what could go wrong:** None found — same structural guarantee as the instructor cross-course case (UC-INSTRUCTOR-009): access is always re-resolved against live Core data, never cached or inferred from a prior successful check on a different course.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/middleware/courseAccess.js`

---

### UC-UNIT-ADMIN-006: A course's `department` is null — the unit check can never match it

- **Category:** Malicious/Adversarial
- **Actor:** `UNIT_ADMIN` with `authorizedUnits: ['CPSC']`, targeting a Core-linked course whose Core row has `department: null`
- **Preconditions:** Course exists in Core with no department assigned (e.g. a newly created or misconfigured Core course)
- **Entry point(s):** `middleware/courseAccess.js`
- **Flow:**
  1. `getCourseFromCore` returns `{ department: null, ... }`
  2. `const department = coreCourse?.department ?? null;` → `null`; the guard `if (department !== null)` is `false`, so the `units.includes(department)` check is **skipped entirely** — a null department is deliberately never treated as a match for any unit, including hypothetically malformed `authorizedUnits` data containing `null`
  3. Falls straight through to the enrollment check
- **Expected outcome:** No unit admin gets `unit`-level access to a null-department course through the department path, ever — only through a genuine Core enrollment. This is correct, defensive behavior: a null department can't be exploited as an accidental wildcard match.
- **Failure modes / what could go wrong:** None found — this is the guard working as documented (`courseAccess.js`'s own comment: "a null department is never a match").
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/middleware/courseAccess.js`

---

### UC-UNIT-ADMIN-007: Listing courses triggers one live Core profile fetch per row

- **Category:** Security
- **Actor:** `UNIT_ADMIN`, or an attacker who has compromised/borrowed a `UNIT_ADMIN` session, requesting `GET /api/course` against a QM instance with many course rows
- **Preconditions:** A large number of QM `Course` rows exist (any department, any owner)
- **Entry point(s):** `services/courseListService.js`, `middleware/courseAccess.js`
- **Flow:**
  1. `listCoursesForUser` loads **every** QM `Course` row (`Course.findAll` with no filter) then loops, calling `resolveAccessForCourse` per row for the non-ADMIN branch
  2. For each Core-linked row, the `UNIT_ADMIN` branch calls `getCourseFromCore` (one Core HTTP call) and, since the QM session never carries `authorizedUnits`, `getAuthorizedUnits` calls `getMyProfileFromCore` (`GET /api/me`, another Core HTTP call) — **per course row**, not once per request
  3. A caller who can trigger this endpoint repeatedly (it's a normal, unauthenticated-rate-limited-only `GET`) drives proportionally many outbound requests to Core for every single call
- **Expected outcome:** The endpoint still returns correctly-scoped results — this is a correctness non-issue, purely a resource-amplification one. No rate limiting on `GET /api/course` is visible in this router (unlike Canvas sync, which has `CANVAS_SYNC_RATE_LIMIT`).
- **Failure modes / what could go wrong:** A UNIT_ADMIN session (legitimate or hijacked) repeatedly calling `GET /api/course` amplifies into `O(courses)` calls to Core per request, with no caching of `authorizedUnits` across rows within the same request, let alone across requests. On an instance with hundreds of courses this is a real amplification vector against Core, not just a QM-local slowdown — flagged as a gap, not a confirmed exploited vulnerability.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/services/courseListService.js`
  - `apps/extensions/question-maker/app/backend/src/middleware/courseAccess.js`
