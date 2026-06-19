# Project Memory

Non-obvious implementation facts for AI agents working on this codebase.

---

## AI Tutor — TA Role Management (#569)

`PATCH /admin/courses/:courseId/enrollments/:userId/role` in `admin.js` has two code paths:

- **EduAI-linked course** (`externalId` set + `externalSource === 'EDUAI'`): calls Core's `PATCH /api/courses/:externalId/enrollments/:enrollmentId` via `patchCoreEnrollmentRole` **before** writing locally. Uses the acting user's **session cookie** (not the service key) — Core's enrollment-role endpoint requires user auth. If Core rejects the call, the local DB is NOT updated and the error status is forwarded to the client.
- **Native course** (no `externalId`): writes directly to the local `CourseEnrollment` table as before.

`patchCoreEnrollmentRole` in `eduaiClient.js` will throw 401 if the cookie is missing or empty — do not call it with the service key.

## AI Tutor — enrollmentSync band-aid removed (#569, was #562)

PR #562 added a `local.role !== 'TA'` skip in `syncCourseEnrollments` to prevent the sync from overwriting locally-promoted TAs back to STUDENT. This was a band-aid that also blocked Core-initiated demotions from propagating.

**That skip has been removed.** The correct fix (PR #569) is that `PATCH …/role` now writes to Core first, so Core is always authoritative. The sync's `toUpdate` filter now correctly propagates TA→STUDENT demotions when Core reports the user as STUDENT.

If you see unexpected TA role resets during sync, do NOT re-add the `local.role !== 'TA'` skip — investigate whether the admin endpoint is correctly calling Core instead.

## AI Tutor — enrollmentSync only mirrors STUDENT rows (#578)

`syncCourseEnrollments` filters `activeEnrollments` to `role === 'STUDENT'` only. TA and INSTRUCTOR enrollments are intentionally not created or deleted by the sync. Local TA rows survive sync passes.
