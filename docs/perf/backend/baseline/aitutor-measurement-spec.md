# apps/extensions/ai-tutor — Perf Measurement Spec

Derived by reading every `server/src/routes/*.js` handler + `services/` + `shared/schemas/` +
`prisma/schema.prisma` (source of truth, not `endpoints.md` alone). Express app; global `requireAuth`
on `/api/*` except `/health`, `POST /api/logout`, `/api/internal/*`; `requireRole(...)` per route.
Own Postgres DB; hierarchy `CourseOffering → Module → Lesson → Activity`. `userId` columns hold Core
CUIDs (identity owned by Core).

**87 method-endpoints (13 route modules) → 42 IN-SCOPE (26 read + 16 mutation), 45 SKIP.**
(`/api/health` lives in `app.js`, is unauthenticated, and is not part of the 87.)

## Structural findings (post-#1072)

1. `CourseOffering` is a **pure Core anchor** — `coreOfferingId` is required and unique; the row holds
   **no** title/description/department/dates/publish state and **no** nullable "native" mode. Every
   real field is resolved live from Core (`services/courseResolver.js` + `utils/mappers.js`). There is
   no Core-less/native course; `coreOfferingId=null` is no longer a thing.
2. Course-level metadata and publish state are **Core-owned**:
   - `PATCH /courses/:id/publish|unpublish` write through to Core (`setCoreCoursePublishState`), so they
     fan out — out of the local-DB-only baseline.
   - `POST /courses/:id/topics` returns **403** on any Core-linked course (topics are Core-synced).
   - Enrollment `DELETE` and `role-PATCH` require a matching Core enrollment and write through to Core.
3. Module/lesson/activity publish/unpublish/patch/delete and `POST /api/prompts`,
   `POST /api/admin/courses/:id/enrollments` (local idempotent upsert), and the two admin-settings PUTs
   stay **local** (no fanout).

Ids are autoincrement → the perf seed (`prisma/seed-perf.ts`) emits `.perf-pool/aitutor.json` and the
harness resolves every id from it. Reseeding is idempotent (see "Seed pool" below).

## IN-SCOPE reads (26)

`GET` — /api/me · /api/courses · /api/courses/:id · /:id/feedback · /:id/submissions ·
/:id/student-metrics · /:id/analytics · /:id/modules · /:id/topics · /admin/courses/:id/enrollments ·
/modules/:id · /modules/:id/lessons · /lessons/:id · /lessons/:id/activities ·
/activities/:id/submissions · /activities/:id/feedback · /activities/:id/chat-sessions ·
/activities/:id/chat-sessions/:chatId/messages · /me/submissions · /me/feedback · /prompts ·
/suggested-prompts · /ai-models · /admin/courses · /admin/settings/eduai-api-key ·
/admin/settings/ai-model-policy.

## IN-SCOPE mutations (16)

| Method + Path | Role | Param source | Body | Destructive |
|---|---|---|---|---|
| POST /api/courses/:id/modules | INSTRUCTOR | pool course | `{title, position}` | create |
| PATCH /api/modules/:id/publish | INSTRUCTOR | pool module (reuse) | — | reuse |
| PATCH /api/modules/:id/unpublish | INSTRUCTOR | pool module (reuse) | — | reuse |
| DELETE /api/modules/:id | INSTRUCTOR | pool module (drop) | — | victim |
| POST /api/modules/:id/lessons | INSTRUCTOR | pool module | `{title, position}` | create |
| PATCH /api/lessons/:id/publish | INSTRUCTOR | pool lesson (reuse) | — | reuse |
| PATCH /api/lessons/:id/unpublish | INSTRUCTOR | pool lesson (reuse) | — | reuse |
| PATCH /api/lessons/:id | INSTRUCTOR | pool lesson (reuse) | `{contentMd}` | reuse |
| DELETE /api/lessons/:id | INSTRUCTOR | pool lesson (drop) | — | victim |
| POST /api/lessons/:id/activities | INSTRUCTOR | pool lesson + `topicId` | `{question, mainTopicId, type, options, answer, hints, enableTeachMode, enableGuideMode}` | create |
| PATCH /api/activities/:id | INSTRUCTOR | pool activity (reuse) | `{title}` | reuse |
| DELETE /api/activities/:id | INSTRUCTOR | pool activity (drop) | — | victim |
| POST /api/prompts | INSTRUCTOR | — | `{name, systemPrompt, temperature, topP}` | create |
| POST /api/admin/courses/:id/enrollments | ADMIN/INSTRUCTOR | pool course + **Core perf actor CUID** | `{userId, role}` (idempotent upsert) | reuse |
| PUT /api/admin/settings/eduai-api-key | ADMIN | — | `{apiKey}` (pure SystemSetting write) | reuse |
| PUT /api/admin/settings/ai-model-policy | ADMIN | — | GET first, PUT same object back | reuse |

(`POST /api/activities/:id/feedback` is DB-only but needs a pre-seeded Submission per activity + the
one-per-(user,activity) unique index → optional; not wired.)

## SKIP (45) — reasons

