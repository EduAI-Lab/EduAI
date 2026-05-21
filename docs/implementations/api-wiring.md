# Cross-App API Wiring

**Branch:** feature/schema-unification  
**Schema contracts:** [schema-design.md](./schema-design.md)  
**Auth consolidation (`POST /api/sessions/validate`) is a separate workstream — not covered here.**

---

## Table of Contents

1. [Auth](#auth)
2. [Core Endpoints](#core-endpoints)
   - [GET /api/courses](#get-apicourses)
   - [GET /api/courses/:id](#get-apicoursesid)
   - [GET /api/courses/:id/topics](#get-apicoursesidtopics)
   - [POST /api/courses/:id/topics](#post-apicoursesidtopics)
   - [GET /api/courses/:id/topics/:topicId](#get-apicoursesidtopicstopicid)
   - [GET /api/courses/:id/enrollments](#get-apicoursesidenrollments)
   - [POST /api/bug-reports](#post-apibug-reports)
   - [POST /api/questions](#post-apiquestions)
   - [GET /api/questions](#get-apiquestions)
   - [PATCH /api/questions/:id](#patch-apiquestionsid)
   - [GET /api/questions/:id](#get-apiquestionsid)
3. [AI Tutor Wiring](#ai-tutor-wiring)
   - [GET /api/courses/:id/enrollments](#get-apicoursesidenrollments-1)
   - [POST /api/bug-reports](#post-apibug-reports-1)
   - [GET /api/questions](#get-apiquestions-1)
   - [Reconciliation Cron](#reconciliation-cron-ai-tutor)
4. [Question Maker Wiring](#question-maker-wiring)
   - [GET /api/courses](#get-apicourses-1)
   - [GET /api/courses/:id/topics](#get-apicoursesidtopics-1)
   - [POST /api/courses/:id/topics](#post-apicoursesidtopics-1)
   - [POST /api/questions](#post-apiquestions-1)
   - [PATCH /api/questions/:id](#patch-apiquestionsid-1)
   - [POST /api/bug-reports](#post-apibug-reports-2)
   - [Reconciliation Cron](#reconciliation-cron-qm)
5. [Build Checklist](#build-checklist)

---

## Auth

### User OAuth (existing)

AI Tutor retrieves a fresh token via `getEduAiAccessTokenForUser(userId)` (`eduaiAuth.js`) and sends it as `Authorization: Bearer <user-oauth-token>`. Core validates it as a normal user session. All current AI Tutor → Core calls use this pattern.

### Service Key (new)

```
Authorization: Bearer <EDUAI_API_KEY>
```

Standard RFC 6750 Bearer. Both extensions read `EDUAI_API_KEY` from env. The existing `eduaiClient.js:requestEduAi()` helper already sends `Authorization: Bearer <token>` — the service key replaces the user OAuth token for server-to-server calls.

Core needs a new `requireServiceKey` guard:

1. Read `Authorization: Bearer <token>`
2. Compare against `process.env.EDUAI_API_KEY` using `crypto.timingSafeEqual`
3. Return `401 { "error": "MISSING_SERVICE_KEY" }` if header absent
4. Return `403 { "error": "INVALID_SERVICE_KEY" }` if token does not match

> **Do not extend `enforceAdminIfApiKey`** (`guards.server.ts`). It reads `x-api-key` and requires an ADMIN session — it is a session-escalation guard, not a service-key validator. Build `requireServiceKey` separately. The `x-api-key` header is not used for service-to-server auth.

---

## Core Endpoints

### GET /api/courses

**Status:** Exists  
**Caller(s):** QM (course linking), AI Tutor  
**Authed by:** User OAuth Bearer  
**Input:** None  
**Output:**
```json
{ "courses": [{ "id": "cuid", "name": "...", "code": "...", "term": "...", "year": 0 }] }
```
**Throws:** —

---

### GET /api/courses/:id

**Status:** Broken — `courses.id.ts` exports `action` only; GET returns 405  
**Caller(s):** AI Tutor reconciliation cron  
**Authed by:** User OAuth Bearer  
**Input:** Path: `id`  
**Output:** Single course object  
**Throws:**
- `404` — `{ "error": "COURSE_NOT_FOUND" }`

**Notes:** Fix: add a `loader` export to `app/routes/api/courses.id.ts`.

---

### GET /api/courses/:id/topics

**Status:** Exists — auth needs update for service key  
**Caller(s):** QM (topic pull), AI Tutor (existing)  
**Authed by:** User OAuth Bearer; service key once guard is updated  
**Input:** Path: `courseId`  
**Output:**
```json
{ "topics": [{ "id": "cuid", "name": "...", "deletedAt": "ISO8601 | null" }] }
```
**Throws:**
- `400` — missing `courseId`
- `401` — no session

**Notes:** `enforceAdminIfApiKey` reads the `x-api-key` header — a `Authorization: Bearer <EDUAI_API_KEY>` request has no such header, so the guard passes through to `auth.api.getSession`, which returns 401 (session not found). The service key is not recognized at all. Fix: check `requireServiceKey` before falling through to session auth.

---

### POST /api/courses/:id/topics

**Status:** Exists — auth needs update for service key  
**Caller(s):** QM (topic push)  
**Authed by:** Service key (`EDUAI_API_KEY`)  
**Input:**
```json
{ "name": "string" }
```
**Output:**
```json
{ "id": "core-cuid", "name": "..." }
```
**Throws:**
- `400` — missing `courseId`
- `401` — no auth
- `403` — insufficient permissions
- `404` — `{ "error": "COURSE_NOT_FOUND" }`
- `409` — `{ "error": "TOPIC_ALREADY_EXISTS", "existingId": "cuid" }`

**Notes:** Currently restricted to ADMIN session. Update to accept `requireServiceKey` in addition to admin session.

---

### GET /api/courses/:id/topics/:topicId

**Status:** Not built — no route registered  
**Caller(s):** AI Tutor reconciliation cron  
**Authed by:** User OAuth Bearer or service key  
**Input:** Path: `id` (course), `topicId`  
**Output:** Single topic object  
**Throws:**
- `404` — `{ "error": "TOPIC_NOT_FOUND" }`

**Notes:** Required by the AI Tutor cron to detect deleted topics. Register a new route in `routes.ts`.

---

### GET /api/courses/:id/enrollments

**Status:** Not built — **blocking AI Tutor imports right now**  
**Caller(s):** AI Tutor `enrollmentSync.js`, `eduaiClient.js:listEduAiCourseEnrollments()`  
**Authed by:** User OAuth Bearer **or** service key — both must work  
**Input:** Path: `id`  
**Output:**
```json
{
  "enrollments": [
    {
      "studentId": "cuid",
      "studentEmail": "...",
      "studentName": "...",
      "enrolledAt": "ISO8601 | null",
      "isActive": true,
      "role": "STUDENT" | "TA" | "INSTRUCTOR"
    }
  ]
}
```
**Throws:**
- `403` — caller not enrolled in or instructor of this course (user auth path only)
- `404` — `{ "error": "COURSE_NOT_FOUND" }`

**Notes:** Return both active and inactive enrollments — AI Tutor's `enrollmentSync.js` filters `isActive: true` itself. This is the only Core endpoint that accepts both auth types simultaneously; both must be supported from day one.

---

### POST /api/bug-reports

**Status:** Not built  
**Caller(s):** AI Tutor, QM  
**Authed by:** Service key (`EDUAI_API_KEY`)  
**Input:**
```json
{
  "source": "AI_TUTOR" | "QUESTION_MAKER",
  "userId": "core-cuid",
  "description": "string (max 2000)",
  "isAnonymous": false,
  "consoleLogs": "string?",
  "networkLogs": "string?",
  "screenshot": "string?",
  "pageUrl": "string?",
  "userAgent": "string?",
  "context": {}
}
```
**Output:** `201` — no body  
**Throws:**
- `422` — `{ "error": "VALIDATION_ERROR", "fields": { "description": "exceeds 2000 chars" } }`
- `422` — `{ "error": "USER_NOT_FOUND" }` — `userId` CUID does not exist

**Notes:** `userId` is always persisted for audit, even when `isAnonymous: true`. When `isAnonymous` is true, `userId` must not appear in admin queries. Extensions include `userId` explicitly — the service key carries no user identity.

---

### POST /api/questions

**Status:** Not built  
**Caller(s):** QM (on Variant approval)  
**Authed by:** Service key (`EDUAI_API_KEY`)  
**Input:**
```json
{
  "courseId": "cuid",
  "topicId": "cuid",
  "content": "string",
  "type": "MCQ" | "SA" | "LA",
  "difficulty": "EASY" | "MEDIUM" | "HARD",
  "reasoningLevel": "FACTUAL" | "ANALYTICAL" | "APPLICATION",
  "choices": [{ "letter": "A", "text": "..." }],
  "answer": "string?",
  "testable": false,
  "secondaryTopicIds": ["cuid"],
  "idempotencyKey": "local-variant-uuid (optional)"
}
```
**Output:** `201 { "id": "core-cuid" }`  
**Throws:**
- `404` — `{ "error": "COURSE_NOT_FOUND" }`
- `404` — `{ "error": "TOPIC_NOT_FOUND" }` — `topicId` genuinely absent (not soft-deleted)
- `422` — `{ "error": "DUPLICATE_TOPIC", "conflictingIds": ["cuid"] }` — `topicId` appears in `secondaryTopicIds`
- `422` — `{ "error": "INVALID_TOPIC_IDS", "deletedTopicIds": ["cuid"], "conflictingWithPrimary": [] }` — one or more IDs are soft-deleted

**Notes:** `question_secondary_topics` rows written in the same transaction. `idempotencyKey` is optional on Core; Core upserts on it and returns the existing ID on duplicate. QM always sends its local variant UUID. On `422 INVALID_TOPIC_IDS`, QM must null `core_topic_id` for each `deletedTopicIds` entry and surface a message to the instructor — do not silently retry (the daily reconciliation cron is too slow to be the recovery path here).

---

### GET /api/questions

**Status:** Not built  
**Caller(s):** AI Tutor (tutoring flow)  
**Authed by:** Service key only — reject user session tokens with `403`  
**Input:** Query: `courseId` (required), `topicId` (optional), `testable` (boolean, optional), `limit` (default 100, max 500), `offset` (default 0)  
**Output:**
```json
{
  "questions": [{ "id": "...", "choices": [...], "answer": "...", "testable": true }],
  "total": 240,
  "limit": 100,
  "offset": 0
}
```
**Throws:**
- `400` — `{ "error": "MISSING_COURSE_ID" }`
- `403` — user session token presented (students must not reach this endpoint)
- `404` — `{ "error": "COURSE_NOT_FOUND" }`

---

### PATCH /api/questions/:id

**Status:** Not built  
**Caller(s):** QM (testable toggle from Variant detail view)  
**Authed by:** Service key (`EDUAI_API_KEY`)  
**Input:**
```json
{ "testable": boolean, "actingUserId": "core-cuid (optional, for audit)" }
```
**Output:** `{ "id": "cuid", "testable": boolean }`  
**Throws:**
- `404` — `{ "error": "QUESTION_NOT_FOUND" }` — QM must null `variants.core_question_id` on this response
- `422` — `{ "error": "VALIDATION_ERROR", "fields": { "testable": "required boolean" } }`

---

### GET /api/questions/:id

**Status:** Not built  
**Caller(s):** QM and AI Tutor reconciliation crons  
**Authed by:** Service key (`EDUAI_API_KEY`)  
**Input:** Path: `id`  
**Output:** Single question object  
**Throws:**
- `404` — `{ "error": "QUESTION_NOT_FOUND" }`

**Notes:** Required by both reconciliation crons. On strict 404, the cron nullifies `core_question_id`.

---

## AI Tutor Wiring

### GET /api/courses/:id/enrollments

**Local wiring:** `enrollmentSync.js` already calls `listEduAiCourseEnrollments()` with user OAuth on every `POST /api/courses/import-external`. No re-auth changes needed — once Core exposes the endpoint the existing call pattern works.

---

### POST /api/bug-reports

**Current:** `prisma.bugReport.create(...)` writes to local `BugReport` table.  
**Required:** Replace with a call to Core `POST /api/bug-reports`, passing `source: "AI_TUTOR"` and the user's Core CUID as `userId`.  
**Admin triage:** `GET /api/admin/bug-reports` and `PATCH /api/admin/bug-reports/:id` currently read the local table. These must proxy to Core's admin bug-report API once it is specced — see Deferred.  
**Phase 2b:** Drop local `BugReport` Prisma model after wiring is verified.

---

### GET /api/questions

**Current:** AI Tutor has no question-reading capability.  
**Required:** Wire tutoring agents (`teach`/`guide`/`custom` endpoints) to call `GET /api/questions?courseId=:id&testable=true` using the service key. Inject at the appropriate point in the activity pipeline. Use `limit`/`offset` — do not fetch unbounded sets.

---

### Reconciliation Cron (AI Tutor)

**Required:** Daily job iterating rows where `coreOfferingId IS NOT NULL` or `coreTopicId IS NOT NULL`. For each row, call `GET /api/courses/:id` or `GET /api/courses/:id/topics/:topicId`. On strict `404`, null the reference column. On `5xx` or timeout, skip and retry next run — do not nullify on transient errors. Local records are kept; only the Core link is cleared.

**Blocked by:** `GET /api/courses/:id` (broken, no loader) and `GET /api/courses/:id/topics/:topicId` (not built) — both must exist before this cron can run.

---

## Question Maker Wiring

### GET /api/courses

**Local wiring:** When an instructor selects a Core course in QM, call `GET /api/courses` and store the returned CUID in `courses.core_course_id`. No new Core endpoint needed.

---

### GET /api/courses/:id/topics

**Local wiring:** Call on topic sync. Upsert local `topics` rows; populate `topics.core_topic_id`.

---

### POST /api/courses/:id/topics

**Local wiring:** When an instructor creates a topic in QM for a course with `core_course_id` set, call `POST /api/courses/:id/topics`. Store returned CUID in `topics.core_topic_id`. On `409 TOPIC_ALREADY_EXISTS`, use `existingId` — do not fail.

---

### POST /api/questions

**Local wiring:** On Variant approval (`isDraft = false`) when the parent question has `core_course_id`:

1. Resolve `topics.core_topic_id` for the Variant's primary topic. If missing, push to Core first (see [POST /api/courses/:id/topics](#post-apicoursesidtopics-1)).
2. Build request body including `secondaryTopicIds` (array of `core_topic_id`). Push any secondary topics lacking `core_topic_id` to Core first.
3. Set `idempotencyKey` to the local variant UUID.
4. Store returned CUID in `variants.core_question_id`.

**On `422 INVALID_TOPIC_IDS`:** Null `core_topic_id` for each `deletedTopicIds` entry; surface message to instructor.  
**On `422 DUPLICATE_TOPIC`:** Fix secondary topic list before retrying.

---

### PATCH /api/questions/:id

**Local wiring:** Called from QM Variant detail view when instructor toggles testable. On `404 QUESTION_NOT_FOUND`, null `variants.core_question_id`.

---

### POST /api/bug-reports

**Current:** Writes to local bug-report table.  
**Required:** Replace with call to Core `POST /api/bug-reports`, passing `source: "QUESTION_MAKER"` and the user's Core CUID as `userId`.  
**Phase 2b:** Drop local bug-report table after verifying.

---

### Reconciliation Cron (QM)

**Required:** Daily job iterating rows where `core_course_id IS NOT NULL`, `core_topic_id IS NOT NULL`, or `core_question_id IS NOT NULL`. Call the corresponding Core GET-by-id endpoint for each. Nullify reference on strict `404` only. On `5xx` or timeout, skip and retry next run. Local QM records are not deleted.

**Endpoints needed:** `GET /api/courses/:id`, `GET /api/courses/:id/topics/:topicId`, `GET /api/questions/:id` — all three are currently unbuilt.

---

## Build Checklist

### Phase 0 — Prerequisites (unblock everything)

| Item | Status |
|---|---|
| Build `requireServiceKey` guard on Core | ❌ Blocks all service-key endpoints |
| `GET /api/courses/:id` — add `loader` export to `courses.id.ts` | ❌ Broken (GET returns 405) |
| `GET /api/courses/:id/topics/:topicId` — new route | ❌ Not built |
| Update `GET /api/courses/:id/topics` to accept service key | ❌ Currently rejects non-admin key callers |
| Update `POST /api/courses/:id/topics` to accept service key | ❌ Currently admin-session only |

### Phase 1.5 — Core API surface

| Item | Status |
|---|---|
| `GET /api/courses/:id/enrollments` (dual auth) | ❌ Not built — **blocks AI Tutor imports now** |
| `POST /api/bug-reports` | ❌ Not built |
| `POST /api/questions` (with idempotency) | ❌ Not built |
| `GET /api/questions` (service-key only, pagination) | ❌ Not built |
| `PATCH /api/questions/:id` | ❌ Not built |
| `GET /api/questions/:id` | ❌ Not built |

### Phase 2a — Wire extensions (keep old tables)

| Item | Status |
|---|---|
| AI Tutor: verify `enrollmentSync.js` against new Core endpoint | ❌ Pending Phase 1.5 |
| AI Tutor: bug reports → Core | ❌ Writes locally |
| AI Tutor: admin triage → Core (blocked on Deferred admin API) | ❌ Not wired |
| AI Tutor: question consumption in tutoring flow (with pagination) | ❌ Not wired |
| QM: course link (`core_course_id`) | ❌ Not wired |
| QM: topic pull/push (`core_topic_id`) | ❌ Not wired |
| QM: question push (`core_question_id`, idempotency key) | ❌ Not wired |
| QM: testable toggle + 404 nullification | ❌ Not wired |
| QM: bug reports → Core | ❌ Writes locally |

### Phase 2b — Drop replaced tables

| Item | Status |
|---|---|
| AI Tutor: drop local `BugReport` model | ❌ Pending Phase 2a |
| QM: drop local bug-report table | ❌ Pending Phase 2a |

### Reconciliation Crons (parallel with 2a)

| Item | Status |
|---|---|
| AI Tutor: daily cron — nullify stale `coreOfferingId`/`coreTopicId` (skip on 5xx/timeout) | ❌ Pending Phase 0 |
| QM: daily cron — nullify stale `core_course_id`/`core_topic_id`/`core_question_id` (skip on 5xx/timeout) | ❌ Pending Phase 0 |

### Deferred

- `POST /api/sessions/validate` — auth consolidation; separate workstream
- Core admin bug-report API (`GET /api/admin/bug-reports`, `PATCH /api/admin/bug-reports/:id`) — needed for AI Tutor admin triage proxy; must be specced before Phase 2a admin-triage item can be started
