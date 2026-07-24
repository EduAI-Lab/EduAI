# apps/extensions/question-maker — Perf Measurement Spec

Derived by reading `app/backend/src/routes/*.js` handlers, `services/*.js`, and Sequelize models in
`src/schema/*.js` (source of truth, not `endpoints.md` alone). Express; `authenticateToken`/`requireAuth`
validate the session against Core on **every** request; `requireRole(QM_AUTHORIZED / CANVAS_ROLES / ADMIN)`.
Own Postgres DB with **numeric autoincrement** ids (Topics ids are CUID strings). `userId` columns hold Core
CUIDs.

**75 method-endpoints → 46 IN-SCOPE, 29 SKIP.**

Load-bearing findings:
- Every request pays one Core `sessions/validate` round-trip (uniform baseline offset).
- `requireCourseAccess` makes a **second** Core call for Core-linked courses — UNLESS the caller is ADMIN or
  the course is **unlinked** (`coreCourseId=null`). → the perf seed uses a dedicated **unlinked** perf course
  so per-course endpoints stay DB-pure.
- Reclassified to SKIP after reading handlers: `PATCH /questions/variants/:id/testable` (Core proxy),
  `POST /bug-reports` + `GET/PATCH /admin/bug-reports` (pure Core proxies, zero QM DB).
- Confirmed AI-free (in-scope): `POST /questions/approve`, `PATCH /assessment-variant/.../role`,
  `GET .../blueprint-snapshot`, `GET .../variant-readiness`.

Ids are numeric → perf seed (`scripts/seed-perf.js`) emits `.perf-pool/qm.json`; harness resolves from it.
Response id path for creates is `body.data.id`.

## IN-SCOPE reads (18)
`GET` — /api/auth/me · /api/course · /api/course/:id · /:id/access · /:id/topics · /:id/enrollments ·
/api/questions · /api/questions/stats · /api/questions/export?courseId · /api/questions/:id ·
/api/questions/:id/variants · /api/assessments · /api/assessments/:id · /:id/questions · /:id/sections ·
/api/assessments/questions/:qid/check-in-assessments · /api/assessment-variant/assessments/:id/blueprint-snapshot ·
/:id/variant-readiness · /api/topics/sync-status/:id. (All run against the unlinked perf course.)

## IN-SCOPE mutations (28)
questions: POST /api/questions (create) · PUT /:id (update) · DELETE /:id (victim) · POST /approve (bulk create) ·
PUT /:id/order (update) · DELETE /:id/order/:aid (victim). variants: POST /questions/:id/variants (create) ·
PUT /variants/:id (update, draft only) · DELETE /variants/:id (victim). course: POST /api/course (create) ·
PUT /:id (update) · DELETE /:id (victim, cascades) · POST /:id/topics (create). assessments: POST (create) ·
PUT /:id (update) · DELETE /:id (victim) · POST /:id/questions (link) · DELETE /:id/questions/:qid (victim) ·
POST /:id/sections (create) · PUT /sections/:sid (update) · DELETE /sections/:sid (victim) ·
POST /sections/:sid/variants (link) · PUT /sections/:sid/variants/:vid/order (update) ·
DELETE /sections/:sid/variants/:vid (victim) · DELETE /questions/:qid/remove-from-all-sections (victim).
assessment-variant: PATCH /assessments/:id/role (JSONB merge).

Body rules: questions require `courseId` (numeric) + `primaryTopicId` (CUID) + `type`∈MCQ/SA/LA. Variants require
`questionText`; keep `isDraft:true` (never send `isDraft:false` → would push to Core). Assessments require
`type`∈Assignment/Lab/Quiz/Midterm/Final + `name` + `semester` + `courseId`.

## SKIP (29) — reasons
All `/api/eduai/*` (6: chat, generate-questions, courses, courses/:id/topics, test-api-key, ai-models — LLM/Core) ·
all `/api/canvas/*` (10 — Canvas LMS) · `POST /questions/generate` (LLM) · `/questions/extract`, `/extract/save`
(OCR/AI) · `PATCH /course/:id/link-core`, `POST /course/:id/sync-topics` (Core) ·
`assessment-variant/assemble-variants|assemble-by-metadata|generate-bank-variants|review-variant-ai` (AI) ·
`PATCH /questions/variants/:id/testable` (Core proxy) · `POST /bug-reports`, `GET/PATCH /admin/bug-reports` (Core
proxies) · `/api/internal/*` (service key) · `POST /auth/logout` (Core proxy).

## Seed pool (`scripts/seed-perf.js` → `.perf-pool/qm.json`)
Additive (NO `sync({force})` — never drops demo data). 1 unlinked perf course owned by
`seed_user_instructor_cs` + 3 topics + anchor assessment/section/question/variant (stable read + POST targets);
victim pools ×POOL each: questions, draft variants, assessments, sections, section-variant links, unlinked
courses, questions-with-order (for order/link deletes), questions-with-section-link (for remove-from-all-sections);
plus reusable update rows. Manifest carries every id. Re-run between perf runs to refill.
