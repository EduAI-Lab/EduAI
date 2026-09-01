# apps/core — Perf Measurement Spec

Derived by reading every `apps/core/app/routes/api/*.ts` handler and its service
schemas (source of truth, not `endpoints.md` alone). Covers all **87**
method-endpoints: **68 IN-SCOPE**, **19 SKIP**.

Seed users (from the app seed): `admin@eduai.local` (ADMIN),
`instructor.cs@eduai.local` (INSTRUCTOR, owns the CS course),
`ta.cs@eduai.local` (TA), `student1@eduai.local` (STUDENT),
`unitadmin.cosc@eduai.local` (UNIT_ADMIN of dept `COSC`).

Column key:
- **kind** — `read` (GET) / `mutation` (non-GET).
- **role** — seed identity that is authorized to call it.
- **params** — where each `:param` id comes from.
- **body** — exact JSON for mutations (validated fields only).
- **destr?** — `create` (POST returns a new id, accumulates), `victim` (DELETE / role-consuming mutation — needs a disposable pooled row per iteration), `reuse` (PUT/PATCH idempotent — one dedicated disposable row reused ~10×), `none`.
- **resp id** — JSON path of the new id on 2xx (creates only).

---

## IN-SCOPE (68)

### Health / reference
| # | Method + Path | kind | role | params | body | destr? | resp id |
|---|---|---|---|---|---|---|---|
| 1 | GET /api/health | read | none (public) | — | — | none | — |

`health` returns a static `{status:"ok"}` — no DB. Keep as a no-DB latency floor.

### Courses
| # | Method + Path | kind | role | params | body | destr? | resp id |
|---|---|---|---|---|---|---|---|
| 2 | GET /api/courses | read | instructor | — | — | none | — |
| 3 | POST /api/courses | mutation | instructor (or admin) | — | `{"name":"Perf C","code":"PERF-<uniq>","section":"001","term":"Fall","year":2026,"startDate":"2026-01-01","department":"<real Discipline code, e.g. COSC>","instructorUserIds":["<instructor.cs user id>"],"isPublished":false,"aiInstructions":""}` | create | `body.id` |
| 4 | GET /api/courses/:id | read | instructor | `:id` = a disposable perf course id | — | none | — |
| 5 | PATCH /api/courses/:id | mutation | instructor | `:id` = dedicated disposable course | `{"name":"Perf C v2"}` (any `UpdateCourseSchema` field; all optional) | reuse | — |
| 6 | DELETE /api/courses/:id | mutation | instructor (owner) or admin | `:id` = victim from delete-course pool | — | victim | — |
| 7 | PATCH /api/courses/:id/publish | mutation | instructor (owner) | `:id` = dedicated disposable course | none / `{}` (delegated toggle) | reuse | — |
| 8 | PATCH /api/courses/:id/unpublish | mutation | instructor (owner) | `:id` = dedicated disposable course | none / `{}` | reuse | — |

`POST /api/courses` FK notes: `department` must exist in the `Discipline` table
(400 `INVALID_DEPARTMENT` otherwise); every id in `instructorUserIds` must be a
user with role INSTRUCTOR (422 `INVALID_INSTRUCTOR`). An INSTRUCTOR caller is
force-scoped to their own id. `code` must be unique-ish per (term/year) — vary it.
`startDate`/`endDate` are `z.coerce.date` (ISO string ok). Response is the raw
course (`jsonResponse(201, course)`), id at `body.id`.
`UpdateCourseSchema` fields (all optional): name, code, section, term, year,
startDate, endDate, department, description, isPublished, isActive,
aiInstructions, instructorId.

### Materials (metadata only — upload path is SKIP)
| # | Method + Path | kind | role | params | body | destr? | resp id |
|---|---|---|---|---|---|---|---|
| 9 | GET /api/courses/:courseId/materials | read | instructor | `:courseId` = perf course | — | none | — |
| 10 | GET /api/courses/:courseId/materials/:materialId | read | instructor | `:materialId` = disposable material in perf course | — | none | — |
| 11 | PATCH /api/courses/:courseId/materials/:materialId | mutation | instructor | dedicated disposable material | `{"title":"Renamed"}` (or `{"visibleToStudents":true}` / `{"availableAt":"2026-01-01T00:00:00Z"}` / `{"availableAt":null}`) | reuse | — |
| 12 | PUT /api/courses/:courseId/materials/:materialId | mutation | instructor | dedicated disposable material | same as PATCH (identical handler branch) | reuse | — |
| 13 | DELETE /api/courses/:courseId/materials/:materialId | mutation | instructor | victim from material-delete pool | — | victim | — |