- **Session teardown:** `POST /logout`.
- **Deprecated:** `POST /courses` (403 — local create removed), `PATCH /admin/users/:userId/role` (410).
- **Core fanout (reads):** `GET /eduai/courses`, `GET /ai-status`, `GET /admin/users`.
- **Core sync/import:** `POST /courses/import-external`, `POST /courses/:courseId/sync-enrollments`,
  `POST /courses/:courseId/import`, `POST /courses/:courseId/topics/sync`,
  `POST /courses/:courseId/topics/remap`, `POST /admin/courses/:courseId/sync-enrollments`.
- **Core write-through (mutations):** `PATCH /courses/:courseId/publish`, `PATCH /courses/:courseId/unpublish`,
  `DELETE /admin/courses/:courseId/enrollments/:userId`, `PATCH /admin/courses/:courseId/enrollments/:userId/role`.
- **Core-owned topic creation:** `POST /courses/:courseId/topics` — 403 on a Core-linked course (no native mode).
- **LLM:** `POST /activities/:activityId/teach`, `.../guide`, `.../custom`.
- **Provider:** `POST /ai-models/validate-key`.
- **Student-only submission write gated on Core publish state:** `POST /questions/:id/answer`.
- **Forward to Core (no local write):** `POST /bug-reports`, `GET /admin/bug-reports`,
  `GET /admin/bug-reports/:bugReportId`, `PATCH /admin/bug-reports/:bugReportId`.
- **Service key:** `DELETE /internal/courses/:coreOfferingId`.
- **Local, not registered in the harness (out of current baseline scope):**
  `GET /courses/facets`, `GET /me/dashboard-stats`, `GET /lessons/:lessonId/context`,
  `GET /modules/:moduleId/context`, `GET /admin/ai-traces`, `GET /activities/importable`,
  `PATCH /modules/:moduleId`, `PATCH /modules/:moduleId/position`, `PUT /courses/:courseId/modules/order`,
  `PATCH /lessons/:lessonId/position`, `PUT /modules/:moduleId/lessons/order`,
  `POST /activities/:activityId/duplicate`, `POST /lessons/:lessonId/activities/import`,
  `PATCH /activities/:activityId/submissions/:submissionId`, `PATCH /activities/:activityId/position`,
  `PUT /lessons/:lessonId/activities/order`, `POST /activities/:activityId/feedback`,
  `DELETE /admin/settings/eduai-api-key`.

The obsolete `PATCH /courses/:courseId` (local title edit) is **not a route anymore** (post-#1072) and
is therefore absent from both the route census and the SKIP list.

## Seed pool (`prisma/seed-perf.ts` → `.perf-pool/aitutor.json`)

The pool is a **pure Core anchor**: one `CourseOffering` keyed by `core.json.sharedCourseId` (read from
`.perf-pool/core.json`, which the Core perf seed writes first) + a LEAD instructor (`seed_user_instructor_cs`)
+ one topic; modules ×(POOL drop + 2 reuse); lessons ×(POOL drop + 2 reuse) under a reuse module;
activities ×(POOL drop + 2 reuse) under a reuse lesson; one `CourseEnrollment` for the seed STUDENT
(`seed_user_student_01` → student1) so the chat-session reads don't 403; one `AiChatSession` (reusing
`core.json.readChatId`).

### Manifest contract

- `core.json` (Core seed): `sharedCourseId` (required), `readChatId` (optional), `actor.id` (real Core
  CUID — the POST-enrollment enrollee), `instructorUserId`, plus the Core pools.
- `aitutor.json` (AI Tutor seed): `courseId`, `topicId`, `poolModulesReuse`, `poolModulesDrop`,
  `poolLessonsReuse`, `poolLessonsDrop`, `poolActivitiesReuse`, `poolActivitiesDrop`,
  `seededModuleId`, `seededLessonId`, `seededActivityId`, `seededChatId`, `instructorUserId`,
  `studentUserId`. No `native*` fields remain.

### Enrollment fixture semantics

`CourseEnrollment.userId` holds a Core CUID (no local FK). The only local fixture is the seed STUDENT.
`POST /api/admin/courses/:id/enrollments` is a local idempotent upsert (no Core call), so it reuses the
Core perf **actor** CUID — a real identity, never an invented `perf_user_*` string. Enrollment DELETE and
role-PATCH are SKIPped because they require a matching Core enrollment and write through to Core.

### Reseeding (idempotent)

The Core seed mints a **new** Core course id on every `db:seed:perf` run, so a previous anchor can never
be found by `coreOfferingId` alone. Cleanup therefore (1) drops any offering already anchored to the new
`sharedCourseId`, and (2) re-reads the previous `aitutor.json` and drops the `CourseOffering` it recorded —
after validating the manifest shape (`perf-pool-manifest.js#previousCourseId`: a positive-integer
`courseId`/legacy `nativeCourseId` plus a recognizable pool field). A missing, unreadable, or malformed
manifest never deletes a real course. Deletion order: activities first (their `mainTopicId → Topic` is
`Restrict`), then the offering (cascading modules/lessons/topics/enrollments/instructors).
