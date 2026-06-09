# Broken Routes & Schema Drift Audit

**Generated:** 2026-05-22  
**Context:** Platform centralization (`schema_unification` migration). Core Prisma schema is ahead of route handlers, UI, Zod contracts, and extension wiring.

**Canonical schema:** `apps/core/prisma/schema.prisma`  
**Wiring spec:** `docs/implementations/api-wiring.md`  
**Design spec:** `docs/implementations/schema-design.md`

**Verification:** `npm run typecheck` in `apps/core` reports **21 TypeScript errors**; many map directly to stale field names below.

---

## Summary

| Category | Count (approx.) | Severity |
|----------|-----------------|----------|
| Missing Core API routes (extensions blocked) | 7 | High |
| Existing routes with wrong HTTP behavior | 3 | High |
| Handlers using removed Prisma fields | 6 files | High (won't compile / runtime Prisma errors) |
| Role enum drift (`PROFESSOR` vs `INSTRUCTOR`) | 8+ files | High (auth/UI broken for instructors) |
| Schema contract gaps (required fields, soft delete) | 4 | Medium |
| Extension callers hitting missing Core endpoints | 2+ | High |

---

## 1. Missing Core API routes

These endpoints are specified in `api-wiring.md` but **not registered** in `apps/core/app/routes.ts` and have **no handler implementation**.

| Method | Path | Blocked callers | Notes |
|--------|------|-----------------|-------|
| GET | `/api/courses/:id` | AI Tutor & QM reconciliation crons | Route file exists but has **no `loader`** — GET returns **405** |
| GET | `/api/courses/:id/topics/:topicId` | AI Tutor & QM reconciliation crons | No route registered |
| GET | `/api/courses/:id/enrollments` | AI Tutor `enrollmentSync.js`, `eduaiClient.js:listEduAiCourseEnrollments()` | **Blocks course import enrollment sync today** |
| POST | `/api/bug-reports` | AI Tutor, Question Maker | `BugReport` model exists in Prisma; no route |
| POST | `/api/questions` | QM variant approval push | `Question` model exists; no route |
| GET | `/api/questions` | AI Tutor tutoring flow (planned) | No route |
| PATCH | `/api/questions/:id` | QM testable toggle | No route |
| GET | `/api/questions/:id` | QM & AI Tutor reconciliation crons | No route |

**Also missing (infrastructure, not routes but blocks service-key callers):**

| Item | Location | Impact |
|------|----------|--------|
| `requireServiceKey` guard | `app/lib/auth/guards.server.ts` | `Authorization: Bearer $EDUAI_API_KEY` is not recognized; topics POST/GET fall through to session auth → **401** |

**Deferred (documented, not built):** `GET/PATCH /api/admin/bug-reports`, `POST /api/sessions/validate`, enrollment POST/DELETE.

---

## 2. Broken existing routes (wrong behavior)

### `GET /api/courses/:id` — returns 405

| | |
|---|---|
| **File** | `app/routes/api/courses.id.ts` |
| **Problem** | Exports `action` only; `handleCourseRequest` has no GET branch |
| **Expected** | `loader` → single course JSON; `404 COURSE_NOT_FOUND` |
| **Callers** | AI Tutor cron (`coreOfferingId`), QM cron (`core_course_id`) |

### `GET /api/courses` — no auth, no role filter, incomplete payload

| | |
|---|---|
| **File** | `app/lib/courses/server.ts` (GET branch) |
| **Problems** | Unauthenticated; returns all courses; omits `section`, `isPublished`, `deletedAt`, enrollment-scoped filtering per centralization plan |
| **Callers** | QM course linking, AI Tutor course list |

### `POST /api/courses` — creates invalid / incomplete rows

| | |
|---|---|
| **File** | `app/lib/courses/server.ts` (POST branch) |
| **Problems** | Sets removed field `professorId` on `Course.create`; omits required Prisma fields `section`, `startDate`; does not create `Enrollment` with `role: INSTRUCTOR` |
| **Runtime** | Prisma rejects `professorId`; even if ignored, create fails on missing required columns |

### `PATCH /api/courses/:id` — ownership check uses removed model

| | |
|---|---|
| **File** | `app/lib/courses/server.ts` (PATCH branch) |
| **Problems** | `select: { professorId }`, compares `user.role === "PROFESSOR"` (invalid `UserRole`); should use `Enrollment` where `role IN (INSTRUCTOR, TA)` or admin |
| **Route** | `app/routes/api/courses.id.ts` — PATCH works via `action`, but authorization logic is wrong |

### `GET|POST /api/courses/:courseId/materials` — access check uses pre-unification schema

| | |
|---|---|
| **File** | `app/routes/api/courses.materials.$.ts` |
| **Problems** | `CourseWhereInput` uses `professorId`, `tas`, `enrollments.studentId` — all removed. Should use `enrollments: { some: { userId, role, isActive } }` |
| **TS errors** | Lines 35–37, 167–169 |

### `GET|POST|DELETE /api/courses/:courseId/topics` — auth & soft-delete gaps

| | |
|---|---|
| **File** | `app/routes/api/courses.topics.$.ts`, `app/lib/courses/server.ts` |
| **Auth** | Service key (`Bearer EDUAI_API_KEY`) not accepted — `enforceAdminIfApiKey` only checks `x-api-key` + ADMIN session |
| **POST** | Admin-only; QM needs service key per `api-wiring.md` |
| **GET** | `getCourseTopics()` does not filter `deletedAt: null` |
| **DELETE** | `deleteCourseTopic()` uses `deleteMany` (hard delete); schema design requires **soft delete** (`deletedAt = now()`) |
| **409** | Create duplicate returns generic message, not `TOPIC_ALREADY_EXISTS` + `existingId` |

### `GET|POST|PATCH|DELETE /api/users/*` — count relations removed from User model

| | |
|---|---|
| **File** | `app/routes/api/users.$.ts` |
| **Problems** | `_count.select` uses `enrolledCourses`, `assistedCourses`, `taughtCourses` — replaced by single `enrollments` relation |
| **Role** | Zod allows `PROFESSOR`; Prisma `UserRole` is `INSTRUCTOR` (not `PROFESSOR`) |
| **UI** | `admin.users.tsx`, `users-table.tsx`, `user-form-dialog.tsx` mirror stale counts and `PROFESSOR` role |

### `POST /api/chat` — course lookup uses invalid unique key

| | |
|---|---|
| **File** | `app/routes/api/chat.ts` (~line 319) |
| **Problem** | `prisma.course.findUnique({ where: { code: courseCode } })` — unique constraint is now `@@unique([code, startDate, section])`, not `code` alone |
| **Fix direction** | `findFirst` with code + section (+ term/year) or resolve by `id` |

---

## 3. UI routes broken by schema drift (Core)

These are not under `/api/*` but fail at compile time or show wrong access rules.

| Route | File | Issue |
|-------|------|-------|
| `/courses` | `app/routes/courses.tsx` | `Course` type includes `professorId`; filters with `user.role === "PROFESSOR"`; API no longer returns `professorId` |
| `/courses/:courseId` | `app/routes/courses.$courseId.tsx` | `include: { professor }` invalid; `course.professorId` checks; `PROFESSOR` role string |
| `/admin/users` | `app/routes/admin.users.tsx` + admin components | `PROFESSOR` role; `_count.enrolledCourses` / `assistedCourses` / `taughtCourses` |

**Role rename gap:** Prisma `UserRole` uses `INSTRUCTOR`. App code, Zod schemas, and extensions still use `PROFESSOR`. Instructors created via seed/OAuth as `INSTRUCTOR` will not match UI checks for `PROFESSOR`.

| Layer | Uses `PROFESSOR` | Should use |
|-------|------------------|------------|
| `app/lib/auth/schemas.ts` | `createUserSchema`, `updateUserSchema` | `INSTRUCTOR` |
| `app/routes/courses.tsx`, `courses.$courseId.tsx` | role checks | `INSTRUCTOR` |
| Admin UI components | role labels/values | `INSTRUCTOR` |
| AI Tutor extension | widespread `PROFESSOR` | Map from Core `INSTRUCTOR` at OAuth boundary |

---

## 4. Zod / API contract gaps

| Schema | File | Gap |
|--------|------|-----|
| `CreateCourseSchema` | `app/lib/courses/schemas.ts` | Missing `section`, `startDate`, `endDate`, `department`, `isPublished` required by Prisma `Course` |
| `UpdateCourseSchema` | same | Same optional fields; no validation for compound unique |
| User admin schemas | `app/lib/auth/schemas.ts` | `PROFESSOR` not in `UserRole` enum |
| Topic list response | topics GET | Should include `deletedAt` per wiring spec; handler returns raw Prisma rows without explicit contract |

---

## 5. Extension integration breakage (depends on Core)

### AI Tutor (`apps/extensions/ai-tutor`)

| Consumer | Calls | Core status |
|----------|-------|-------------|
| `server/src/services/eduaiClient.js` | `GET /courses/:id/enrollments` | **404/405 — route missing** |
| `server/src/services/enrollmentSync.js` | Same | Import/sync fails when Core linked |
| `server/src/routes/courses.js` | `POST /courses/import-external` triggers sync | Blocked |
| Reconciliation cron (planned) | `GET /courses/:id`, `GET /courses/:id/topics/:topicId` | Broken / missing |
| Bug reports | Local Prisma `BugReport` | `POST /api/bug-reports` not built |
| Role model | `PROFESSOR` everywhere | Mismatch with Core `INSTRUCTOR` |

AT schema **does** include `coreOfferingId` / `coreTopicId` (aligned with design). Wiring to Core GET-by-id endpoints is blocked until Core routes exist.

### Question Maker (`apps/extensions/question-maker`)

| Consumer | Calls | Core status |
|----------|-------|-------------|
| Course/topic/question push (planned) | `POST /api/questions`, topic POST with service key | Not built |
| Reconciliation cron (planned) | GET-by-id for course, topic, question | Not built |
| Sequelize schema | `core_course_id`, `core_topic_id`, `core_question_id` | Columns exist; runtime wiring pending |

---

## 6. TypeScript errors from `npm run typecheck` (apps/core)

Grouped by root cause:

### Schema unification (fix first)

```
app/lib/courses/server.ts          — professorId, PROFESSOR role
app/routes/api/courses.materials.$.ts — professorId, tas, studentId
app/routes/api/users.$.ts          — enrolledCourses, assistedCourses, taughtCourses, PROFESSOR
app/routes/courses.$courseId.tsx   — professor include, professorId
app/routes/api/chat.ts:319         — findUnique by code only
```

### Possibly unrelated to schema (still failing typecheck)

```
app/routes/api/chat.ts             — GenericMessage / streamText types, JsonValue (lines 313, 464, 655)
app/routes/settings.tsx            — authClient.apiKey missing on better-auth client
```

---

## 7. Tests & seed alignment

| Item | Status |
|------|--------|
| `app/tests/integration/courses.test.ts` | Seed uses **new** schema (`INSTRUCTOR`, `Enrollment`, `section`, `startDate`); POST test body is incomplete / does not assert |
| `prisma/seed.ts` | **Aligned** with unified schema (enrollments, questions, bug reports) |
| `app/tests/integration/courses-topic.test.ts` | Verify separately — may assume old topic delete semantics |

---

## 8. Recommended fix order

1. **Role rename pass** — `PROFESSOR` → `INSTRUCTOR` in Core Zod, UI, and extension OAuth mapping (or document explicit alias in Better Auth).
2. **Enrollment-based authorization** — replace `professorId` / `tas` / `studentId` queries in `server.ts`, `courses.materials.$.ts`, course pages.
3. **`GET /api/courses/:id` loader** — unblocks crons.
4. **`GET /api/courses/:id/enrollments`** — unblocks AI Tutor import **now**.
5. **`requireServiceKey`** + update topics routes auth.
6. **Missing question & bug-report routes** — per `api-wiring.md` Phase 1.5.
7. **Soft-delete topics** — `deletedAt` filter on GET; PATCH/DELETE semantics.
8. **`CreateCourseSchema`** — add required fields; create `Enrollment` on course create.
9. **Chat course resolution** — compound unique lookup.

---

## 9. File index (quick reference)

| File | Broken because |
|------|----------------|
| `app/routes/api/courses.id.ts` | No GET loader |
| `app/lib/courses/server.ts` | `professorId`, `PROFESSOR`, incomplete POST/PATCH |
| `app/routes/api/courses.materials.$.ts` | Old enrollment/course relations |
| `app/routes/api/courses.topics.$.ts` | Service key auth; admin-only POST |
| `app/routes/api/users.$.ts` | Old `_count` relations; `PROFESSOR` |
| `app/routes/courses.tsx` | `professorId`, `PROFESSOR` |
| `app/routes/courses.$courseId.tsx` | `professor` relation, `professorId` |
| `app/lib/auth/schemas.ts` | `PROFESSOR` in Zod |
| `app/lib/auth/guards.server.ts` | No `requireServiceKey` |
| `app/lib/courses/schemas.ts` | Missing required Course fields |
| `app/routes/api/chat.ts` | Invalid `findUnique({ code })` |
| `app/routes.ts` | Missing routes for enrollments, questions, bug-reports, topic-by-id |
| `apps/extensions/ai-tutor/server/src/services/eduaiClient.js` | Calls missing enrollments endpoint |
| `apps/extensions/ai-tutor/server/src/services/enrollmentSync.js` | Depends on above |

---

*This file is a point-in-time audit. Re-run `npm run typecheck` in `apps/core` after fixes to confirm the error list shrinks.*