Body validation is hand-rolled (no Zod): `title` non-empty ≤255,
`visibleToStudents` boolean, `availableAt` ISO string or null. At least one field
required (400 `NO_FIELDS`). DELETE is a soft-delete (`deletedAt`) so each victim
is single-use. Note materials with the same checksum de-dupe, so pooled rows must
be distinct rows (created directly by the seed, no file needed).

### Embedding settings (DB write only — do NOT set `reEmbed`)
| # | Method + Path | kind | role | params | body | destr? | resp id |
|---|---|---|---|---|---|---|---|
| 14 | GET /api/courses/:courseId/embedding-settings | read | instructor | perf course | — | none | — |
| 15 | PATCH /api/courses/:courseId/embedding-settings | mutation | instructor | dedicated disposable course | `{"embeddingProvider":"local","embeddingModel":"nomic-embed-text"}` | reuse | — |

`embeddingProvider` ∈ `local` \| `ollama` \| `cloud` \| null. Provide provider
and/or model. **Omit `reEmbed`** — `reEmbed:true` starts an embedding-provider
job (that path is SKIP). Use a fresh course that was never embedded so the
cross-validation doesn't reject the change.

### Topics
| # | Method + Path | kind | role | params | body | destr? | resp id |
|---|---|---|---|---|---|---|---|
| 16 | GET /api/courses/:courseId/topics | read | instructor | perf course | — | none | — |
| 17 | POST /api/courses/:courseId/topics | mutation | instructor | perf course | `{"name":"Perf Topic <uniq>"}` | create | `body.id` |
| 18 | GET /api/courses/:courseId/topics/:topicId | read | instructor | disposable topic | — | none | — |
| 19 | PATCH /api/courses/:courseId/topics/:topicId | mutation | instructor | dedicated disposable topic | `{"name":"Renamed <uniq>"}` | reuse | — |
| 20 | DELETE /api/courses/:courseId/topics/:topicId | mutation | instructor | victim from topic-delete pool | `{}` (topicId taken from path; body may also carry `{"topicId":"..."}`) | victim | — |

`name` must be unique per course (409 `TOPIC_ALREADY_EXISTS`) — vary POST/PATCH
names. POST returns the topic directly, id at `body.id`.

### Course chats (read-only, policy-gated)
| # | Method + Path | kind | role | params | body | destr? | resp id |
|---|---|---|---|---|---|---|---|
| 21 | GET /api/courses/:courseId/chats | read | admin | perf course (with student chats) | — | none | — |
| 22 | GET /api/units/:department/chats | read | admin | `:department` = a real dept, e.g. `COSC` | — | none | — |

Both are ADMIN-always; for INSTRUCTOR/UNIT_ADMIN they need a policy grant flag
that is **off by default**, so call as ADMIN to get a 200 (otherwise 403/denyByPolicy).

### TAs
| # | Method + Path | kind | role | params | body | destr? | resp id |
|---|---|---|---|---|---|---|---|
| 23 | GET /api/courses/:courseId/tas | read | instructor | perf course | — | none | — |
| 24 | POST /api/courses/:courseId/tas | mutation | instructor | perf course | `{"userId":"<a disposable perf user id not already TA of this course>"}` | create (consumes a user slot) | `body.id` |
| 25 | DELETE /api/courses/:courseId/tas | mutation | instructor | perf course | `{"userId":"<user id currently a TA of this course>"}` | victim | — |

`userId` is an FK to a real user. `(courseId,userId)` is unique for a TA, so each
POST needs a fresh disposable user, and each DELETE needs an existing TA pair.
POST returns the CourseTA row, id at `body.id`.

### Enrollments
| # | Method + Path | kind | role | params | body | destr? | resp id |
|---|---|---|---|---|---|---|---|
| 26 | GET /api/courses/:id/enrollments | read | instructor | perf course | — | none | — |
| 27 | POST /api/courses/:id/enrollments | mutation | instructor | perf course | `{"userId":"<disposable perf user not yet enrolled>","role":"STUDENT"}` | create (consumes a user slot) | `body.id` |
| 28 | PATCH /api/courses/:id/enrollments/:enrollmentId | mutation | instructor | `:enrollmentId` = dedicated disposable STUDENT enrollment | `{"role":"TA"}` (toggle STUDENT↔TA) | reuse | — |

