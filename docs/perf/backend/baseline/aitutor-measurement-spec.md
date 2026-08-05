# apps/extensions/ai-tutor — Perf Measurement Spec

Derived by reading every `server/src/routes/*.js` handler + `services/` + `shared/schemas/` +
`prisma/schema.prisma` (source of truth, not `endpoints.md` alone). Express app; global `requireAuth`
on `/api/*` except `/health`, `POST /api/logout`, `/api/internal/*`; `requireRole(...)` per route.
Own Postgres DB; hierarchy `CourseOffering → Module → Lesson → Activity`. `userId` columns hold Core
CUIDs (identity owned by Core).

**70 method-endpoints → 43 IN-SCOPE (25 read + 18 mutation), 27 SKIP.**

Two structural findings that shape the seed (verified in handlers):
1. `POST /courses/:id/topics` returns **403** on any course with `externalId` set → needs a **native**
   (externalId=null) course. Same course keeps publish/unpublish **local**: on a `coreOfferingId`-linked
   course they write through to Core; on a native course (`coreOfferingId=null`) they stay in-DB.
2. Module/lesson/activity publish/unpublish/patch/delete never fan out.

Ids are autoincrement → the perf seed (`prisma/seed-perf.ts`) emits `.perf-pool/aitutor.json` and the
harness resolves every id from it.

## IN-SCOPE reads (25)
`GET` — /api/me · /api/courses · /api/courses/:id · /:id/feedback · /:id/submissions ·
/:id/student-metrics · /:id/analytics · /:id/modules · /:id/topics · /modules/:id · /modules/:id/lessons ·
/lessons/:id · /lessons/:id/activities · /activities/:id/submissions · /activities/:id/feedback ·
/activities/:id/chat-sessions · /activities/:id/chat-sessions/:chatId/messages · /me/submissions ·
/me/feedback · /prompts · /suggested-prompts · /ai-models · /admin/courses ·
/admin/courses/:id/enrollments · /admin/settings/eduai-api-key · /admin/settings/ai-model-policy.

## IN-SCOPE mutations (18)
| Method + Path | Role | Param source | Body | Destructive |
|---|---|---|---|---|
| PATCH /api/courses/:id | INSTRUCTOR | native course | `{title}` | reuse |
| PATCH /api/courses/:id/publish | INSTRUCTOR | **native** course | — | reuse |
| PATCH /api/courses/:id/unpublish | INSTRUCTOR | **native** course | — | reuse |
| POST /api/courses/:id/modules | INSTRUCTOR | native course | `{title, position}` | create |
| PATCH /api/modules/:id/publish | INSTRUCTOR | pool module (reuse) | — | reuse |
| PATCH /api/modules/:id/unpublish | INSTRUCTOR | pool module (reuse) | — | reuse |
| DELETE /api/modules/:id | INSTRUCTOR | pool module (drop) | — | victim |
| POST /api/modules/:id/lessons | INSTRUCTOR | pool module | `{title, position}` | create |
| PATCH /api/lessons/:id/publish | INSTRUCTOR | pool lesson (reuse) | — | reuse |
| PATCH /api/lessons/:id/unpublish | INSTRUCTOR | pool lesson (reuse) | — | reuse |
| PATCH /api/lessons/:id | INSTRUCTOR | pool lesson (reuse) | `{contentMd}` | reuse |
| DELETE /api/lessons/:id | INSTRUCTOR | pool lesson (drop) | — | victim |
| POST /api/lessons/:id/activities | INSTRUCTOR | pool lesson | `{question, mainTopicId, type, options, answer, hints, enableTeachMode, enableGuideMode}` | create |
| PATCH /api/activities/:id | INSTRUCTOR | pool activity (reuse) | `{title}` | reuse |
| DELETE /api/activities/:id | INSTRUCTOR | pool activity (drop) | — | victim |
| POST /api/courses/:id/topics | INSTRUCTOR | **native** course | `{name}` (unique) | create |
| POST /api/prompts | INSTRUCTOR | — | `{name, systemPrompt, temperature, topP}` | create |
| POST /api/admin/courses/:id/enrollments | ADMIN/INSTRUCTOR | native course | `{userId, role}` | create (fresh userId) |
| DELETE /api/admin/courses/:id/enrollments/:uid | ADMIN/INSTRUCTOR | pool enrollment (drop) | — | victim |
| PATCH /api/admin/courses/:id/enrollments/:uid/role | ADMIN/INSTRUCTOR | pool enrollment (role) | `{role}` | reuse |
| PUT /api/admin/settings/eduai-api-key | ADMIN | — | `{apiKey}` (pure SystemSetting write) | reuse |
| PUT /api/admin/settings/ai-model-policy | ADMIN | — | GET first, PUT same object back | reuse |

(`POST /api/activities/:id/feedback` is DB-only but needs a pre-seeded Submission per activity + one-per-
(user,activity) unique index → optional; not wired.)

## SKIP (27) — reasons
`POST /logout` (session teardown) · `GET /eduai/courses` (Core fanout) · `POST /courses` (deprecated 403) ·
`PATCH /admin/users/:id/role` (deprecated 410) · `POST /courses/import-external`, `/courses/:id/import`,
`/courses/:id/sync-enrollments`, `/admin/courses/:id/sync-enrollments`, `/courses/:id/topics/sync`,
`/courses/:id/topics/remap` (Core sync/import) · `POST /questions/:id/answer`, `/activities/:id/teach|guide|custom`
(LLM) · `POST /ai-models/validate-key` (provider) · `GET /admin/users` (Core fanout) ·
`POST /bug-reports`, `GET /admin/bug-reports`, `PATCH /admin/bug-reports/:id` (all forward to Core — no local
write) · `DELETE /internal/courses/:id` (service key). Publish/unpublish on a Core-linked course also fans out
→ measured only against the native pool course.

## Seed pool (`prisma/seed-perf.ts` → `.perf-pool/aitutor.json`)
1 native course (externalId/coreOfferingId null) + LEAD instructor (`seed_user_instructor_cs`) + 1 topic;
modules ×(POOL drop + 2 reuse); lessons ×(POOL drop + 2 reuse) under a reuse module; activities ×(POOL drop +
2 reuse) under a reuse lesson; enrollments ×(POOL drop + 2 role) with synthetic userIds; 1 AiChatSession (for
chat-session reads). Manifest carries every id. Re-run between perf runs to refill delete victims.
