# API Reference

Complete endpoint reference for the AI Tutor backend API. All routes are mounted under `/api` (see `server/src/app.js`). This document was regenerated from the route handlers themselves (`server/src/routes/*.js`) rather than from design notes, so treat it as the source of truth over any older doc that disagrees with it.

## Authentication

All endpoints require an authenticated session **except** `GET /api/health`, `POST /api/logout`, and the `POST /api/internal/*` service-to-service routes. There is no local login, JWT, or bearer-token flow — the browser sends its EduAI Core session cookie (`credentials: "include"`), and `middleware/auth.js`'s `requireAuth` forwards that cookie to Core's `POST /api/sessions/validate` on every request to populate `req.user`. See [`ARCHITECTURE.md`](ARCHITECTURE.md) for the full request lifecycle.

The five supported roles are `STUDENT`, `TA`, `INSTRUCTOR`, `UNIT_ADMIN`, `ADMIN`. `TA` is not a role Core issues directly for the platform account — `GET /api/me` promotes a `STUDENT` to the effective role `TA` when the enrollment sync finds them teaching a course as a TA (see [Identity](#identity) below). Any role value Core reports that isn't one of the five falls back to `STUDENT` (`normalizeRole` in `middleware/auth.js`).

**Error responses:**

- `401 Unauthorized` — No valid session, or Core rejected the cookie.
- `403 Forbidden` — Authenticated but the role/course-membership check failed. Also returned for `ADMIN`/`UNIT_ADMIN` callers hitting a path the isolation gate in `app.js` doesn't allow (see [Admin isolation](#admin-isolation)).
- `429 Too Many Requests` — Core itself rate-limited the session-validation call; `Retry-After` is forwarded when Core sent one.
- `503 Service Unavailable` — Core (or, for AI-tutoring routes, an unavailable live-enrollment check) could not be reached.
- `504 Gateway Timeout` — The Core call exceeded `CORE_AUTH_TIMEOUT_MS` (default 5s).

### Admin isolation

After `requireAuth`, `app.js` runs a second gate: an `ADMIN` caller may only reach `/api/me`, anything under `/api/admin/*`, `/api/ai-status`, `/api/ai-models` (+ subpaths), `/api/bug-reports`, `/api/prompts` (+ subpaths), and the shared course/module/lesson/activity/topic tree (`/api/courses`, `/api/courses/*`, `/api/modules/*`, `/api/lessons/*`, `/api/activities/*`, `/api/topics/*`) — admins share the same Courses dashboard instructors use. Any other path 403s with `"Admins can only access admin endpoints"`. `UNIT_ADMIN` is additionally blocked from `/api/admin/settings/*` and `/api/admin/users*` (system-wide configuration and user management stay `ADMIN`-only), but can reach `/api/admin/courses/*` for enrollment management.

---

## Pagination

List endpoints return the platform pagination envelope, matching EduAI Core's own contract, rather than a bare array:

```json
{
  "data": [],
  "total": 0,
  "page": 1,
  "pageSize": 25
}
```

`total` is the full count matching the query, **not** the length of `data`. Clients must treat a short `data` as one page — not the whole set — and read `total` for counts, "select all", or any tree/ordinal derivation. See `server/src/utils/pagination.js`.

**Query params:** `page` (1-based) and `pageSize`.

- `page` clamps to `1..1000000` (`MAX_PAGE`).
- `pageSize` clamps to `1..200` (`MAX_PAGE_SIZE`).
- Fractional values are floored.

**Two parsing modes.** They differ only on _absent_ params; a param that is present but unparseable is a `400` in both.

| Mode | Endpoints | Params absent |
| --- | --- | --- |
| **Required** | `GET /api/courses`, `GET /api/admin/courses`, `GET /api/activities/importable` | `400 PAGINATION_REQUIRED` |
| **Optional** | `GET /api/courses/:courseId/modules`, `GET /api/modules/:moduleId/lessons`, `GET /api/lessons/:lessonId/activities`, `GET /api/courses/:courseId/topics` | Defaults to page 1, `pageSize` 200 |

### Search

Every list endpoint above accepts an optional `search` query param. Filtering happens **server-side, in SQL**: the term is ANDed onto the endpoint's existing visibility scope, and the same `where` feeds both the count and the page, so `total` is the count of _matching_ rows.

| Endpoint | Matched against |
| --- | --- |
| `GET /api/courses/:courseId/modules` | `title`, `description` |
| `GET /api/modules/:moduleId/lessons` | `title` |
| `GET /api/lessons/:lessonId/activities` | `title`, `instructionsMd`, `config.question` |
| `GET /api/courses/:courseId/topics` | `name` |
| `GET /api/activities/importable` | the above, plus the parent lesson and module titles |

An absent, empty, or whitespace-only `search` means "no filter". Clients must not filter the returned page again — the term is already applied server-side.

**Pagination errors** (shaped `{ error: string, code: string }`):

- `400 PAGINATION_REQUIRED` — a required-mode endpoint was called without both `page` and `pageSize`.
- `400 PAGINATION_INVALID` — `page` or `pageSize` was supplied but is not a finite number.
- `400 SEARCH_INVALID` — `search` was repeated, which Express parses as an array.
- `400 SEARCH_TOO_LONG` — `search` exceeds 200 characters.

Every paginated query carries `id` as its final sort key so tied rows can't shift between pages.

---

## Ordering and structure

The ordered tree levels (modules, lessons, activities) sort by `position asc, id asc`. `position` has no unique constraint and is not guaranteed contiguous — it is a sort key, not a rank.

### Move to position

```
PATCH /api/modules/:moduleId/position
PATCH /api/lessons/:lessonId/position
PATCH /api/activities/:activityId/position
```

Body: `{ "position": <0-based ordinal> }`. Response: `{ <module|lesson|activity>, position, total }`.

Auth: `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN`, course-authorized.

`position` is an ordinal — an index into the ordered sibling list — not a raw `position` column value. An out-of-range ordinal is clamped rather than rejected. `400 POSITION_INVALID` when `position` is missing, non-integer, or negative. `404` when the row doesn't exist.

The bulk `PUT .../order` endpoints (`PUT /api/courses/:courseId/modules/order`, `PUT /api/modules/:moduleId/lessons/order`, `PUT /api/lessons/:lessonId/activities/order`) remain for the single-page case and still require `orderedIds` to be the complete sibling set, `400` otherwise.

### Structural context

```
GET /api/modules/:moduleId/context  -> { moduleOrdinal, moduleTotal }
GET /api/lessons/:lessonId/context  -> { moduleOrdinal, lessonOrdinal, moduleTotal,
                                         lessonTotal, prevLessonId, nextLessonId }
GET /api/lessons/:lessonId/breadcrumb -> { module, course, moduleOrdinal, lessonOrdinal,
                                         moduleTotal, lessonTotal, prevLessonId, nextLessonId,
                                         viewerEnrollmentRole }
```

All ordinals are 1-based. Visibility matches the list endpoints: a student's ordinals and totals count only published siblings. `403` if the caller can't see the row; `404` if it doesn't exist. `breadcrumb` additionally resolves the full module + course ancestry in one call (used by the lesson-player and lesson-editor breadcrumb trails) plus `viewerEnrollmentRole` — the caller's enrollment role *on this specific course* (`STUDENT` | `TA` | `INSTRUCTOR` | `null`), which the frontend uses to gate answer submission and AI tutoring separately from the caller's global platform role.

---

## System

### `GET /api/health`

Database liveness probe (`SELECT 1`). No auth required.

**Response:** `200` with `{ ok: true }`, or `503` with `{ ok: false, error: "Database unavailable" }`.

---

## Identity

### `GET /api/me`

Returns the current authenticated user, with the TA-role overlay applied.

**Auth:** Any authenticated user.

**Behavior:** Reads the base role Core reported at session-validation time. If that role is `STUDENT`, the handler also fetches the caller's Core course list and checks whether any of them shows the caller as a `TA`; if so, the response's `role` is promoted to `TA` (every other role is passed through unchanged). This is the *global effective role* used for navigation and route gating; it is distinct from `viewerEnrollmentRole` on a specific course (see [Structural context](#structural-context)), which can differ per course. As a side effect, this endpoint also throttled-fires the background job that mirrors the caller's Core-taught courses into a local `CourseOffering` anchor row (never awaited, so it never slows this response).

**Response:**

```json
{
  "user": {
    "id": "cuid",
    "name": "string",
    "email": "string",
    "role": "STUDENT | TA | INSTRUCTOR | UNIT_ADMIN | ADMIN",
    "authorizedUnits": ["string[] (UNIT_ADMIN only)"]
  }
}
```

Returns `401` if there is no session.

### `POST /api/logout`

Proxies sign-out to Core server-to-server (`POST /api/auth/sign-out`) so the browser avoids Core's CORS restrictions. Not gated by `requireAuth` — invalidating an already-invalid session is a no-op, not a 401. Requires `EDUAI_API_KEY` to be configured server-side; returns `503` if it isn't.

**Response:** `{ ok: true }` on success; `{ ok: false, error }` with the mapped status otherwise (`504` on timeout, `429` with `Retry-After` on rate limit, `503` otherwise).

---

## Courses

### `GET /api/courses`

List courses for the current user. Course fields (title, code, description, department, dates, `isPublished`, term, year, `aiInstructions`) are **read-through from Core on every request** — `CourseOffering` in AI Tutor's own database carries none of them (see [Data Model](ARCHITECTURE.md#data-model-overview-prisma)).

**Auth:** Any authenticated user with a supported course role.

**Behavior (role-divergent, resolved in `services/courseAccess.js`):**

- `ADMIN` sees Core's entire course catalog; a local anchor row is created on demand for any Core course the platform has never seen.
- `UNIT_ADMIN` sees courses in their `authorizedUnits` departments.
- `INSTRUCTOR` sees courses where they are a live Core instructor.
- `STUDENT` / `TA` see published courses where they hold a live Core enrollment, with `progress` attached.

**Pagination:** Required. **Search and filters:** `search` (title/code, ≤200 chars), `term` (repeatable `"W1::2026"` keys), `status` (repeatable `published`|`draft`), `progress` (repeatable `not-started`|`in-progress`|`completed`, ignored for roles whose rows carry no progress). Repeated values within one dimension are OR-ed; dimensions are AND-ed against Core, so a filter can only narrow what the caller could already see. When Core is unavailable, these filters resolve to an empty result and the response carries `X-Core-Status: unavailable` rather than a 500 — render that as "search unavailable," not "no matches."

**Response:** `Paginated<Course>`

---

### `GET /api/courses/facets`

Filter options (`terms`, `statuses`, `progress`) for the caller's whole accessible set, not just the loaded page.

**Auth:** Any authenticated user.

**Response:** `{ terms: string[], statuses: string[], progress: string[], coreUnavailable: boolean }`. Fail-soft: returns empty arrays with `X-Core-Status: unavailable` rather than a 500.

---

### `GET /api/courses/:courseId`

Fetch a single course, including the caller's `viewerRole` on it.

**Auth:** Course member (live Core enrollment or instructor), or `ADMIN`/authorized `UNIT_ADMIN`.

**Response:** `Course` with `viewerRole: Role | null` appended — the caller's enrollment/staff role on *this* course.

---

### `POST /api/courses`

**Always returns `403`.** Course creation is owned by EduAI Core (#632) — this route exists only so a legacy client gets an explicit rejection message rather than a 404: `{ "error": "Course creation is managed in EduAI Core. Import or enable courses from Core instead." }`.

**Auth:** `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN` (still gated, even though the body is unconditional).

---

### `PATCH /api/courses/:courseId/publish`

Publish a course, making it visible to enrolled students. Proxies the write to Core (`PATCH {coreOfferingId}/publish`) using the caller's session; the response reflects the write even if Core's confirming re-read fails, in which case `corePublishStale: true` is set on the returned `Course`.

**Auth:** `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN`, course-authorized.

**Response:** `Course`

---

### `PATCH /api/courses/:courseId/unpublish`

Unpublish a course. Publishing is not itself cascading — a course's modules and lessons keep whatever publish state they already had (the frontend surfaces this explicitly: "modules and lessons stay hidden until you publish them individually").

**Auth:** `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN`, course-authorized.

**Response:** `Course`

---

### `POST /api/courses/:courseId/import`

Selectively clone modules or lessons from another course into this one.

**Auth:** `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN`, authorized on both the source and destination course.

**Body:** either `{ "sourceCourseId": number, "moduleIds": number[] }` to clone whole modules, or `{ "lessonIds": number[], "targetModuleId": number }` to clone individual lessons into a chosen destination module. Topics are matched by name during import; missing topics are created automatically.

**Response:** `200`

---

### `GET /api/eduai/courses`

List courses in EduAI Core available to import, minus any already anchored locally.

**Auth:** `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN`.

**Response:** array of Core course objects, passed through as-is.

---

### `POST /api/courses/import-external`

Import a course from Core: creates a `CourseOffering` anchor row keyed on `coreOfferingId`, then syncs topics and enrollments concurrently.

**Auth:** `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN`.

**Body:** `{ "externalCourseId": "string" }`

**Response:** `201 Created` with `Course`

---

### `POST /api/courses/:courseId/sync-enrollments`

Manually re-sync the local `CourseEnrollment` mirror (STUDENT/TA rows only — instructor access is tracked separately via `CourseInstructor`) against Core. Reads happen elsewhere with a 30s auto-sync TTL; this endpoint always hits Core.

**Auth:** `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN`.

**Response:** `200`

---

### `GET /api/courses/:courseId/bank-questions`

List shared Question Bank items (from Core/Question Maker) usable as a starting point when authoring an activity. Excludes long-answer and select-all-that-apply questions, which an activity's single `correctIndex` can't represent.

**Auth:** `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN`.

**Response:** `{ questions: BankQuestion[], hasMore: boolean, nextOffset?: number }`

---

### `GET /api/courses/:courseId/feedback`

List `ActivityFeedback` rows across the course (instructor/TA-facing review surface).

**Auth:** Course-authorized staff (instructor / TA / unit admin / admin — same visibility as submissions and analytics below).

**Query:** `activityId`, `studentId`, `take`, `skip` — all optional.

**Response:** `ActivityFeedbackRow[]`

---

### `GET /api/courses/:courseId/submissions`

List `Submission` rows across the course, with grading UI in mind.

**Auth:** Course-authorized staff. Grading (`PATCH /activities/:activityId/submissions/:submissionId`, documented under Activities) is available to the same staff set.

**Query:** `activityId`, `studentId`, `take`, `skip` — all optional.

**Response:** `SubmissionRow[]`

---

### `GET /api/courses/:courseId/student-metrics`

Per-student rollups (submission/correct/incorrect/help-request counts) across the course.

**Auth:** Course-authorized staff.

**Response:** `StudentMetricRow[]`

---

### `GET /api/courses/:courseId/analytics`

Per-activity analytics (average rating, difficulty score/label, feedback count) across the course.

**Auth:** Course-authorized staff.

**Response:** `ActivityAnalyticsRow[]`

---

### `GET /api/me/dashboard-stats`

Server-computed, role-scoped rollup used by the shared dashboard (course counts, published/draft counts, submissions-to-review, etc.). Optional data source — the frontend falls back to client-derived stats when this call fails.

**Auth:** Any authenticated user; the shape returned depends on role.

**Response:** `DashboardStats` (all fields optional — see `app/lib/api.ts`)

---

## Modules

### `GET /api/courses/:courseId/modules`

List modules for a course. Students/TAs see published modules only, with `progress`.

**Auth:** Course member. **Pagination:** Optional.

**Response:** `Paginated<Module>`

### `GET /api/modules/:moduleId`

**Auth:** Course member. **Response:** `Module`

### `POST /api/courses/:courseId/modules`

**Auth:** `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN`. **Body:** `{ title, description?, position? }`. **Response:** `201` with `Module`

### `PATCH /api/modules/:moduleId/publish`

Publish a module. Requires the parent course to already be published — the API rejects the write otherwise (the client-side `PublishMenu` also disables the control and explains why).

**Auth:** `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN`. **Response:** `Module`

### `PATCH /api/modules/:moduleId/unpublish`

Unpublishing a module cascades to its lessons.

**Auth:** `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN`. **Response:** `Module`

### `PATCH /api/modules/:moduleId`

Update title/description. **Auth:** `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN`. **Response:** `Module`

### `DELETE /api/modules/:moduleId`

Cascades to lessons and activities. **Auth:** `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN`.

### `PATCH /api/modules/:moduleId/position`

See [Move to position](#move-to-position).

### `PUT /api/courses/:courseId/modules/order`

Bulk reorder — see [Ordering and structure](#ordering-and-structure). **Auth:** `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN`.

### `GET /api/modules/:moduleId/context`

See [Structural context](#structural-context).

---

## Lessons

### `GET /api/modules/:moduleId/lessons`

**Auth:** Course member. **Pagination:** Optional. **Response:** `Paginated<Lesson>`

### `GET /api/lessons/:lessonId`

**Auth:** Course member. **Response:** `Lesson`

### `GET /api/lessons/:lessonId/breadcrumb`

See [Structural context](#structural-context).

### `GET /api/lessons/:lessonId/context`

See [Structural context](#structural-context).

### `POST /api/modules/:moduleId/lessons`

**Auth:** `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN`. **Body:** `{ title, contentMd?, position? }`. **Response:** `201` with `Lesson`

### `PATCH /api/lessons/:lessonId/publish`

Requires both the parent module and parent course to already be published.

**Auth:** `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN`. **Response:** `Lesson`

### `PATCH /api/lessons/:lessonId/unpublish`

**Auth:** `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN`. **Response:** `Lesson`

### `PATCH /api/lessons/:lessonId`

Update title/content. **Auth:** `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN`. **Response:** `Lesson`

### `DELETE /api/lessons/:lessonId`

Cascades to activities. **Auth:** `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN`.

### `PATCH /api/lessons/:lessonId/position`

See [Move to position](#move-to-position).

### `PUT /api/modules/:moduleId/lessons/order`

**Auth:** `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN`.

---

## Activities

### `GET /api/lessons/:lessonId/activities`

List activities in a lesson. Students receive a `completionStatus` (`correct` | `incorrect` | `not_attempted`) per activity.

**Auth:** Course member. **Pagination:** Optional. **Response:** `Paginated<Activity>`

### `POST /api/lessons/:lessonId/activities`

Create an activity. Validated against `CreateActivitySchema` (`shared/schemas/activity.js`). At least one of `enableTeachMode` / `enableGuideMode` / `enableCustomMode` must be `true` — the server re-validates this even though the client already enforces it.

**Auth:** `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN`.

**Body (abridged):**

```json
{
  "title": "string (optional internal label)",
  "question": "string (required)",
  "type": "MCQ | SHORT_TEXT",
  "options": { "choices": ["string[] (MCQ, 2-8 choices)"] },
  "answer": { "correctIndex": "number (MCQ)" },
  "hints": ["string[]"],
  "mainTopicId": "string (cuid, required)",
  "secondaryTopicIds": ["string[]"],
  "enableTeachMode": "boolean (default true)",
  "enableGuideMode": "boolean (default true)",
  "enableCustomMode": "boolean (default false)",
  "customPrompt": "string",
  "customPromptTitle": "string (max 20 chars)"
}
```

Topic ids are opaque CUID strings, never numbers — the server schema is `z.array(z.string())`.

**Response:** `201 Created` with `Activity`

### `PATCH /api/activities/:activityId`

Update an activity. All fields optional (`UpdateActivitySchema`).

**Auth:** `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN`. **Response:** `Activity`

### `DELETE /api/activities/:activityId`

**Auth:** `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN`.

### `POST /api/activities/:activityId/duplicate`

Clone an activity within the same lesson, appended after the last activity.

**Auth:** `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN`. **Response:** `Activity`

### `POST /api/lessons/:lessonId/activities/import`

Clone an activity from one of the caller's other lessons/courses into this lesson.

**Auth:** `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN`. **Body:** `{ "sourceActivityId": number }`. **Response:** `Activity`

### `GET /api/activities/importable`

Search candidates for the import dialog above — spans every course the caller manages, not just the current one.

**Auth:** `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN`. **Pagination:** Required. **Response:** `Paginated<ImportableActivity>`

### `PATCH /api/activities/:activityId/position`

See [Move to position](#move-to-position).

### `PUT /api/lessons/:lessonId/activities/order`

**Auth:** `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN`.

### `POST /api/questions/:id/answer`

Submit an answer attempt.

**Auth:** Enrolled `STUDENT` only — the platform role must be `STUDENT` *and* the caller's live Core enrollment role on this specific course must be `STUDENT` (a course `TA` is rejected with `403`, even though `TA` has read access to the lesson). The activity's course, parent module, and parent lesson must all be published, or the request 403s. The server uses the authenticated user's id for identity; any `userId` in the request body is ignored.

**Body:** `{ "answerOption": "number (MCQ, zero-based)" }` or `{ "answerText": "string (SHORT_TEXT)" }`. (The frontend also sends a `userId` field for backward compatibility; it is not read.)

**Response:**

```json
{
  "ok": true,
  "isCorrect": "boolean | null",
  "message": "string",
  "submissionId": "number",
  "feedbackRequired": "boolean",
  "feedbackAlreadySubmitted": "boolean"
}
```

### `POST /api/activities/:activityId/teach`

AI Teach-mode chat turn. Uses the `learning-prompt` template. See [`two-agent-supervisor-system.md`](two-agent-supervisor-system.md) for the full tutor/supervisor pipeline this and the next two endpoints funnel through.

**Auth:** Same STUDENT-in-this-course gate as answer submission. Requires `activity.enableTeachMode`, else `400`. Requires the activity's course/module/lesson to be published, else `403`.

**Body (`TeachRequestSchema`):**

```json
{
  "knowledgeLevel": "beginner | intermediate | advanced",
  "topicId": "string (optional, defaults to the activity's mainTopic)",
  "message": "string (required)",
  "modelId": "string (e.g. 'google:gemini-2.5-flash')",
  "apiKey": "string (optional — the selected model's provider key)",
  "apiKeys": "{ [provider]: string } (optional — every BYOK key the caller holds, for fleet-down fallback)",
  "chatId": "string | null (for conversation continuity)",
  "messageId": "string"
}
```

**Response:** `{ message: string, chatId: string }`

### `POST /api/activities/:activityId/guide`

AI Guide-mode chat turn (Socratic hints). Uses the `exercise-prompt` template — includes the question, options, and the student's current answer attempt in context.

**Auth / body:** Same as `teach`, plus `studentAnswer` (optional, no `topicId`). Requires `activity.enableGuideMode`.

### `POST /api/activities/:activityId/custom`

AI Custom-mode chat turn, using the activity's own `customPrompt` field. Requires `activity.enableCustomMode` **and** a non-empty `customPrompt`, else `400`.

**Auth / body:** Same as `guide`, plus `topicId` (like `teach`).

### `GET /api/activities/:activityId/submissions`

List every submission for one activity (grading queue view).

**Auth:** Course-authorized staff. **Response:** `SubmissionRow[]`

### `PATCH /api/activities/:activityId/submissions/:submissionId`

Instructor grade override.

**Auth:** Course-authorized staff. **Body:** `{ "score"?: number | null, "isCorrect"?: boolean | null }` — both fields are always sent by the client (an explicit `null` clears the stored value; omitting a field leaves it unchanged; sending neither 400s with "nothing to update"). **Response:** the updated `SubmissionRow`.

### `GET /api/activities/:activityId/feedback`

List feedback rows for one activity. **Auth:** Course-authorized staff.

### `POST /api/activities/:activityId/feedback`

Submit a 1–5 difficulty rating plus an optional note, once per (user, activity) — recalculates `ActivityAnalytics.difficultyScore`/`difficultyLabel`.

**Auth:** `STUDENT`. **Body:** `{ "rating": "number (1-5)", "note"?: "string" }`. **Response:** `{ ok: true, feedback: { id, rating, note, createdAt } }`

### `GET /api/me/submissions`

The caller's own submission history. **Auth:** Any authenticated user (used by `STUDENT`/`TA`).

### `GET /api/me/feedback`

The caller's own submitted feedback rows.

### `GET /api/activities/:activityId/chat-sessions`

List the caller's saved AI-chat sessions for one activity (chat history panel).

**Auth:** Any authenticated user (server-side, only the session owner's rows are ever returned).

### `GET /api/activities/:activityId/chat-sessions/:chatId/messages`

Restore one saved chat session's message transcript, proxied from Core (`chatId` must belong to an `AiChatSession` owned by the caller for this activity — otherwise `404`).

---

## Topics

### `GET /api/courses/:courseId/topics`

List topics for a course. For an imported (Core-linked) course, this auto-syncs from Core on every read.

**Auth:** Course member. **Pagination:** Optional. **Response:** `Paginated<Topic>`

### `POST /api/courses/:courseId/topics`

Create a topic manually. Blocked for imported courses (topics there are managed via sync).

**Auth:** `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN`. **Body:** `{ "name": "string" }`. **Response:** `201` with `Topic`

### `POST /api/courses/:courseId/topics/sync`

**No UI caller** (`GET /api/courses/:courseId/topics` auto-syncs on read; kept for API compatibility). Sync topics from Core, creating any missing locally.

**Auth:** `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN`. **Response:** `{ topics: Topic[], missingTopics: Topic[] }`

### `POST /api/courses/:courseId/topics/remap`

**No UI caller.** Remap activities from one topic to another, then delete the source topic, in a transaction.

**Auth:** `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN`. **Body:** `{ "mappings": [{ "fromTopicId": "string", "toTopicId": "string" }] }`. **Response:** `200`

---

## Prompts

### `GET /api/prompts`

List every `PromptTemplate` row.

**Auth:** `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN`.

### `POST /api/prompts`

Create a prompt template; a unique slug is derived from `name`.

**Auth:** `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN`. **Body:** `{ name, systemPrompt, temperature?, topP? }`. **Response:** `201` with `PromptTemplate`

---

## Suggested prompts

### `GET /api/suggested-prompts`

Active suggested prompts (chat composer quick-picks), grouped by mode.

**Auth:** Any authenticated user. **Response:** `SuggestedPrompt[]` — `{ id, mode: "teach" | "guide", text }`

---

## AI models

### `GET /api/ai-models`

List tutor-eligible AI models for the current user.

**Auth:** Any authenticated user. `INSTRUCTOR` / `UNIT_ADMIN` / `ADMIN` see every catalog model (with `availability` annotated); every other role (including `TA` and an unrecognized role) is filtered down to the admin policy's `allowedTutorModelIds` — an allow-list, not a role deny-list, so an unrecognized role fails closed.

**Response:** `AiModel[]` — `{ id, modelId, modelName, provider, summary, costTier, studentSelectable, availability: "allowed" | "admin-only", isDefaultTutor }`

### `POST /api/ai-models/validate-key`

Validate a BYOK provider key with a lightweight provider probe. Always answers `200` with `{ valid, error? }` for a normal provider rejection; only a genuine network/timeout failure returns a non-2xx.

**Auth:** Any authenticated user (rate-limited per user: 10 attempts / 60s window, 2 concurrent). **Body:** `{ "provider": "google" | "openai" | "opencode", "apiKey": "string" }`.

---

## AI status

### `GET /api/ai-status`

Proxies Core's own `/api/ai-status` probe (cloud + UBC-hosted fleet health) for the header status chips. Falls back to `{ state: "unknown" }` for both services on any failure — never a 500.

**Auth:** Any authenticated user (exempt from the admin-isolation gate).

**Response:** `{ cloud: ServiceStatus, ubc: ServiceStatus }`

---

## Admin

Every route below requires `role === 'ADMIN'` unless noted.

### `GET /api/admin/users`

List platform users (proxied from Core, paginated).

**Response:** `AdminUserPage` — `{ data: AdminUser[], total, page, pageSize, stats: { total, active, byRole } }`

### `PATCH /api/admin/users/:userId/role`

**Status: not implemented locally** — user role management lives in EduAI Core.

### `GET /api/admin/courses`

List every course offering (materializes a local anchor for any Core course not yet anchored).

**Pagination:** Required. **Response:** `Paginated<Course>`

### `GET /api/admin/courses/:courseId/enrollments`

List enrolled + available (non-enrolled) students for a course.

**Auth:** `ADMIN` / `UNIT_ADMIN` / `INSTRUCTOR` (course-authorized).

**Response:** `{ courseId, enrolledStudents: EnrolledStudent[], availableStudents: AdminUser[], availableStudentsPage: { total, page, pageSize } }`

### `POST /api/admin/courses/:courseId/enrollments`

Enroll a student (creates the enrollment in Core, then mirrors it locally).

**Auth:** `ADMIN` / `UNIT_ADMIN` / `INSTRUCTOR` (course-authorized). **Body:** `{ "userId": "string" }`.

### `DELETE /api/admin/courses/:courseId/enrollments/:userId`

**Auth:** `ADMIN` / `UNIT_ADMIN` / `INSTRUCTOR` (course-authorized).

### `PATCH /api/admin/courses/:courseId/enrollments/:userId/role`

Change a student's course-scoped enrollment role (e.g. promote to `TA`).

**Auth:** `ADMIN` / `UNIT_ADMIN` / `INSTRUCTOR` (course-authorized). **Body:** `{ "role": "STUDENT" | "TA" | "INSTRUCTOR" }`. **Response:** `{ ok: true, role }`

### `POST /api/admin/courses/:courseId/sync-enrollments`

Admin-triggered enrollment sync (see the course-scoped version under [Courses](#post-apicoursescourseidsync-enrollments), which any course-authorized staff role may also call).

### `GET /api/admin/settings/eduai-api-key`

**Response:** `{ configured, source: "ADMIN" | "ENV" | "NONE", hasAdminOverride, envConfigured, updatedAt }`

### `PUT /api/admin/settings/eduai-api-key`

Set a DB-stored override for the EduAI/Core service key (encrypted at rest when `ENCRYPTION_KEY` is configured; stored in plaintext with a warning otherwise, outside production). **Body:** `{ "apiKey": "string" }`.

### `DELETE /api/admin/settings/eduai-api-key`

Clear the override, falling back to the `EDUAI_API_KEY` environment variable.

### `GET /api/admin/settings/ai-model-policy`

**Response:** `{ allowedTutorModelIds, defaultTutorModelId, defaultSupervisorModelId, dualLoopEnabled, maxSupervisorIterations }` — see [`two-agent-supervisor-system.md`](two-agent-supervisor-system.md).

### `PUT /api/admin/settings/ai-model-policy`

Update the policy. Rejects (plain `400`-mapped `Error`) an empty allow-list, a default tutor model not in the allow-list, or a supervisor model not in the live catalog.

### `GET /api/admin/ai-traces`

List recent `AiInteractionTrace` rows for the AI-oversight dashboard.

**Auth:** `ADMIN` / `UNIT_ADMIN`. **Query:** `unit`, `courseId`, `limit` — all optional. **Response:** `AiTraceRow[]`

---

## Bug reports

### `POST /api/bug-reports`

Submit a bug report with captured diagnostic context.

**Auth:** Any authenticated user.

**Body:** `{ description (10-2000 chars), bugType?, isAnonymous, consoleLogs, networkLogs, screenshot?, pageUrl, userAgent, context?: { courseOfferingId?, moduleId?, lessonId?, activityId? } }`

**Response:** `201` with `{ ok: true }`

### `GET /api/admin/bug-reports`

List reports (respects anonymity; list rows omit body-heavy fields, replaced with `has*` booleans).

**Auth:** `ADMIN`. **Response:** `AdminBugReportRow[]`

### `GET /api/admin/bug-reports/:bugReportId`

Full detail for one report, including the console/network/screenshot bodies omitted from the list.

**Auth:** `ADMIN`.

### `PATCH /api/admin/bug-reports/:bugReportId`

**Auth:** `ADMIN`. **Body:** `{ "status": "unhandled" | "in progress" | "resolved" }`. **Response:** `{ id, status }` (only the two changed fields — callers spread-merge onto their existing row).

---

## Internal (service-to-service only)

Not reachable by browser clients — gated by `requireServiceKey` (`Authorization: Bearer <EDUAI_API_KEY>`) instead of the session-cookie `requireAuth`, and exempt from every other `/api` gate.

### `DELETE /api/internal/courses/:coreOfferingId`

Cascade-deletes the local `CourseOffering` mirror (and everything under it — modules, lessons, activities, submissions, chat sessions, enrollments) when Core deletes the source course. Idempotent: `200` with `{ success: true, deleted: false }` when no matching local anchor exists.

---

## Shared validation schemas

| Schema | Location | Used by |
| --- | --- | --- |
| `CreateActivitySchema` | `shared/schemas/activity.js` | `POST /lessons/:id/activities` |
| `UpdateActivitySchema` | `shared/schemas/activity.js` | `PATCH /activities/:id` |
| `TeachRequestSchema` | `shared/schemas/aiGuidance.js` | `POST /activities/:id/teach` |
| `GuideRequestSchema` | `shared/schemas/aiGuidance.js` | `POST /activities/:id/guide` |
| `CustomRequestSchema` | `shared/schemas/aiGuidance.js` | `POST /activities/:id/custom` |
| `ActivityFeedbackRequestSchema` | `shared/schemas/aiGuidance.js` | `POST /activities/:id/feedback` |
| `AiProviderKeySchema` | `shared/schemas/aiProviderKey.js` | `POST /ai-models/validate-key` |
| `BugReportCreateSchema`, `BugReportStatusUpdateSchema` | `shared/schemas/mutations.js` | `POST /bug-reports`, `PATCH /admin/bug-reports/:id` |