`userId` FK must exist (422 `USER_NOT_FOUND`) and be unique per course
(409 `ALREADY_ENROLLED`) — fresh user per POST. `role` ∈ STUDENT \| TA \| INSTRUCTOR;
adding/patching to INSTRUCTOR needs rank ≥ 3 (admin/unit-admin) — **stick to
STUDENT/TA** as instructor. Never PATCH the seeded instructor enrollment
(instructor-floor 409). POST returns the enrollment, id at `body.id`.

### RAG settings
| # | Method + Path | kind | role | params | body | destr? | resp id |
|---|---|---|---|---|---|---|---|
| 29 | GET /api/courses/:id/rag-settings | read | instructor | perf course | — | none | — |
| 30 | PATCH /api/courses/:id/rag-settings | mutation | instructor (or admin) | dedicated disposable course | `{"ragTopK":5,"ragSimilarityThreshold":0.5}` | reuse | — |

`ragTopK` int 1–20 (nullable), `ragSimilarityThreshold` >0 and <1 (nullable),
both optional. Role must be ADMIN or INSTRUCTOR with course access.

### Questions
| # | Method + Path | kind | role | params | body | destr? | resp id |
|---|---|---|---|---|---|---|---|
| 31 | GET /api/questions?courseId=... | read | instructor | `courseId` is a **query param** (400 `MISSING_COURSE_ID` if absent); optional `limit` (≤500) | — | none | — |
| 32 | POST /api/questions | mutation | instructor | — | `{"courseId":"<perf course id>","topicId":"<topic id in that course>","content":"Perf Q?","type":"MCQ","choices":[{"letter":"A","text":"x"},{"letter":"B","text":"y"}],"answer":"A"}` | create | `body.id` |
| 33 | GET /api/questions/:id | read | instructor | `:id` = a seeded/created question id | — | none | — |
| 34 | PATCH /api/questions/:id | mutation | instructor | dedicated disposable question | `{"testable":true}` (handler only updates `testable`) | reuse | — |

`CreateQuestionSchema`: required `courseId`, `topicId`, `content`,
`type`∈`MCQ|SA|LA`; optional `difficulty`∈`EASY|MEDIUM|HARD`,
`reasoningLevel`∈`FACTUAL|ANALYTICAL|APPLICATION`, `choices[]`,`answer`,`testable`,
`secondaryTopicIds[]`,`idempotencyKey`. `courseId`/`topicId` are FKs (404 if
missing). PATCH `:id` validates only `testable` boolean (422 otherwise). POST
returns `{id}`, id at `body.id`.

### AI providers (Admin) — splat, id in the URL path segment
| # | Method + Path | kind | role | params | body | destr? | resp id |
|---|---|---|---|---|---|---|---|
| 35 | GET /api/ai-providers | read | admin | — | — | none | — |
| 36 | POST /api/ai-providers | mutation | admin | — | `{"name":"perf-prov-<uniq>","displayName":"Perf","description":"perf","requiresApiKey":false,"isActive":true}` | create | `body.id` |
| 37 | PATCH /api/ai-providers/:providerId | mutation | admin | `:providerId` = dedicated disposable provider (id is the path tail) | `{"displayName":"Perf v2"}` | reuse | — |
| 38 | DELETE /api/ai-providers/:providerId | mutation | admin | victim from provider-delete pool | — | victim | — |

`name` must be unique (409 `PROVIDER_NAME_NOT_UNIQUE`) — vary it.
`defaultBaseUrl` if present must be a valid URL. No external call is made
(pure `prisma.aIProvider` CRUD).

### AI models (Admin) — splat, id in the URL path segment
| # | Method + Path | kind | role | params | body | destr? | resp id |
|---|---|---|---|---|---|---|---|
| 39 | GET /api/ai-models | read | admin | — | — | none | — |
| 40 | POST /api/ai-models | mutation | admin | — | `{"modelId":"perf-model-<uniq>","name":"Perf Model","description":"perf","type":"CHAT","providerId":"<a real AIProvider id>","isActive":true}` | create | `body.id` |
| 41 | PATCH /api/ai-models/:modelId | mutation | admin | dedicated disposable model | `{"name":"Perf Model v2"}` | reuse | — |
| 42 | DELETE /api/ai-models/:modelId | mutation | admin | victim from model-delete pool | — | victim | — |

`providerId` FK required (400 `PROVIDER_NOT_FOUND`); `modelId` unique
(409 `MODEL_ID_NOT_UNIQUE`) — vary it. `type`∈CHAT|COMPLETION|EMBEDDING|IMAGE|AUDIO|VIDEO.
`supportsTools:true` requires `type:"CHAT"`. No external call.

