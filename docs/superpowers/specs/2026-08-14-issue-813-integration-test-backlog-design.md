# Issue #813 — Integration test backlog (enrollments / RBAC)

**Date:** 2026-08-14  
**Branch:** `tests/integration-backlog`  
**Issue:** [#813](https://github.com/EduAI-Lab/EduAI/issues/813)

## Goal

Close integration-test gaps for enrollment soft-delete, instructor enrollment policy gates, AI Tutor remove write-through to Core, and any drifting Core `courses` / `invitations` integration assertions — before pilot.

## Decisions (approved)

| Topic | Choice |
|---|---|
| Scope | Full acceptance criteria in one PR |
| AT remove write-through harness | Route-level AT integration with Core client mocked |
| Soft-delete “hidden in UI list” | Session/browser roster `GET` excludes deactivated student; DB row remains `isActive: false` |
| Approach | Extend existing suites (not new dedicated files per concern) |

## Current baseline

- Core `courses.enrollments.integration.test.ts` covers GET gates, service-key full list (active+inactive), browser roster active-STUDENT page, and instructor-floor DELETE lifecycle.
- Core unit tests cover `instructors.canManageEnrollments` on **POST add only**.
- `courses.enrollments.$enrollmentId.ts` (PATCH/DELETE) currently has **no** `resolvePolicyGate(..., "manageEnrollments")` check — gap vs policy copy (“add/remove students and TAs”) and vs AC “add/update”.
- AI Tutor `admin.test.js` already has `DELETE …/enrollments/:userId on EduAI-linked course` (#812) with mocked `deleteCoreEnrollment` — verify + ensure `TESTS.md` documents it; do not duplicate unless gaps remain.

## Requirements

### R1 — Core DELETE soft-delete + roster hide

Integration: deactivate a STUDENT enrollment via `DELETE /api/courses/:id/enrollments/:enrollmentId` → `204`; Prisma row still exists with `isActive: false`; session OAuth `GET` roster (cursor page) does not include that student and `total` excludes them.

### R2 — Core add/update policy gates

Integration against real DB + `SystemConfig` policy override (`setPolicy`):

- INSTRUCTOR + `instructors.canManageEnrollments=false` → POST add `403`; PATCH role update `403`.
- ADMIN with same flag off → still succeeds (gate resolves to `"always"` for admin).

**Product fix in scope:** wire the same `manageEnrollments` policy gate used on POST into PATCH (and DELETE, per policy description “add/remove”) on `courses.enrollments.$enrollmentId.ts`, with matching unit coverage. Without this, “update policy” has no production behavior to assert.

### R3 — AI Tutor remove write-through

Confirm existing `admin.test.js` #812 cases pass: Core DELETE called before local delete; Core failure leaves local row; missing Core enrollment → 404 without local delete. Update `TESTS.md` if the write-through sentence is incomplete. Add only if a gap is found during verification.

### R4 — Drift fixes

Run `courses.integration.test.ts` and `invitations.integration.test.ts`. Fix assertions/fixtures only when out of sync with current API (`422` / `VALIDATION_ERROR`, invite rollback). No intentional product changes unless a real bug is found (call out separately).

### R5 — TESTS.md

Update inventory rows for every added/changed suite.

## Out of scope

- UI component / Playwright tests for roster
- Cross-service real-HTTP AT↔Core
- Asserting service-key list still returns inactive rows (already covered)
- Confirmation dialogs / sidebar / other Week 8 UI mentioned only as context in the issue title

## Success criteria

All five AC checkboxes on #813 can be marked done; Core enrollment + AT admin integration suites green locally; PR on `tests/integration-backlog`.
