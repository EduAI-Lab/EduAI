# AI Tutor RBAC Endpoint Map

Every `/api` route, grouped by area, with the middleware-level auth gate that guards it. Regenerated directly from `server/src/routes/*.js` (a `grep -n "router\.(get|post|patch|put|delete)"` over the route files, cross-checked against each handler's body) — treat this over any older RBAC doc for this app.

**Legend:** **ADM** = `ADMIN`, **UA** = `UNIT_ADMIN`, **INS** = `INSTRUCTOR`, **TA** = `TA` (a `STUDENT`-platform account with a `TA` course enrollment — see below), **STU** = `STUDENT`, **Any** = any authenticated user regardless of role, **Course-auth** = the handler additionally checks the caller is a live Core instructor/TA/enrolled member of the specific `:courseId`/`:moduleId`/`:lessonId`/`:activityId` in the URL (a role match alone is not enough).

Five platform roles exist: `STUDENT`, `TA`, `INSTRUCTOR`, `UNIT_ADMIN`, `ADMIN`. `TA` is not a role Core assigns to the account directly — `GET /api/me` promotes a `STUDENT` to the effective role `TA` when the enrollment sync finds them teaching at least one course as a TA (`server/src/routes/authentication.js`). A user can therefore be a global-effective `TA` while still being a plain `STUDENT` on a *different* course; several endpoints below (answer submission, the three AI-chat endpoints) check the caller's live enrollment role on the *specific* course in the URL, not the global effective role, for exactly this reason.

`requireRole(...)` is the middleware in `server/src/middleware/auth.js`; "Course-auth" checks are performed inline in the route handler (commonly via `isCourseAdmin`, `authorizeLiveCoursePrincipal`, or `authorizeLiveStudentEnrollment`) rather than via a reusable middleware.

## Admin isolation (applies on top of everything below)

`server/src/app.js` runs a role-isolation gate after `requireAuth`, before any route module. An `ADM` caller may only reach: `/api/me`, `/api/admin/*`, `/api/ai-status`, `/api/ai-models*`, `/api/bug-reports`, `/api/prompts*`, and the shared course/module/lesson/activity/topic tree (`/api/courses*`, `/api/modules/*`, `/api/lessons/*`, `/api/activities/*`, `/api/topics/*`) — everything else 403s. `UA` is additionally blocked from `/api/admin/settings/*` and `/api/admin/users*`.

## Identity

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/me` | Any | Applies the `STUDENT`→`TA` promotion described above. |
| POST | `/api/logout` | Any (no `requireAuth`) | Proxies to Core sign-out; a no-op on an already-invalid session. |

## Courses

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/courses` | Any, role-scoped internally | `ADM` sees the full Core catalog; `UA` sees their `authorizedUnits`; `INS` sees courses they instruct; `STU`/`TA` see published courses they're enrolled in. |
| GET | `/api/courses/facets` | Any | Scoped to the caller's own visible set. |
| GET | `/api/courses/:courseId` | Course member or `ADM`/authorized `UA` | Returns `viewerRole` for the caller on this course. |
| POST | `/api/courses` | INS/UA/ADM (still 403s unconditionally) | Deprecated stub — course creation lives in Core. |
| PATCH | `/api/courses/:courseId/publish` \| `/unpublish` | INS/UA/ADM + Course-auth | |
| POST | `/api/courses/:courseId/import` | INS/UA/ADM + Course-auth (both source and destination) | |
| GET | `/api/eduai/courses` | INS/UA/ADM | List of Core courses available to import. |
| POST | `/api/courses/import-external` | INS/UA/ADM | |
| POST | `/api/courses/:courseId/sync-enrollments` | INS/UA/ADM + Course-auth | |
| GET | `/api/courses/:courseId/bank-questions` | INS/UA/ADM + Course-auth | |
| GET | `/api/courses/:courseId/feedback` \| `/submissions` \| `/student-metrics` \| `/analytics` | Course-authorized staff (INS/TA/UA/ADM on this course) | No bare `requireRole` — the handler checks live course staff authorization directly. |
| GET | `/api/me/dashboard-stats` | Any | Shape varies by caller role. |

## Modules, Lessons, Activities

Every write endpoint (create/update/publish/unpublish/delete/reorder/position) requires `requireRole(["INSTRUCTOR", "UNIT_ADMIN", "ADMIN"])` **plus** the handler's own course-authorization check (`isCourseAdmin` / `authorizeLiveCoursePrincipal`) — the role check alone does not prove the caller may touch *this* course. `TA` has read-only access via the shared instructor shell (UI-side gating in `app/lib/rbac/permissions.ts`; the underlying GETs check course membership, not a write role).

| Prefix | Read auth | Write auth |
| --- | --- | --- |
| `/api/courses/:courseId/modules`, `/api/modules/:moduleId*` | Course member | INS/UA/ADM + Course-auth |
| `/api/modules/:moduleId/lessons`, `/api/lessons/:lessonId*` | Course member | INS/UA/ADM + Course-auth |
| `/api/lessons/:lessonId/activities`, `/api/activities/:activityId` (CRUD/position/duplicate/import) | Course member | INS/UA/ADM + Course-auth |
| GET `/api/activities/importable` | INS/UA/ADM (this is itself an authoring surface, not a read for learners) | — |
| GET `/api/activities/:activityId/submissions` \| `/feedback` | Course-authorized staff | — |
| PATCH `/api/activities/:activityId/submissions/:submissionId` (grade override) | Course-authorized staff | |
| POST `/api/questions/:id/answer` | `STU` **and** live course-enrollment role `STUDENT` on this course | A course `TA` is rejected even though `TA` has read access — see the effective-role note above. |
| POST `/api/activities/:activityId/teach` \| `/guide` \| `/custom` | Same STUDENT-in-this-course gate as answer submission | The activity's course/module/lesson must all be published; the relevant `enable*Mode` flag must be `true`. |
| POST `/api/activities/:activityId/feedback` | `STU` | One row per (user, activity). |
| GET `/api/activities/:activityId/chat-sessions*` | Any (server scopes to the caller's own rows) | |
| GET `/api/me/submissions` \| `/api/me/feedback` | Any | Caller's own rows only. |

## Topics

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/courses/:courseId/topics` | Course member | Auto-syncs from Core on read for imported courses. |
| POST | `/api/courses/:courseId/topics` | INS/UA/ADM + Course-auth | Blocked for imported courses (managed via sync instead). |
| POST | `/api/courses/:courseId/topics/sync` \| `/remap` | INS/UA/ADM + Course-auth | No current UI caller; kept for API compatibility. |

## Prompts / Suggested Prompts

| Method | Path | Auth |
| --- | --- | --- |
| GET/POST | `/api/prompts` | INS/UA/ADM (`ADMIN` is included on purpose — it used to 403 here, since a bare `"INSTRUCTOR"` check excluded `ADMIN`/`UNIT_ADMIN`) |
| GET | `/api/suggested-prompts` | Any |

## AI models / AI status

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/ai-models` | Any | `INS`/`UA`/`ADM` see every model; everyone else (`STU`, `TA`, or an unrecognized role) is filtered to the admin policy's allow-list — an allow-list, not a `=== "STUDENT"` deny-list. |
| POST | `/api/ai-models/validate-key` | Any | Per-user rate-limited. |
| GET | `/api/ai-status` | Any (exempt from admin isolation) | Proxies Core's own probe. |

## Admin

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/admin/users` | ADM | |
| PATCH | `/api/admin/users/:userId/role` | ADM | Not implemented locally — role changes are managed in Core. |
| GET | `/api/admin/courses` | ADM | |
| GET/POST/DELETE | `/api/admin/courses/:courseId/enrollments*` | ADM/UA/INS + Course-auth | Enrollment management is *not* `ADMIN`-only — course-authorized instructors and unit admins can manage their own course's roster. |
| PATCH | `/api/admin/courses/:courseId/enrollments/:userId/role` | ADM/UA/INS + Course-auth | Used for TA assignment. |
| POST | `/api/admin/courses/:courseId/sync-enrollments` | ADM | |
| GET/PUT/DELETE | `/api/admin/settings/eduai-api-key` | ADM | |
| GET/PUT | `/api/admin/settings/ai-model-policy` | ADM | |
| GET | `/api/admin/ai-traces` | ADM/UA | |
| GET/PATCH | `/api/admin/bug-reports*` | ADM | |

## Bug reports

| Method | Path | Auth |
| --- | --- | --- |
| POST | `/api/bug-reports` | Any authenticated user |
| GET/PATCH | `/api/admin/bug-reports*` | ADM (see Admin table above) |

## Internal (service-to-service)

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| DELETE | `/api/internal/courses/:coreOfferingId` | `requireServiceKey` (`Authorization: Bearer <EDUAI_API_KEY>`), not `requireAuth` | Not reachable by any browser client; exempt from the admin-isolation gate too. Core calls this to cascade a course deletion into AI Tutor's local mirror. |

See [`api-reference.md`](api-reference.md) for full request/response shapes, and [`ARCHITECTURE.md`](ARCHITECTURE.md#authentication-flow) for how `req.user` is populated in the first place. The wider platform RBAC matrix (spanning Core, Question Maker, and this app) lives at `docs/implementations/rbac-matrix.md` at the monorepo root, outside this app's own `docs/`.