### Me / Preferences (act on the caller's own row)
| # | Method + Path | kind | role | params | body | destr? | resp id |
|---|---|---|---|---|---|---|---|
| 43 | GET /api/me | read | dedicated perf user | — | — | none | — |
| 44 | PATCH /api/me | mutation | dedicated perf user | — | `{"name":"Perf Name"}` (also `image`: valid URL or null) | reuse (self-row) | — |
| 45 | GET /api/preferences | read | dedicated perf user | — | — | none | — |
| 46 | POST /api/preferences | mutation | dedicated perf user | — | `{"assistDefault":true,"density":"comfortable","theme":"dark","motionReduced":false,"lastCourseCode":null}` | reuse (upsert on userId) | — |
| 47 | PATCH /api/preferences | mutation | dedicated perf user | — | same as POST (same handler branch) | reuse | — |

`updateMeSchema`: `name` (≥2, optional), `image` (URL, nullable, optional).
Preferences update keys (all optional, others ignored): `assistDefault` bool,
`lastCourseCode` string|null, `motionReduced` bool, `density` (valid UiDensity),
`theme` (valid UiTheme). Must supply ≥1 valid key (400 otherwise). **Authenticate
as a dedicated disposable perf user** so the known seed users' profile/prefs are
never mutated.

### Users (Admin) — splat, id in the URL path segment
| # | Method + Path | kind | role | params | body | destr? | resp id |
|---|---|---|---|---|---|---|---|
| 48 | GET /api/users | read | admin | — | — | none | — |
| 49 | POST /api/users | mutation | admin | — | `{"name":"Perf User","email":"perf+<uniq>@perf.local","role":"STUDENT"}` (createUserSchema; `authorizedUnits[]` optional and, if given, must be real Discipline codes) | create | `body.id` |
| 50 | PATCH /api/users/:userId | mutation | admin | dedicated disposable user (id is path tail; must NOT be a known seed user or self-deactivation) | `{"name":"Perf User v2"}` | reuse | — |
| 51 | DELETE /api/users/:userId | mutation | admin | victim from user-delete pool | — | victim | — |

`email` unique (409 `EMAIL_ALREADY_EXISTS`) — vary it. Confirm the full
`createUserSchema`/`updateUserSchema` field set in `app/lib/auth/schemas.ts`
(name/email/role/password?/authorizedUnits) before implementing PATCH bodies that
touch more than `name`.

### Invitations (inviter = ADMIN or grant-enabled UNIT_ADMIN)
| # | Method + Path | kind | role | params | body | destr? | resp id |
|---|---|---|---|---|---|---|---|
| 52 | GET /api/invitations | read | admin | — | — | none | — |
| 53 | POST /api/invitations | mutation | admin | — | `{"email":"invite+<uniq>@perf.local","role":"INSTRUCTOR"}` (optional `name`≥2, `authorizedUnits[]` real Discipline codes) | create | `body.invitation.id` |
| 54 | POST /api/invitations/:id | mutation | admin | `:id` = a pending disposable invitation (resend) | — | reuse | — |
| 55 | DELETE /api/invitations/:id | mutation | admin | victim from invitation-delete pool | — | victim | — |

`role` must be in `invitableRolesFor(actor)` (ADMIN may invite ADMIN/UNIT_ADMIN/INSTRUCTOR;
403 `FORBIDDEN_ROLE` otherwise). **Email side-effect:** POST and the `:id` resend
send an invitation email when SMTP is configured. Run the perf stack with
`SMTP_HOST` **unset** so these only log the accept link (no network I/O), keeping
them pure-DB. POST returns `{invitation, acceptUrl, emailDelivered}`, id at
`body.invitation.id`.

### Sessions / Policies / Dashboard
| # | Method + Path | kind | role | params | body | destr? | resp id |
|---|---|---|---|---|---|---|---|
| 56 | POST /api/sessions/validate | read (session lookup) | any authenticated | — | — (no body) | none | — |
| 57 | GET /api/policies | read | admin | — | — | none | — |
| 58 | PATCH /api/policies | mutation | admin | — | `{"key":"<known policy key, e.g. instructors.canCreateCourses>","value":true}` | reuse (toggle — restore after) | — |
| 59 | PUT /api/policies | mutation | admin | — | same as PATCH (same handler branch) | reuse | — |
| 60 | GET /api/dashboard/stats | read | admin | — | — | none | — |

