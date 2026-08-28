# HTTP API Surface — Performance Baseline Inventory

Generated from static route analysis of three apps. A GET and a POST on the same
path are listed as separate method-endpoints.

## apps/core (React Router resource routes)

URL→module map: `apps/core/app/routes.ts`. Modules: `apps/core/app/routes/api/*.ts`.
`loader` = GET; `action` = non-GET (method branched via `request.method`).
Auth tiers: **Public**, **Session** (Better Auth `getSession`), **Session/Service-key**
(session or `Bearer` service key), **Admin** (`requireAdmin`).

| Method | Path | Auth tier | Handler (file:line) |
|--------|------|-----------|---------------------|
| GET | /api/health | Public | apps/core/app/routes/api/health.ts:1 |
| GET | /api/auth/* | Public (Better Auth) | apps/core/app/routes/api/auth.$.ts:7 |
| POST | /api/auth/* | Public (Better Auth) | apps/core/app/routes/api/auth.$.ts:11 |
| GET | /api/courses | Session | apps/core/app/routes/api/courses.$.ts:7 |
| POST | /api/courses | Session | apps/core/app/routes/api/courses.$.ts:11 |
| GET | /api/disciplines | Session (delegated) | apps/core/app/routes/api/disciplines.ts:5 |
| GET | /api/canvas/* | Session | apps/core/app/routes/api/canvas.$.ts:28 |
| POST | /api/canvas/* | Session | apps/core/app/routes/api/canvas.$.ts:32 |
| DELETE | /api/canvas/* | Session | apps/core/app/routes/api/canvas.$.ts:32 |
| POST | /api/chat | Session/Service-key | apps/core/app/routes/api/chat.ts:369 |
| POST | /api/assistive-events | Session | apps/core/app/routes/api/assistive-events.ts:19 |
| GET | /api/chats | Session | apps/core/app/routes/api/chats.ts:13 |
| GET | /api/chats/:chatId | Session | apps/core/app/routes/api/chats.$chatId.ts:6 |
| DELETE | /api/chats/:chatId | Session | apps/core/app/routes/api/chats.$chatId.ts:79 |
| GET | /api/chats/:chatId/messages | Session | apps/core/app/routes/api/chats.$chatId.messages.ts:11 |
| GET | /api/courses/:courseId/materials | Session | apps/core/app/routes/api/courses.materials.$.ts:504 |
| POST | /api/courses/:courseId/materials | Session | apps/core/app/routes/api/courses.materials.$.ts:99 |
| GET | /api/courses/:courseId/materials/:materialId | Session | apps/core/app/routes/api/courses.materials.$.ts:504 |
| PATCH | /api/courses/:courseId/materials/:materialId | Session | apps/core/app/routes/api/courses.materials.$.ts:99 |
| PUT | /api/courses/:courseId/materials/:materialId | Session | apps/core/app/routes/api/courses.materials.$.ts:99 |
| DELETE | /api/courses/:courseId/materials/:materialId | Session | apps/core/app/routes/api/courses.materials.$.ts:99 |
| GET | /api/courses/:courseId/canvas-materials | Session | apps/core/app/routes/api/courses.canvas-materials.$.ts:57 |
| POST | /api/courses/:courseId/canvas-materials | Session | apps/core/app/routes/api/courses.canvas-materials.$.ts:80 |
| POST | /api/courses/:courseId/canvas-materials/exclusions | Session | apps/core/app/routes/api/courses.canvas-materials.exclusions.$.ts:52 |
| POST | /api/courses/:courseId/re-embed | Session | apps/core/app/routes/api/courses.re-embed.$.ts:13 |
| GET | /api/courses/:courseId/re-embed/:jobId | Session | apps/core/app/routes/api/courses.re-embed.$jobId.ts:10 |
| GET | /api/courses/:courseId/embedding-settings | Session | apps/core/app/routes/api/courses.embedding-settings.$.ts:27 |
| PATCH | /api/courses/:courseId/embedding-settings | Session | apps/core/app/routes/api/courses.embedding-settings.$.ts:71 |
| GET | /api/courses/:courseId/topics | Session/Service-key | apps/core/app/routes/api/courses.topics.$.ts:71 |
| POST | /api/courses/:courseId/topics | Session/Service-key | apps/core/app/routes/api/courses.topics.$.ts:140 |
| GET | /api/courses/:courseId/topics/:topicId | Session/Service-key | apps/core/app/routes/api/courses.topics.$.ts:71 |
| PATCH | /api/courses/:courseId/topics/:topicId | Session/Service-key | apps/core/app/routes/api/courses.topics.$.ts:140 |
| DELETE | /api/courses/:courseId/topics/:topicId | Session/Service-key | apps/core/app/routes/api/courses.topics.$.ts:140 |
| GET | /api/courses/:courseId/chats | Session | apps/core/app/routes/api/courses.chats.$.ts:24 |
| GET | /api/units/:department/chats | Session | apps/core/app/routes/api/units.chats.$.ts:20 |
| GET | /api/courses/:courseId/tas | Session | apps/core/app/routes/api/courses.tas.$.ts:12 |
| POST | /api/courses/:courseId/tas | Session | apps/core/app/routes/api/courses.tas.$.ts:73 |
| DELETE | /api/courses/:courseId/tas | Session | apps/core/app/routes/api/courses.tas.$.ts:73 |
| PATCH | /api/courses/:id/publish | Session (delegated) | apps/core/app/routes/api/courses.id.publish.ts:4 |
| PATCH | /api/courses/:id/unpublish | Session (delegated) | apps/core/app/routes/api/courses.id.unpublish.ts:4 |
| GET | /api/courses/:id | Session/Service-key | apps/core/app/routes/api/courses.id.ts:14 |
| PATCH | /api/courses/:id | Session/Service-key | apps/core/app/routes/api/courses.id.ts:91 |
| DELETE | /api/courses/:id | Session/Service-key | apps/core/app/routes/api/courses.id.ts:91 |
| GET | /api/courses/:id/enrollments | Session/Service-key | apps/core/app/routes/api/courses.enrollments.ts:33 |
| POST | /api/courses/:id/enrollments | Session/Service-key | apps/core/app/routes/api/courses.enrollments.ts:113 |
| PATCH | /api/courses/:id/enrollments/:enrollmentId | Session | apps/core/app/routes/api/courses.enrollments.$enrollmentId.ts:34 |
| GET | /api/courses/:id/rag-settings | Session | apps/core/app/routes/api/courses.id.rag-settings.ts:22 |
| PATCH | /api/courses/:id/rag-settings | Session | apps/core/app/routes/api/courses.id.rag-settings.ts:56 |
| GET | /api/questions | Session/Service-key | apps/core/app/routes/api/questions.ts:24 |
| POST | /api/questions | Session | apps/core/app/routes/api/questions.ts:101 |
| GET | /api/questions/:id | Session/Service-key | apps/core/app/routes/api/questions.$id.ts:28 |
| PATCH | /api/questions/:id | Session/Service-key | apps/core/app/routes/api/questions.$id.ts:65 |
| GET | /api/ai-providers/* | Session (Admin) | apps/core/app/routes/api/ai-providers.$.ts:3 |
| POST | /api/ai-providers/* | Session (Admin) | apps/core/app/routes/api/ai-providers.$.ts:8 |
| PATCH | /api/ai-providers/* | Session (Admin) | apps/core/app/routes/api/ai-providers.$.ts:8 |
| DELETE | /api/ai-providers/* | Session (Admin) | apps/core/app/routes/api/ai-providers.$.ts:8 |
| GET | /api/ai-models/* | Session/Service-key (Admin) | apps/core/app/routes/api/ai-models.$.ts:3 |
| POST | /api/ai-models/* | Session/Service-key (Admin) | apps/core/app/routes/api/ai-models.$.ts:8 |
| PATCH | /api/ai-models/* | Session/Service-key (Admin) | apps/core/app/routes/api/ai-models.$.ts:8 |
| DELETE | /api/ai-models/* | Session/Service-key (Admin) | apps/core/app/routes/api/ai-models.$.ts:8 |
| GET | /api/me | Session | apps/core/app/routes/api/me.ts:33 |
| PATCH | /api/me | Session | apps/core/app/routes/api/me.ts:51 |
| GET | /api/preferences | Session | apps/core/app/routes/api/preferences.ts:38 |
| POST | /api/preferences | Session | apps/core/app/routes/api/preferences.ts:62 |
| PATCH | /api/preferences | Session | apps/core/app/routes/api/preferences.ts:62 |
| GET | /api/users/* | Session (Admin) | apps/core/app/routes/api/users.$.ts:3 |
| POST | /api/users/* | Session (Admin) | apps/core/app/routes/api/users.$.ts:8 |
| PATCH | /api/users/* | Session (Admin) | apps/core/app/routes/api/users.$.ts:8 |
| DELETE | /api/users/* | Session (Admin) | apps/core/app/routes/api/users.$.ts:8 |
| GET | /api/invitations | Session (inviter) | apps/core/app/routes/api/invitations.ts:21 |
| POST | /api/invitations | Session (inviter) | apps/core/app/routes/api/invitations.ts:38 |
| POST | /api/invitations/:id | Session (inviter) | apps/core/app/routes/api/invitations.$id.ts:22 |
| DELETE | /api/invitations/:id | Session (inviter) | apps/core/app/routes/api/invitations.$id.ts:22 |
| GET | /api/ollama-models | Session | apps/core/app/routes/api/ollama-models.ts:4 |
| GET | /api/vllm-models | Session | apps/core/app/routes/api/vllm-models.ts:32 |
| POST | /api/sessions/validate | Session | apps/core/app/routes/api/sessions.validate.ts:9 |
| GET | /api/policies | Session/Service-key (Admin) | apps/core/app/routes/api/policies.ts:25 |
| PATCH | /api/policies | Admin | apps/core/app/routes/api/policies.ts:59 |
| PUT | /api/policies | Admin | apps/core/app/routes/api/policies.ts:59 |
| GET | /api/bug-reports | Session/Service-key | apps/core/app/routes/api/bug-reports.ts:11 |
| POST | /api/bug-reports | Session/Service-key | apps/core/app/routes/api/bug-reports.ts:36 |
| GET | /api/admin/bug-reports | Admin | apps/core/app/routes/api/admin.bug-reports.ts:57 |
| PATCH | /api/admin/bug-reports/:id | Admin | apps/core/app/routes/api/admin.bug-reports.ts:89 |
| GET | /api/admin/cron-jobs | Admin | apps/core/app/routes/api/admin.cron-jobs.ts:28 |
| POST | /api/admin/cron-jobs | Admin | apps/core/app/routes/api/admin.cron-jobs.ts:46 |
| GET | /api/dashboard/stats | Session | apps/core/app/routes/api/dashboard.stats.ts:13 |
| POST | /api/e2e/promote | Public (test-only, NODE_ENV+secret gated) | apps/core/app/routes/api/e2e.promote.ts:16 |

**apps/core count: 87 method-endpoints (44 route modules).**

## apps/extensions/ai-tutor (Express)

Routers mounted under `/api` in `apps/extensions/ai-tutor/server/src/app.js:104-115`.
Global `requireAuth` gate on `/api/*` except `GET /api/health`, `POST /api/logout`,
and `/api/internal/*`. Tiers: **Public**, **Authenticated** (`requireAuth`),
**Authenticated + role** (`requireRole(...)`), **Service key** (`requireServiceKey`).

| Method | Path | Auth tier | Handler (file:line) |
|--------|------|-----------|---------------------|
| GET | /api/me | Authenticated | apps/extensions/ai-tutor/server/src/routes/authentication.js:19 |
| POST | /api/logout | Public | apps/extensions/ai-tutor/server/src/routes/authentication.js:57 |
| GET | /api/eduai/courses | Authenticated + role(INSTRUCTOR,UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/courses.js:160 |
| GET | /api/courses | Authenticated | apps/extensions/ai-tutor/server/src/routes/courses.js:223 |
| GET | /api/courses/facets | Authenticated | apps/extensions/ai-tutor/server/src/routes/courses.js:413 |
| POST | /api/courses/import-external | Authenticated + role(INSTRUCTOR,UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/courses.js:496 |
| POST | /api/courses/:courseId/sync-enrollments | Authenticated + role(INSTRUCTOR,UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/courses.js:549 |
| GET | /api/courses/:courseId | Authenticated | apps/extensions/ai-tutor/server/src/routes/courses.js:596 |
| POST | /api/courses | Authenticated + role(INSTRUCTOR,UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/courses.js:678 |
| POST | /api/courses/:courseId/import | Authenticated + role(INSTRUCTOR,UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/courses.js:698 |
| PATCH | /api/courses/:courseId/publish | Authenticated + role(INSTRUCTOR,UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/courses.js:869 |
| PATCH | /api/courses/:courseId/unpublish | Authenticated + role(INSTRUCTOR,UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/courses.js:924 |
| GET | /api/courses/:courseId/feedback | Authenticated | apps/extensions/ai-tutor/server/src/routes/courses.js:995 |
| GET | /api/courses/:courseId/submissions | Authenticated | apps/extensions/ai-tutor/server/src/routes/courses.js:1058 |
| GET | /api/courses/:courseId/student-metrics | Authenticated | apps/extensions/ai-tutor/server/src/routes/courses.js:1170 |
| GET | /api/courses/:courseId/analytics | Authenticated | apps/extensions/ai-tutor/server/src/routes/courses.js:1225 |
| GET | /api/me/dashboard-stats | Authenticated | apps/extensions/ai-tutor/server/src/routes/courses.js:1276 |
| GET | /api/courses/:courseId/modules | Authenticated | apps/extensions/ai-tutor/server/src/routes/modules.js:50 |
| POST | /api/courses/:courseId/modules | Authenticated + role(INSTRUCTOR,UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/modules.js:120 |
| GET | /api/modules/:moduleId | Authenticated | apps/extensions/ai-tutor/server/src/routes/modules.js:176 |
| PATCH | /api/modules/:moduleId/publish | Authenticated + role(INSTRUCTOR,UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/modules.js:224 |
| PATCH | /api/modules/:moduleId/unpublish | Authenticated + role(INSTRUCTOR,UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/modules.js:277 |
| DELETE | /api/modules/:moduleId | Authenticated + role(INSTRUCTOR,UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/modules.js:333 |
| PATCH | /api/modules/:moduleId | Authenticated + role(INSTRUCTOR,UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/modules.js:373 |
| GET | /api/modules/:moduleId/context | Authenticated | apps/extensions/ai-tutor/server/src/routes/modules.js:446 |
| PATCH | /api/modules/:moduleId/position | Authenticated + role(INSTRUCTOR,UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/modules.js:527 |
| PUT | /api/courses/:courseId/modules/order | Authenticated + role(INSTRUCTOR,UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/modules.js:576 |
| GET | /api/modules/:moduleId/lessons | Authenticated | apps/extensions/ai-tutor/server/src/routes/lessons.js:18 |
| POST | /api/modules/:moduleId/lessons | Authenticated + role(INSTRUCTOR,UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/lessons.js:103 |
| GET | /api/lessons/:lessonId | Authenticated | apps/extensions/ai-tutor/server/src/routes/lessons.js:159 |
| GET | /api/lessons/:lessonId/context | Authenticated | apps/extensions/ai-tutor/server/src/routes/lessons.js:231 |
| PATCH | /api/lessons/:lessonId/position | Authenticated + role(INSTRUCTOR,UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/lessons.js:332 |
| PATCH | /api/lessons/:lessonId/publish | Authenticated + role(INSTRUCTOR,UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/lessons.js:384 |
| PATCH | /api/lessons/:lessonId/unpublish | Authenticated + role(INSTRUCTOR,UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/lessons.js:448 |
| DELETE | /api/lessons/:lessonId | Authenticated + role(INSTRUCTOR,UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/lessons.js:496 |
| PATCH | /api/lessons/:lessonId | Authenticated + role(INSTRUCTOR,UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/lessons.js:541 |
| PUT | /api/modules/:moduleId/lessons/order | Authenticated + role(INSTRUCTOR,UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/lessons.js:608 |
| GET | /api/lessons/:lessonId/activities | Authenticated | apps/extensions/ai-tutor/server/src/routes/activities.js:385 |
| POST | /api/lessons/:lessonId/activities | Authenticated + role(INSTRUCTOR,UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/activities.js:493 |
| PATCH | /api/activities/:activityId | Authenticated + role(INSTRUCTOR,UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/activities.js:638 |
| DELETE | /api/activities/:activityId | Authenticated + role(INSTRUCTOR,UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/activities.js:911 |
| POST | /api/activities/:activityId/duplicate | Authenticated + role(INSTRUCTOR,UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/activities.js:976 |
| POST | /api/lessons/:lessonId/activities/import | Authenticated + role(INSTRUCTOR,UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/activities.js:1040 |
| GET | /api/activities/importable | Authenticated + role(INSTRUCTOR,UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/activities.js:1125 |
| POST | /api/questions/:id/answer | Authenticated | apps/extensions/ai-tutor/server/src/routes/activities.js:1251 |
| POST | /api/activities/:activityId/teach | Authenticated | apps/extensions/ai-tutor/server/src/routes/activities.js:1357 |
| POST | /api/activities/:activityId/guide | Authenticated | apps/extensions/ai-tutor/server/src/routes/activities.js:1436 |
| POST | /api/activities/:activityId/custom | Authenticated | apps/extensions/ai-tutor/server/src/routes/activities.js:1514 |
| GET | /api/activities/:activityId/submissions | Authenticated | apps/extensions/ai-tutor/server/src/routes/activities.js:1596 |
| PATCH | /api/activities/:activityId/submissions/:submissionId | Authenticated | apps/extensions/ai-tutor/server/src/routes/activities.js:1669 |
| GET | /api/activities/:activityId/feedback | Authenticated | apps/extensions/ai-tutor/server/src/routes/activities.js:1750 |
| POST | /api/activities/:activityId/feedback | Authenticated | apps/extensions/ai-tutor/server/src/routes/activities.js:1817 |
| GET | /api/me/submissions | Authenticated | apps/extensions/ai-tutor/server/src/routes/activities.js:1919 |
| GET | /api/me/feedback | Authenticated | apps/extensions/ai-tutor/server/src/routes/activities.js:1939 |
| GET | /api/activities/:activityId/chat-sessions | Authenticated | apps/extensions/ai-tutor/server/src/routes/activities.js:1960 |
| GET | /api/activities/:activityId/chat-sessions/:chatId/messages | Authenticated | apps/extensions/ai-tutor/server/src/routes/activities.js:2003 |
| PATCH | /api/activities/:activityId/position | Authenticated + role(INSTRUCTOR,UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/activities.js:2035 |
| PUT | /api/lessons/:lessonId/activities/order | Authenticated + role(INSTRUCTOR,UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/activities.js:2098 |
| GET | /api/prompts | Authenticated + role(INSTRUCTOR) | apps/extensions/ai-tutor/server/src/routes/prompts.js:42 |
| POST | /api/prompts | Authenticated + role(INSTRUCTOR) | apps/extensions/ai-tutor/server/src/routes/prompts.js:53 |
| GET | /api/suggested-prompts | Authenticated | apps/extensions/ai-tutor/server/src/routes/suggested-prompts.js:10 |
| GET | /api/courses/:courseId/topics | Authenticated | apps/extensions/ai-tutor/server/src/routes/topics.js:172 |
| POST | /api/courses/:courseId/topics | Authenticated + role(INSTRUCTOR,UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/topics.js:244 |
| POST | /api/courses/:courseId/topics/sync | Authenticated + role(INSTRUCTOR,UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/topics.js:311 |
| POST | /api/courses/:courseId/topics/remap | Authenticated + role(INSTRUCTOR,UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/topics.js:391 |
| GET | /api/ai-models | Authenticated | apps/extensions/ai-tutor/server/src/routes/ai-models.js:44 |
| POST | /api/ai-models/validate-key | Authenticated | apps/extensions/ai-tutor/server/src/routes/ai-models.js:72 |
| GET | /api/ai-status | Authenticated | apps/extensions/ai-tutor/server/src/routes/ai-status.js:15 |
| GET | /api/admin/users | Authenticated + role(ADMIN) | apps/extensions/ai-tutor/server/src/routes/admin.js:58 |
| PATCH | /api/admin/users/:userId/role | Authenticated + role(ADMIN) | apps/extensions/ai-tutor/server/src/routes/admin.js:95 |
| GET | /api/admin/courses | Authenticated + role(ADMIN) | apps/extensions/ai-tutor/server/src/routes/admin.js:99 |
| GET | /api/admin/courses/:courseId/enrollments | Authenticated + role(ADMIN,UNIT_ADMIN,INSTRUCTOR) | apps/extensions/ai-tutor/server/src/routes/admin.js:165 |
| POST | /api/admin/courses/:courseId/enrollments | Authenticated + role(ADMIN,UNIT_ADMIN,INSTRUCTOR) | apps/extensions/ai-tutor/server/src/routes/admin.js:320 |
| DELETE | /api/admin/courses/:courseId/enrollments/:userId | Authenticated + role(ADMIN,UNIT_ADMIN,INSTRUCTOR) | apps/extensions/ai-tutor/server/src/routes/admin.js:377 |
| PATCH | /api/admin/courses/:courseId/enrollments/:userId/role | Authenticated + role(ADMIN,UNIT_ADMIN,INSTRUCTOR) | apps/extensions/ai-tutor/server/src/routes/admin.js:443 |
| GET | /api/admin/settings/eduai-api-key | Authenticated + role(ADMIN) | apps/extensions/ai-tutor/server/src/routes/admin.js:521 |
| PUT | /api/admin/settings/eduai-api-key | Authenticated + role(ADMIN) | apps/extensions/ai-tutor/server/src/routes/admin.js:539 |
| DELETE | /api/admin/settings/eduai-api-key | Authenticated + role(ADMIN) | apps/extensions/ai-tutor/server/src/routes/admin.js:559 |
| GET | /api/admin/settings/ai-model-policy | Authenticated + role(ADMIN) | apps/extensions/ai-tutor/server/src/routes/admin.js:569 |
| PUT | /api/admin/settings/ai-model-policy | Authenticated + role(ADMIN) | apps/extensions/ai-tutor/server/src/routes/admin.js:590 |
| GET | /api/admin/ai-traces | Authenticated + role(UNIT_ADMIN,ADMIN) | apps/extensions/ai-tutor/server/src/routes/admin.js:623 |
| POST | /api/admin/courses/:courseId/sync-enrollments | Authenticated + role(ADMIN) | apps/extensions/ai-tutor/server/src/routes/admin.js:749 |
| POST | /api/bug-reports | Authenticated | apps/extensions/ai-tutor/server/src/routes/bug-reports.js:14 |
| GET | /api/admin/bug-reports | Authenticated + role(ADMIN) | apps/extensions/ai-tutor/server/src/routes/bug-reports.js:28 |
| GET | /api/admin/bug-reports/:bugReportId | Authenticated + role(ADMIN) | apps/extensions/ai-tutor/server/src/routes/bug-reports.js:39 |
| PATCH | /api/admin/bug-reports/:bugReportId | Authenticated + role(ADMIN) | apps/extensions/ai-tutor/server/src/routes/bug-reports.js:53 |
| DELETE | /api/internal/courses/:coreOfferingId | Service key | apps/extensions/ai-tutor/server/src/routes/internal.js:26 |

**apps/extensions/ai-tutor count: 87 method-endpoints (13 route modules).**

## apps/extensions/question-maker (Express)

Routers mounted in `apps/extensions/question-maker/app/backend/src/app.js:101-111`.
`authenticateToken`/`requireAuth` = authenticated; `requireRole(...)` = role gate
(QM_AUTHORIZED / CANVAS_ROLES / ADMIN). `/api/eduai/*` is auth-gated via
`router.use(authenticateToken, requireRole(QM_AUTHORIZED))`. `/api/internal/*`
uses a service-key Bearer.

| Method | Path | Auth tier | Handler (file:line) |
|--------|------|-----------|---------------------|
| POST | /api/questions | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/questions.js:61 |
| GET | /api/questions | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/questions.js:126 |
| GET | /api/questions/stats | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/questions.js:167 |
| GET | /api/questions/export | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/questions.js:196 |
| GET | /api/questions/:id | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/questions.js:269 |
| PUT | /api/questions/:id | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/questions.js:289 |
| DELETE | /api/questions/:id | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/questions.js:373 |
| POST | /api/questions/generate | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/questions.js:395 |
| POST | /api/questions/extract | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/questions.js:428 |
| POST | /api/questions/extract/save | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/questions.js:463 |
| POST | /api/questions/approve | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/questions.js:501 |
| PUT | /api/questions/:id/order | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/questions.js:551 |
| DELETE | /api/questions/:id/order/:assessmentId | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/questions.js:590 |
| POST | /api/questions/:id/variants | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/variants.js:55 |
| GET | /api/questions/:id/variants | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/variants.js:106 |
| PUT | /api/questions/variants/:variantId | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/variants.js:126 |
| PATCH | /api/questions/variants/:variantId/testable | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/variants.js:225 |
| DELETE | /api/questions/variants/:variantId | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/variants.js:259 |
| POST | /api/course | Authenticated | apps/extensions/question-maker/app/backend/src/routes/course.js:37 |
| GET | /api/course | Authenticated | apps/extensions/question-maker/app/backend/src/routes/course.js:69 |
| GET | /api/course/:id/access | Authenticated | apps/extensions/question-maker/app/backend/src/routes/course.js:145 |
| GET | /api/course/:id | Authenticated | apps/extensions/question-maker/app/backend/src/routes/course.js:165 |
| PUT | /api/course/:id | Authenticated | apps/extensions/question-maker/app/backend/src/routes/course.js:208 |
| DELETE | /api/course/:id | Authenticated | apps/extensions/question-maker/app/backend/src/routes/course.js:234 |
| GET | /api/course/:id/topics | Authenticated | apps/extensions/question-maker/app/backend/src/routes/course.js:253 |
| GET | /api/course/:id/enrollments | Authenticated | apps/extensions/question-maker/app/backend/src/routes/course.js:289 |
| POST | /api/course/:id/topics | Authenticated | apps/extensions/question-maker/app/backend/src/routes/course.js:322 |
| PATCH | /api/course/:id/link-core | Authenticated | apps/extensions/question-maker/app/backend/src/routes/course.js:366 |
| POST | /api/course/:id/sync-topics | Authenticated | apps/extensions/question-maker/app/backend/src/routes/course.js:405 |
| POST | /api/assessments | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/assessments.js:48 |
| GET | /api/assessments | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/assessments.js:93 |
| GET | /api/assessments/:id | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/assessments.js:132 |
| PUT | /api/assessments/:id | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/assessments.js:146 |
| DELETE | /api/assessments/:id | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/assessments.js:170 |
| POST | /api/assessments/:id/questions | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/assessments.js:184 |
| DELETE | /api/assessments/:id/questions/:questionId | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/assessments.js:213 |
| GET | /api/assessments/:id/questions | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/assessments.js:232 |
| GET | /api/assessments/:id/sections | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/assessments.js:247 |
| POST | /api/assessments/:id/sections | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/assessments.js:257 |
| PUT | /api/assessments/:assessmentId/sections/:sectionId | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/assessments.js:271 |
| DELETE | /api/assessments/:assessmentId/sections/:sectionId | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/assessments.js:285 |
| POST | /api/assessments/:assessmentId/sections/:sectionId/variants | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/assessments.js:298 |
| PUT | /api/assessments/:assessmentId/sections/:sectionId/variants/:variantId/order | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/assessments.js:328 |
| DELETE | /api/assessments/:assessmentId/sections/:sectionId/variants/:variantId | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/assessments.js:358 |
| GET | /api/assessments/questions/:questionId/check-in-assessments | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/assessments.js:377 |
| DELETE | /api/assessments/questions/:questionId/remove-from-all-sections | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/assessments.js:394 |
| PATCH | /api/assessment-variant/assessments/:id/role | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/assessmentVariant.js:32 |
| GET | /api/assessment-variant/assessments/:id/blueprint-snapshot | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/assessmentVariant.js:77 |
| GET | /api/assessment-variant/assessments/:id/variant-readiness | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/assessmentVariant.js:93 |
| POST | /api/assessment-variant/assemble-variants | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/assessmentVariant.js:114 |
| POST | /api/assessment-variant/assemble-by-metadata | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/assessmentVariant.js:149 |
| POST | /api/assessment-variant/generate-bank-variants | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/assessmentVariant.js:184 |
| POST | /api/assessment-variant/review-variant-ai | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/assessmentVariant.js:211 |
| POST | /api/eduai/chat | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/eduai.js:44 |
| POST | /api/eduai/generate-questions | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/eduai.js:102 |
| GET | /api/eduai/courses | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/eduai.js:184 |
| GET | /api/eduai/courses/:courseId/topics | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/eduai.js:202 |
| POST | /api/eduai/test-api-key | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/eduai.js:231 |
| GET | /api/eduai/ai-models | Authenticated + role(QM_AUTHORIZED) | apps/extensions/question-maker/app/backend/src/routes/eduai.js:285 |
| GET | /api/canvas/integration | Authenticated + role(CANVAS_ROLES) | apps/extensions/question-maker/app/backend/src/routes/canvas.js:33 |
| POST | /api/canvas/connect | Authenticated + role(CANVAS_ROLES) | apps/extensions/question-maker/app/backend/src/routes/canvas.js:60 |
| DELETE | /api/canvas/disconnect | Authenticated + role(CANVAS_ROLES) | apps/extensions/question-maker/app/backend/src/routes/canvas.js:111 |
| GET | /api/canvas/courses | Authenticated + role(CANVAS_ROLES) | apps/extensions/question-maker/app/backend/src/routes/canvas.js:129 |
| POST | /api/canvas/export/:assessmentId | Authenticated + role(CANVAS_ROLES) | apps/extensions/question-maker/app/backend/src/routes/canvas.js:143 |
| GET | /api/canvas/mapping/:courseId | Authenticated + role(CANVAS_ROLES) | apps/extensions/question-maker/app/backend/src/routes/canvas.js:179 |
| GET | /api/canvas/courses/:canvasCourseId/quizzes | Authenticated + role(CANVAS_ROLES) | apps/extensions/question-maker/app/backend/src/routes/canvas.js:199 |
| GET | /api/canvas/courses/:canvasCourseId/quizzes/:quizId/questions | Authenticated + role(CANVAS_ROLES) | apps/extensions/question-maker/app/backend/src/routes/canvas.js:214 |
| POST | /api/canvas/import/:canvasCourseId/quizzes/:quizId | Authenticated + role(CANVAS_ROLES) | apps/extensions/question-maker/app/backend/src/routes/canvas.js:229 |
| GET | /api/topics/sync-status/:courseId | Authenticated | apps/extensions/question-maker/app/backend/src/routes/topics.js:28 |
| GET | /api/auth/me | Authenticated | apps/extensions/question-maker/app/backend/src/routes/auth.js:9 |
| POST | /api/auth/logout | Public | apps/extensions/question-maker/app/backend/src/routes/auth.js:33 |
| POST | /api/bug-reports | Authenticated | apps/extensions/question-maker/app/backend/src/routes/bug-reports.js:8 |
| GET | /api/admin/bug-reports | Authenticated + role(ADMIN) | apps/extensions/question-maker/app/backend/src/routes/bug-reports.js:54 |
| PATCH | /api/admin/bug-reports/:id | Authenticated + role(ADMIN) | apps/extensions/question-maker/app/backend/src/routes/bug-reports.js:75 |
| DELETE | /api/internal/courses/:coreCourseId | Service key | apps/extensions/question-maker/app/backend/src/routes/internal.js:18 |

**apps/extensions/question-maker count: 75 method-endpoints (11 route modules).**

## Grand Total

**249 method-endpoints across 68 route modules** (core 87 · ai-tutor 87 · question-maker 75).

### Notes / judgment calls

- **core dual-path modules** — `courses.materials.$.ts` and `courses.topics.$.ts` each register two URLs and their `action` uses one `switch(request.method)`. `POST` maps to the collection path; `PATCH`/`PUT`/`DELETE` to the `:materialId`/`:topicId` path per REST convention; the loader (GET) is listed on both.
- **core splat routes** (`/api/auth/*`, `/api/canvas/*`, `/api/ai-models/*`, `/api/ai-providers/*`, `/api/users/*`) dispatch internally; `switch(request.method)` cases expanded into `GET/POST/PATCH/DELETE` rows.
- **`Session (delegated)`** marks core modules (`disciplines`, `courses.id.publish/unpublish`) whose auth lives in the imported server helper rather than inline.
- Counts are from a static sweep (2026-07-10); a couple of chained/multi-line `router` declarations in QM `assessments.js`/`variants.js` are the likely source of small drift vs. the issue's ~234 estimate.
