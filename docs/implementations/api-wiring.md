# Cross-App API Wiring

**Branch:** feature/schema-unification  
**Schema contracts:** [schema-design.md](./schema-design.md)  
**Auth:** user calls use forwarded Core session cookies (validated via `POST /api/sessions/validate`); server-to-server calls use the `EDUAI_API_KEY` service key. See [Auth](#auth).

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

> **Updated after the auth-unification work.** Earlier drafts of this doc described user calls arriving as `Authorization: Bearer <user-oauth-token>` validated as a session. That is **not** how it works: Core's Better Auth has only the `apiKey` (x-api-key) plugin — **no `bearer` plugin** — so `auth.api.getSession()` reads **session cookies only**, never an `Authorization` header. There is no `getEduAiAccessTokenForUser`; the helper is `getEduAiCookieForRequest`.

### User auth — session cookie forwarding (existing)

Both extensions authenticate the end user by **forwarding the Core session cookie**:

- AI Tutor / QM middleware validates the incoming cookie by calling Core `POST /api/sessions/validate`, which returns the Core user (`{ id, email, name, image, role }`). `req.user.id` is therefore always a **Core user CUID**. QM additionally `findOrCreateUser`s a local row keyed by that CUID for FK integrity.
- For user-scoped Core calls (e.g. `GET /api/courses`, `GET /api/courses/:id/topics`, `POST /api/questions`), the extension forwards the same `Cookie` header to Core. Cross-subdomain cookies are enabled in Core (`advanced.crossSubDomainCookies`), so the cookie is honoured across apps.

On the Core side, **any request carrying `Authorization: Bearer …` is routed to the service-key path**; everything else falls through to cookie-session auth. This is consistent because user auth is cookie-based and service auth is the Bearer service key — the two never collide.

### Service Key

```
Authorization: Bearer <EDUAI_API_KEY>
```

Standard RFC 6750 Bearer. Both extensions read `EDUAI_API_KEY` from env. Used for server-to-server calls that carry no user identity (enrollments sync, bug reports, question read/patch, topic pull/push).

`requireServiceKey` (`guards.server.ts`) — **built**:

1. Read `Authorization: Bearer <token>`
2. Compare against `process.env.EDUAI_API_KEY` using a SHA-256 digest + `crypto.timingSafeEqual` (constant-time, length-safe)
3. Return `401 { "error": "MISSING_SERVICE_KEY" }` if the header is absent / not `Bearer`
4. Return `403 { "error": "INVALID_SERVICE_KEY" }` if the token does not match (or `EDUAI_API_KEY` is unset)

> **`enforceAdminIfApiKey` is unchanged.** It reads `x-api-key` and requires an ADMIN session — a session-escalation guard, not a service-key validator. `requireServiceKey` is separate. The `x-api-key` header is not used for service-to-service auth.

### RBAC scope (per #275 / #292)

Per #275, new endpoints ship with **minimum-viable auth**, not the full role matrix. Service-key paths are fully enforced. User-cookie paths are gated on "session present" (plus an inline role/ownership check where one is specced) and carry a `// TODO(RBAC #292): replace with resolveCourseAccess` marker at the guard site. Full per-course/role enforcement (including tightening the question read endpoints below) lands in the RBAC tracker **#292**.

---

## Core Endpoints

### GET /api/courses

**Status:** Exists  
**Caller(s):** QM (course linking), AI Tutor  
**Authed by:** Cookie session (ADMIN) — see #292 to broaden  
**Input:** None  
**Output:**
```json
{ "courses": [{ "id": "cuid", "name": "...", "code": "...", "term": "...", "year": 0 }] }
```
**Throws:** —

---

### GET /api/courses/:id

**Status:** Built — `loader` added to `courses.id.ts` (dual auth: service key or cookie session)  
**Caller(s):** AI Tutor reconciliation cron  
**Authed by:** Service key or cookie session  
**Input:** Path: `id`  
**Output:** Single course object  
**Throws:**
- `404` — `{ "error": "COURSE_NOT_FOUND" }`

**Notes:** `loader` exported from `app/routes/api/courses.id.ts`; soft-deleted courses return 404.

---

### GET /api/courses/:id/topics

**Status:** Built — accepts service key (Bearer) and cookie session  
**Caller(s):** QM (topic pull), AI Tutor (existing)  
**Authed by:** Service key (Bearer) or cookie session  
**Input:** Path: `courseId`  
**Output:**
```json
{ "topics": [{ "id": "cuid", "name": "...", "deletedAt": "ISO8601 | null" }] }
```
**Throws:**
- `400` — missing `courseId`
- `401` — no session

**Notes:** `requireServiceKey` is checked before falling through to cookie-session auth, so both the service key and a user cookie work. The list filters `deletedAt: null`, so soft-deleted topics do not appear (and `deletedAt` is always null in this response).

---

### POST /api/courses/:id/topics

**Status:** Built — accepts service key (Bearer) and cookie session  
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

**Notes:** Accepts the service key OR an ADMIN cookie session. A name collision with a soft-deleted topic returns `409` with `existingId: null` (caught via P2002), signalling the caller to restore it in Core.

---

### GET /api/courses/:id/topics/:topicId

**Status:** Built — registered as a second route entry on `courses.topics.$.ts`; returns 404 on soft-deleted topics  
**Caller(s):** AI Tutor reconciliation cron  
**Authed by:** Service key (Bearer) or cookie session  
**Input:** Path: `id` (course), `topicId`  
**Output:** Single topic object  
**Throws:**
- `404` — `{ "error": "TOPIC_NOT_FOUND" }`

**Notes:** Required by the AI Tutor cron to detect deleted topics. Shares `courses.topics.$.ts` via a second `routes.ts` entry; soft-deleted topics return 404.

---

### GET /api/courses/:id/enrollments

**Status:** Built — dual auth (service key OR enrolled user)  
**Caller(s):** AI Tutor `enrollmentSync.js`, `eduaiClient.js:listEduAiCourseEnrollments()`  
**Authed by:** Cookie session (enrolled user) **or** service key — both work  
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

**Status:** Built  
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

**Status:** Built  
**Caller(s):** QM (on Variant approval)  
**Authed by:** **User cookie session** (INSTRUCTOR / TA / ADMIN) — *not* the service key. `createdBy` is derived from the session user, so QM forwards the instructor's Core session cookie rather than the service key for this one call. (Diverges from the original "service key" plan; intentional, so Core records the authoring user.)  
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
- `401` — no session / `403` — session role not in INSTRUCTOR, TA, ADMIN
- `404` — `{ "error": "COURSE_NOT_FOUND" }`
- `404` — `{ "error": "TOPIC_NOT_FOUND" }` — `topicId` genuinely absent (not soft-deleted)
- `422` — `{ "error": "VALIDATION_ERROR", "fields": { ... } }` — malformed body / out-of-range enum (e.g. bad `type`, `difficulty`, `reasoningLevel`). Validated with Zod before any DB access.
- `422` — `{ "error": "DUPLICATE_TOPIC", "conflictingIds": ["cuid"] }` — `topicId` appears in `secondaryTopicIds`
- `422` — `{ "error": "INVALID_TOPIC_IDS", "deletedTopicIds": ["cuid"], "conflictingWithPrimary": [] }` — one or more secondary IDs are **soft-deleted or genuinely absent** (both are folded into `deletedTopicIds`; remediation is identical for QM). `conflictingWithPrimary` is always `[]` (the primary-collision case is reported separately as `DUPLICATE_TOPIC`).

**Notes:** `question_secondary_topics` rows are written in the same transaction. `idempotencyKey` is optional on Core; Core checks it first and returns the existing ID on replay, and **also catches the `P2002` unique-constraint race** (a concurrent duplicate that commits between the check and the insert) — returning the existing ID instead of a 500. QM always sends its local variant UUID. On `422 INVALID_TOPIC_IDS`, QM nulls `core_topic_id` for each returned ID and surfaces a message to the instructor — do not silently retry (the daily reconciliation cron is too slow to be the recovery path here).

---

### GET /api/questions

**Status:** Built  
**Caller(s):** AI Tutor (tutoring flow, via service key)  
**Authed by:** Service key, **or** a non-STUDENT cookie session (INSTRUCTOR / TA / ADMIN). STUDENT sessions get `403`. (Original plan was service-key-only; the cookie path is the #275 minimum-viable placeholder — **#292 will tighten this to service-key / ADMIN-only.**)  
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
- `403` — STUDENT cookie session (students must not reach this endpoint)
- `404` — `{ "error": "COURSE_NOT_FOUND" }`

---

### PATCH /api/questions/:id

**Status:** Built  
**Caller(s):** QM (testable toggle from Variant detail view)  
**Authed by:** Service key (`EDUAI_API_KEY`), or an INSTRUCTOR / TA / ADMIN cookie session. **#292** will reconcile the role surface.  
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

**Status:** Built  
**Caller(s):** QM and AI Tutor reconciliation crons  
**Authed by:** Service key (`EDUAI_API_KEY`), or **any** authenticated cookie session. ⚠️ The cookie path currently has **no role gate** — a STUDENT session can read a question by id, including its `answer`. This is an authz gap left for the RBAC family (**#292**, `// TODO(RBAC #292)` marked at the guard site), not a #275 deliverable. Soft-deleted questions return `404` (`deletedAt: null` filter).  
**Input:** Path: `id`  
**Output:** Single question object (includes `secondaryTopics`)  
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

**Local wiring:** When an instructor selects a Core course in QM or imports one in AI Tutor, call `GET /api/courses` with the **caller's Core session cookie forwarded** (not the service key). Core applies `buildCourseListFilter` so the list matches Canvas-synced instructor enrollments (#578). Store the returned CUID in `courses.core_course_id` (QM) or import into a local offering (AI Tutor).

**Service key:** Reserve `Authorization: Bearer EDUAI_API_KEY` for server-to-server reads by course id (enrollments, topics, reconciliation) — not for instructor course pickers.

**AI Tutor enrollment sync (#578):** After importing a Core course, instructors call `POST /api/courses/:courseId/sync-enrollments` (or use the course UI) to pull active **STUDENT** enrollments from Core into local `CourseEnrollment` rows. QM RBAC for linked courses reads enrollments from Core on each request — Canvas roster updates are visible once Core sync completes, with no QM-side sync step.

**Manual E2E:** See [canvas-extension-course-alignment-e2e.md](./canvas-extension-course-alignment-e2e.md) for the full verification checklist and automated regression commands.

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
| Build `requireServiceKey` guard on Core | ✅ Built (SHA-256 + timingSafeEqual) |
| `GET /api/courses/:id` — add `loader` export to `courses.id.ts` | ✅ Built (dual auth) |
| `GET /api/courses/:id/topics/:topicId` — new route | ✅ Built (404 on soft-deleted) |
| Update `GET /api/courses/:id/topics` to accept service key | ✅ Service key + cookie session |
| Update `POST /api/courses/:id/topics` to accept service key | ✅ Service key + ADMIN session |

### Phase 1.5 — Core API surface

| Item | Status |
|---|---|
| `GET /api/courses/:id/enrollments` (dual auth) | ✅ Built (service key OR enrolled user) |
| `POST /api/bug-reports` | ✅ Built (service-key only; validates `userId`) |
| `POST /api/questions` (with idempotency) | ✅ Built (cookie session; Zod-validated; P2002-safe) |
| `GET /api/questions` (paginated) | ✅ Built (service key / non-STUDENT session) |
| `PATCH /api/questions/:id` | ✅ Built |
| `GET /api/questions/:id` | ✅ Built (⚠️ no role gate on cookie path — see #292) |

### Phase 2a — Wire extensions (keep old tables)

| Item | Status |
|---|---|
| AI Tutor: verify `enrollmentSync.js` against new Core endpoint | ✅ Calls enrollments via service key |
| AI Tutor: bug reports → Core | ✅ Wired (no local table) |
| AI Tutor: admin triage → Core | ✅ Wired (forwards session cookie to Core admin API) |
| AI Tutor: question consumption in tutoring flow (with pagination) | ✅ Wired (fail-soft, `limit:20`) |
| QM: course link (`core_course_id`) | ✅ Wired (manual link-core) |
| QM: topic pull/push (`core_topic_id`) | ✅ Wired (409 → `existingId`) |
| QM: question push (`core_question_id`, idempotency key) | ✅ Wired (cookie-forwarded) |
| QM: testable toggle + 404 nullification | ✅ Wired |
| QM: bug reports → Core | ✅ Wired (no local table) |

### Phase 2b — Drop replaced tables

| Item | Status |
|---|---|
| AI Tutor: drop local `BugReport` model | ✅ No local model remains |
| QM: drop local bug-report table | ✅ Forwards directly to Core |

### Reconciliation Crons (parallel with 2a)

| Item | Status |
|---|---|
| AI Tutor: daily cron — nullify stale `coreOfferingId`/`coreTopicId` (skip on 5xx/timeout) | ❌ Not built (#283) |
| QM: daily cron — nullify stale `core_course_id`/`core_topic_id`/`core_question_id` (skip on 5xx/timeout) | ❌ Not built (#283) |

### Deferred

- `POST /api/sessions/validate` — auth consolidation. **Note:** although tracked as a separate workstream, this endpoint is now **built and in use** — it is the linchpin of all user auth (both extensions validate the forwarded cookie through it; see [Auth](#auth)).
- Core admin bug-report API (`GET /api/admin/bug-reports`, `PATCH /api/admin/bug-reports/:id`) — ✅ Built; AI Tutor admin triage proxies with forwarded session cookie ([#572](https://github.com/EduAI-Lab/EduAI/issues/572))

### MCP summer readiness ([#167](https://github.com/EduAI-Lab/EduAI/issues/167))

| Item | Status |
|---|---|
| ADR + API inventory ([#570](https://github.com/EduAI-Lab/EduAI/issues/570)) | ✅ [`MCP_INTEGRATION_PLAN.md`](../rag-ai/MCP_INTEGRATION_PLAN.md) |
| OpenAPI Phase 1 subset ([#571](https://github.com/EduAI-Lab/EduAI/issues/571)) | ✅ [`mcp-v1.openapi.yaml`](../rag-ai/openapi/mcp-v1.openapi.yaml) |
| API hygiene — JSON course create, error envelope, enrollment idempotency ([#572](https://github.com/EduAI-Lab/EduAI/issues/572)) | ✅ |
| Optional stdio spike ([#573](https://github.com/EduAI-Lab/EduAI/issues/573)) | ✅ [`tools/mcp-spike/`](../../tools/mcp-spike/) |
| MCP Host Server v1 ([#574](https://github.com/EduAI-Lab/EduAI/issues/574)) | ❌ September (Epic [#58](https://github.com/EduAI-Lab/EduAI/issues/58)) |