`POST /api/sessions/validate` is a Better-Auth `getSession` + a DB read of
`authorizedUnits` for UNIT_ADMINs — it is a DB session lookup, not a full
`/api/auth/*` flow. **Rate-limit caveat:** it is IP rate-limited (429) — space
iterations or exempt the perf IP, or measurements will hit `RATE_LIMIT_EXCEEDED`.
`PATCH/PUT /api/policies` mutates a `SystemConfig` flag (`UpdatePolicySchema =
{key:string, value:boolean}`, 404 on unknown key); toggle a benign flag and
restore it after the run.

### Bug reports
| # | Method + Path | kind | role | params | body | destr? | resp id |
|---|---|---|---|---|---|---|---|
| 61 | GET /api/bug-reports?mine=true | read | dedicated perf user | `mine=true` query required (400 otherwise) | — | none | — |
| 62 | POST /api/bug-reports | mutation | dedicated perf user | — | `{"description":"perf bug"}` (session path overrides `userId`/`source` from the session — `source` becomes `CORE`) | create | — (201, empty body) |
| 63 | GET /api/admin/bug-reports | read | admin | — | — | none | — |
| 64 | PATCH /api/admin/bug-reports/:id | mutation | admin | `:id` = a disposable bug report id | `{"status":"IN_PROGRESS"}` (∈ UNHANDLED\|IN_PROGRESS\|RESOLVED) | reuse | — |

`createBugReport` requires `description` (string ≤2000) and a valid `userId`
(supplied from the session for CORE callers). Optional `bugType`, plus
`isAnonymous`,`consoleLogs`,`networkLogs`,`screenshot`,`pageUrl`,`userAgent`,`context`.
POST returns **201 with no body** — no id to chain. Status-change PATCH is
idempotent (reuse one report).

### Cron jobs (Admin) — DB-only branches only
| # | Method + Path | kind | role | params | body | destr? | resp id |
|---|---|---|---|---|---|---|---|
| 65 | GET /api/admin/cron-jobs | read | admin | — | — | none | — |
| 66 | POST /api/admin/cron-jobs | mutation | admin | — | `{"intent":"update-schedule","jobName":"<a KNOWN_CRON_JOBS name>","schedule":"0 3 * * *","scheduleLabel":"Daily 3am"}` (or `{"intent":"reset-schedule","jobName":"..."}`) | reuse | — |

**Only measure `intent:"update-schedule"` / `"reset-schedule"`** (pure DB write +
in-process reschedule). Do **NOT** send `intent:"trigger"` — it spawns the cron
job's background script (heavy / possibly external). `jobName` must match a
`KNOWN_CRON_JOBS` entry; `schedule` must be a valid cron expression.

---

## SKIP (19) — with reason

| Method + Path | Reason |
|---|---|
| GET /api/auth/* | Better-Auth internal splat |
| POST /api/auth/* | Better-Auth internal splat |
| GET /api/canvas/* | Canvas LMS |
| POST /api/canvas/* | Canvas LMS |
| DELETE /api/canvas/* | Canvas LMS |
| POST /api/chat | RAG retrieval + LLM |
| POST /api/courses/:courseId/materials | File ingestion → `processMaterialEmbeddings` (embedding provider); multipart upload |
| GET /api/courses/:courseId/canvas-materials | Canvas — `discoverCanvasMaterialsForCourse` hits Canvas API |
| POST /api/courses/:courseId/canvas-materials | Canvas — `syncSelectedCanvasMaterials` |
| POST /api/courses/:courseId/canvas-materials/exclusions | Canvas — `excludeCanvasMaterial`/`unexcludeCanvasMaterial` |
| POST /api/courses/:courseId/re-embed | Embedding provider (starts re-embed job) |
| GET /api/courses/:courseId/re-embed/:jobId | Embedding job status (paired with re-embed) |
| GET /api/ollama-models | Calls Ollama server |
| GET /api/vllm-models | Calls vLLM server |
| POST /api/e2e/promote | Test-only (NODE_ENV + secret gated) |

(15 distinct rows; the 19 count includes the multi-method splats
`/api/auth/*` ×2 and `/api/canvas/*` ×3 counted individually.)

---

## Seed pool requirements (`apps/core/scripts/seed-perf-volume.ts`)

All rows below are **disposable** and must be distinguishable from seed/demo data
for teardown. Tagging convention:

- **Users**: `email` like `perf+<purpose>+<n>@perf.local` (e.g. `perf+deluser+3@perf.local`); a fast `email LIKE 'perf+%@perf.local'` sweep drops them all.
- **Courses**: `code` prefixed `PERF-<purpose>-<n>` and `department` set to a real Discipline code (FK); sweep by `code LIKE 'PERF-%'`.
- **Topics / Materials / Questions / Enrollments / Chats / Invitations**: hang off the perf courses/users above, so cascade-drop by their parent perf course/user (or tag `Question.content` / `CourseTopic.name` / `CourseMaterial.title` / `Invitation.email` with a `PERF ` marker).
- **AIProvider / AIModel**: `name`/`modelId` prefixed `perf-`; sweep by that prefix.

Sizing (≥10 iterations per destructive endpoint):

| Pool | Model | Count | Purpose / tagging |
|---|---|---|---|
| delete-course pool | Course | 10 | single-use victims for DELETE /api/courses/:id (`code PERF-DEL-<n>`) |
| shared perf course | Course | 1 (+ its enrollment of `instructor.cs`) | parent for materials/topics/questions/enrollments/TAs reads & creates; also the `:courseId` for GET lists (`code PERF-MAIN`) |
| dedicated update course | Course | 1 | reused target for PATCH course, publish/unpublish, embedding-settings PATCH, rag-settings PATCH (never embedded) (`code PERF-UPD`) |
| material-delete pool | CourseMaterial (in shared perf course) | 10 | victims for DELETE material (distinct checksums, `status READY`, no chunks needed) |
| dedicated update material | CourseMaterial | 1 | reused for PATCH/PUT material |
| topic-delete pool | CourseTopic (shared perf course) | 10 | victims for DELETE topic |
| dedicated update topic | CourseTopic | 1 | reused for PATCH topic |
| dedicated read topic | CourseTopic | 1 | for GET topic + as `topicId` for POST question |
| question-update row | Question | 1 | reused for PATCH /api/questions/:id (`testable` toggle) |
| read question | Question | 1 | for GET /api/questions/:id |
| enrollee user pool | User | 10 | fresh users for POST enrollments (unique per course) |
| dedicated enrollment | Enrollment (STUDENT, disposable user, shared course) | 1 | reused for PATCH enrollment role |
| TA-add user pool | User | 10 | fresh users for POST /tas |
| TA-remove pool | CourseTA pairs (10 users × shared course) | 10 | existing TA pairs for DELETE /tas |
| chat-delete pool | Chat (+ minimal ChatMessage) | 10 | victims for DELETE /api/chats/:chatId; also back GET /api/chats, GET/:chatId, /messages, and course-chats/unit-chats lists (owner = active STUDENT enrolled in shared course, `courseId` set) |
| provider-delete pool | AIProvider | 10 | victims for DELETE /api/ai-providers/:id (`name perf-prov-del-<n>`) |
| dedicated update provider | AIProvider | 1 | reused for PATCH provider; also serves as `providerId` for POST ai-models |
| model-delete pool | AIModel | 10 | victims for DELETE /api/ai-models/:id |
| dedicated update model | AIModel | 1 | reused for PATCH model |
| user-delete pool | User | 10 | victims for DELETE /api/users/:id (never a seed user) |
| dedicated update user | User | 1 | reused for PATCH /api/users/:id |
| invitation-delete pool | Invitation | 10 | victims for DELETE /api/invitations/:id (pending, `email invite+del+<n>@perf.local`) |
| dedicated resend invitation | Invitation | 1 | pending, reused for POST /api/invitations/:id (resend) |
| bug-report row | BugReport | 1 | reused for PATCH /api/admin/bug-reports/:id (status toggle) |
| dedicated perf actor | User (STUDENT) | 1 (with a live session for the harness) | the identity for GET/PATCH me, GET/POST/PATCH preferences, GET(?mine)/POST bug-reports — keeps known seed users untouched |

Pure-create endpoints (POST courses/topics/questions/tas/enrollments/invitations/
users/ai-providers/ai-models/bug-reports/assistive-events, POST/PATCH preferences)
accumulate new rows across iterations rather than consuming a pool — they need no
victim pool, but their inserts must carry the `perf`/`PERF-` tags above so
teardown removes them. `assistive-events` POST additionally needs an optional
valid `chatId` only if you exercise that field (body: `{"eventType":"focus"}` is
sufficient; `eventType` 1–64 chars, `adhdAssist?` bool, `chatId?` cuid).

Policy PATCH/PUT mutate a shared `SystemConfig` flag rather than a pooled row —
snapshot the target flag before the run and restore it after.
