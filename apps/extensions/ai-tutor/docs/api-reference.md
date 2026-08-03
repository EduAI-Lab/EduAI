# API Reference

Complete endpoint reference for the AiTutor backend API. All routes are mounted under `/api`.

## Authentication

All endpoints require an authenticated session (Better Auth cookie) unless noted otherwise. Requests must include `credentials: "include"` for cookie transmission.

**Error responses:**
- `401 Unauthorized` — No valid session.
- `403 Forbidden` — Insufficient role or not a course member.

---

## Pagination

List endpoints return the platform pagination envelope (#1043), matching EduAI Core's contract (#1041), rather than a bare array:

```json
{
  "data": [],
  "total": 0,
  "page": 1,
  "pageSize": 25
}
```

`total` is the full count matching the query, **not** the length of `data`. Clients must treat a short `data` as one page — not the whole set — and read `total` for counts, "select all", or any tree/ordinal derivation.

**Query params:** `page` (1-based) and `pageSize`.

- `page` clamps to `1..1000000` (`MAX_PAGE`).
- `pageSize` clamps to `1..200` (`MAX_PAGE_SIZE`).
- Fractional values are floored.

**Two parsing modes.** They differ only on *absent* params; a param that is present but unparseable is a `400` in both, so the same malformed input never gets two different answers depending on the endpoint.

| Mode | Endpoints | Params absent |
| --- | --- | --- |
| **Required** | `GET /api/courses`, `GET /api/admin/courses`, `GET /api/activities/importable` | `400 PAGINATION_REQUIRED` |
| **Optional** | `GET /api/courses/:courseId/modules`, `GET /api/modules/:moduleId/lessons`, `GET /api/lessons/:lessonId/activities`, `GET /api/courses/:courseId/topics` | Defaults to page 1, `pageSize` 200 |

Reordering and ordinals for these endpoints are documented under [Ordering and structure](#ordering-and-structure).

The optional-mode ("tree") endpoints keep a large default page for callers that don't drive a pager (breadcrumb lookups, dropdown feeds). Their UI readers now page for real (#1207): reorder goes through `PATCH .../position` with an absolute ordinal, ordinals come from the context endpoints below, and the lesson player appends pages as the student advances — so none of them needs the whole set any more.

### Search

Every list endpoint above accepts an optional `search` query param (#1207). Filtering happens **server-side, in SQL**: the term is ANDed onto the endpoint's existing visibility scope, and the same `where` feeds both the count and the page — so `total` is the count of *matching* rows and a pager built on it pages the filtered set.

| Endpoint | Matched against |
| --- | --- |
| `GET /api/courses/:courseId/modules` | `title`, `description` |
| `GET /api/modules/:moduleId/lessons` | `title` |
| `GET /api/lessons/:lessonId/activities` | `title`, `instructionsMd`, `config.question` |
| `GET /api/courses/:courseId/topics` | `name` |
| `GET /api/activities/importable` | the above, plus the parent lesson and module titles |

Matching is case-insensitive on ordinary columns. An activity's question text lives in the `config` JSON rather than a column, so it is matched with a JSON path filter, which Prisma cannot make case-insensitive; the term is tried as typed, lower-cased, and upper-cased to compensate.

An absent, empty, or whitespace-only `search` means "no filter". Because search is applied server-side, clients **must not** filter the returned page again — doing so is what made a match on page 2 render as "no results" while the pager reported a non-zero total.

**Pagination errors:**
- `400 PAGINATION_REQUIRED` — a required-mode endpoint was called without both `page` and `pageSize`.
- `400 PAGINATION_INVALID` — `page` or `pageSize` was supplied but is not a finite number.
- `400 SEARCH_INVALID` — `search` was repeated (parsed as an array) or exceeds 100 characters.

All are shaped `{ error: string, code: string }`.

**Ordering.** Every paginated query carries a unique tie-break (`id`) as its final sort key, so tied rows can't shift between pages and be duplicated or skipped.

---

## Ordering and structure

The ordered tree levels (modules, lessons, activities) sort by `position asc, id asc`. `position` has no unique constraint and is not guaranteed contiguous — `POST` appends with `last.position + 1` and deletions leave gaps — so it is a sort key, **not** a rank.

### Move to position

```
PATCH /api/modules/:moduleId/position
PATCH /api/lessons/:lessonId/position
PATCH /api/activities/:activityId/position
```

Body: `{ "position": <0-based ordinal> }`. Response: `{ <module|lesson|activity>, position, total }`.

Auth: course instructor / unit-admin / admin.

`position` is an **ordinal** — an index into the ordered sibling list — not a raw `position` column value. The server resolves it against the actual ordering and rewrites only the rows whose index changed, leaving the siblings contiguous.

Added in #1207 so a paged client can reorder without holding every sibling: a drag on page 3 sends `(page - 1) * pageSize + dropIndex`, and a "Move to position…" prompt sends a typed ordinal directly. An out-of-range ordinal is **clamped** rather than rejected (a concurrent delete shouldn't turn a legitimate drag into an error), so callers should trust the returned `position` over their own optimistic guess.

- `400 POSITION_INVALID` — `position` is missing, non-integer, or negative.
- `404` — the row does not exist, or is not part of the list it was resolved against.

The bulk `PUT .../order` endpoints remain for the single-page case. They still require `orderedIds` to be the complete sibling set and `400` otherwise — the server-side backstop against a caller holding one page reassigning `0..n-1` over the whole list.

### Structural context

```
GET /api/modules/:moduleId/context  -> { moduleOrdinal, moduleTotal }
GET /api/lessons/:lessonId/context  -> { moduleOrdinal, lessonOrdinal, moduleTotal,
                                         lessonTotal, prevLessonId, nextLessonId }
```

All ordinals are 1-based. These exist (#1207) because clients used to derive them with `findIndex` over a full sibling list — a read that silently produced a wrong ordinal (or `-1`, rendering as "0") for anything past the first page. Counting the rows that sort before the target is exact at any tree size.

Visibility matches the list endpoints: a student's ordinals and totals count only published siblings, so the numbering agrees with the tree they can actually navigate. `403` if the caller can't see the row; `404` if it doesn't exist.

---

## System

### `GET /api/health`

Database liveness probe. No auth required.

**Response:** `200` with `{ status: "ok" }` or `503` on DB failure.

---

## Identity

### `GET /api/me`

Returns the current authenticated user.

**Auth:** Any authenticated user.

**Response:**
```json
{
  "user": {
    "id": "cuid",
    "name": "string",
    "email": "string",
    "role": "STUDENT | PROFESSOR | TA | ADMIN",
    "emailVerified": "boolean",
    "image": "string | null",
    "createdAt": "ISO 8601"
  }
}
```

Returns `401` if no valid session.

---

## Courses

### `GET /api/courses`

List courses for the current user.

**Auth:** PROFESSOR or STUDENT.

**Behavior:**
- Professors see all courses where they are an instructor.
- Students see published courses where they are enrolled, with progress data.

**Pagination:** Required — see [Pagination](#pagination). `page` and `pageSize` are both mandatory; omitting either returns `400 PAGINATION_REQUIRED`.

**Response:** `Paginated<Course>` — `{ data: Course[], total, page, pageSize }`

---

### `GET /api/courses/:courseId`

Fetch a single course.

**Auth:** Course member (enrolled student or assigned instructor).

**Response:** `Course`

---

### `POST /api/courses`

Create a new course.

**Auth:** PROFESSOR.

**Body:**
```json
{
  "title": "string (required)",
  "description": "string",
  "sourceCourseId": "number (clone from existing course)",
  "startDate": "ISO 8601",
  "endDate": "ISO 8601"
}
```

The creating professor is automatically assigned as `LEAD` instructor. If `sourceCourseId` is provided, the source course's modules, lessons, activities, and topics are deep-cloned into the new course.

**Response:** `201 Created` with `Course`

---

### `PATCH /api/courses/:courseId/publish`

Publish a course, making it visible to enrolled students.

**Auth:** PROFESSOR (course instructor).

**Response:** `Course`

---

### `PATCH /api/courses/:courseId/unpublish`

Unpublish a course. Cascades to all modules and their lessons.

**Auth:** PROFESSOR (course instructor).

**Response:** `Course`

---

### `POST /api/courses/:courseId/import`

Import modules or lessons from another course.

**Auth:** PROFESSOR (instructor of both source and target courses).

**Body:**
```json
{
  "sourceCourseId": "number",
  "moduleIds": ["number[]"],
  "lessonIds": ["number[]"],
  "targetModuleId": "number (required when importing lessons)"
}
```

Topics are matched by name during import; missing topics are created automatically.

**Response:** `200`

---

### `GET /api/eduai/courses`

List importable courses from the EduAI platform.

**Auth:** PROFESSOR.

**Behavior:** Returns the caller's Core-scoped course descriptors (raw Core `GET /api/courses` shape) minus any course already anchored in AI Tutor.

**Response:** array of Core course objects (`{ id, name, code, term, year, department, isPublished, ... }`) — the local `EduAiCourse` type was removed with the anchor refactor (#1072); Core's course payload is passed through as-is.

---

### `POST /api/courses/import-external`

Import a course from the EduAI platform.

**Auth:** PROFESSOR.

**Body:**
```json
{
  "externalCourseId": "string"
}
```

Creates a `CourseOffering` anchor row (`coreOfferingId` set to the EduAI course id), then syncs topics and student enrollments from EduAI concurrently.

**Response:** `201 Created` with `Course`

---

## Modules

### `GET /api/courses/:courseId/modules`

List modules for a course.

**Auth:** Course member.

**Behavior:** Students see published modules only, with progress data.

**Pagination:** Optional — see [Pagination](#pagination). Defaults to page 1 at `pageSize` 200 when omitted.

**Response:** `Paginated<Module>` — `{ data: Module[], total, page, pageSize }`

---

### `GET /api/modules/:moduleId`

Fetch a single module.

**Auth:** Course member.

**Response:** `Module`

---

### `POST /api/courses/:courseId/modules`

Create a module.

**Auth:** PROFESSOR (course instructor).

**Body:**
```json
{
  "title": "string (required)",
  "description": "string",
  "position": "number"
}
```

**Response:** `201 Created` with `Module`

---

### `PATCH /api/modules/:moduleId/publish`

Publish a module. Requires the parent course to be published.

**Auth:** PROFESSOR (course instructor).

**Response:** `Module`

---

### `PATCH /api/modules/:moduleId/unpublish`

Unpublish a module. Cascades to all its lessons.

**Auth:** PROFESSOR (course instructor).

**Response:** `Module`

---

## Lessons

### `GET /api/modules/:moduleId/lessons`

List lessons for a module.

**Auth:** Course member.

**Behavior:** Students see published lessons only, with progress data.

**Pagination:** Optional — see [Pagination](#pagination). Defaults to page 1 at `pageSize` 200 when omitted.

**Response:** `Paginated<Lesson>` — `{ data: Lesson[], total, page, pageSize }`

---

### `GET /api/lessons/:lessonId`

Fetch a single lesson.

**Auth:** Course member.

**Response:** `Lesson`

---

### `POST /api/modules/:moduleId/lessons`

Create a lesson.

**Auth:** PROFESSOR (course instructor).

**Body:**
```json
{
  "title": "string (required)",
  "contentMd": "string (Markdown)",
  "position": "number"
}
```

**Response:** `201 Created` with `Lesson`

---

### `PATCH /api/lessons/:lessonId/publish`

Publish a lesson. Requires both the parent module and course to be published.

**Auth:** PROFESSOR (course instructor).

**Response:** `Lesson`

---

### `PATCH /api/lessons/:lessonId/unpublish`

Unpublish a lesson.

**Auth:** PROFESSOR (course instructor).

**Response:** `Lesson`

---

## Activities

### `GET /api/lessons/:lessonId/activities`

List activities for a lesson.

**Auth:** Course member.

**Behavior:** Students receive completion status (`correct`, `incorrect`, `not_attempted`) per activity.

**Pagination:** Optional — see [Pagination](#pagination). Defaults to page 1 at `pageSize` 200 when omitted.

**Response:** `Paginated<Activity>` — `{ data: Activity[], total, page, pageSize }`

---

### `POST /api/lessons/:lessonId/activities`

Create an activity. Validated against `CreateActivitySchema` from `shared/schemas/activity.js`.

**Auth:** PROFESSOR (course instructor).

**Body:**
```json
{
  "title": "string (required)",
  "question": "string (required)",
  "questionType": "MCQ | SHORT_TEXT",
  "instructionsMd": "string",
  "options": ["string[] (required for MCQ, 2-6 choices)"],
  "answer": {
    "correctIndex": "number (for MCQ)",
    "text": "string (for SHORT_TEXT)"
  },
  "hints": ["string[]"],
  "mainTopicId": "number (required)",
  "secondaryTopicIds": ["number[]"],
  "promptTemplateId": "number",
  "customPrompt": "string",
  "customPromptTitle": "string (max 20 chars)",
  "enableTeachMode": "boolean (default true)",
  "enableGuideMode": "boolean (default true)",
  "enableCustomMode": "boolean (default false)",
  "position": "number"
}
```

**Response:** `201 Created` with `Activity`

---

### `PATCH /api/activities/:activityId`

Update an activity. Validated against `UpdateActivitySchema` (all fields optional).

**Auth:** PROFESSOR (course instructor).

**Response:** `Activity`

---

### `DELETE /api/activities/:activityId`

Delete an activity.

**Auth:** PROFESSOR (course instructor).

**Response:** `204 No Content`

---

### `POST /api/questions/:id/answer`

Submit an answer attempt for an activity.

**Auth:** Enrolled student only — platform role must be STUDENT and course enrollment role must be STUDENT. The server uses the authenticated user for identity; any client-supplied `userId` in the request body is ignored.

**Body:**
```json
{
  "userId": "string",
  "answerOption": "number (for MCQ, zero-based index)",
  "answerText": "string (for SHORT_TEXT)"
}
```

Creates a `Submission` record, evaluates correctness, updates `ActivityStudentMetric` and `ActivityAnalytics`.

**Response:**
```json
{
  "isCorrect": "boolean",
  "feedbackRequired": "boolean",
  "feedbackAlreadySubmitted": "boolean"
}
```

---

### `POST /api/activities/:activityId/teach`

AI Teach mode chat. Uses the `learning-prompt` template.

**Auth:** Course member.

**Body:**
```json
{
  "knowledgeLevel": "beginner | intermediate | advanced",
  "topicId": "number (optional, defaults to mainTopic)",
  "message": "string (required)",
  "modelId": "string (e.g. 'google:gemini-2.5-flash')",
  "apiKey": "string (provider API key)",
  "chatId": "string (for conversation continuity)",
  "messageId": "string"
}
```

**Response:** AI-generated text response with `chatId` for session continuity.

---

### `POST /api/activities/:activityId/guide`

AI Guide mode chat. Uses the `exercise-prompt` template. Includes the question, options, and student answer in context.

**Auth:** Course member.

**Body:** Same as teach, plus:
```json
{
  "studentAnswer": "string (optional, current answer attempt)"
}
```

---

### `POST /api/activities/:activityId/custom`

AI Custom mode chat. Uses the activity's `customPrompt` field. Requires `enableCustomMode` to be true on the activity.

**Auth:** Course member.

**Body:** Same as guide.

---

### `POST /api/activities/:activityId/feedback`

Submit activity feedback (difficulty rating).

**Auth:** STUDENT (enrolled in the course).

**Body:**
```json
{
  "rating": "number (1-5)",
  "note": "string (optional, max 500 chars)"
}
```

One feedback per user per activity (unique constraint). Triggers recalculation of `ActivityAnalytics` including difficulty score.

**Response:**
```json
{
  "id": "number",
  "rating": "number",
  "note": "string | null",
  "createdAt": "ISO 8601"
}
```

---

## Topics

### `GET /api/courses/:courseId/topics`

List topics for a course.

**Auth:** Course member (enrolled student or instructor).

**Pagination:** Optional — see [Pagination](#pagination). Defaults to page 1 at `pageSize` 200 when omitted.

**Response:** `Paginated<Topic>` — `{ data: Topic[], total, page, pageSize }`

---

### `POST /api/courses/:courseId/topics`

Create a new topic. Blocked for imported EduAI courses (those are managed via sync).

**Auth:** PROFESSOR (course instructor).

**Body:**
```json
{
  "name": "string (required)"
}
```

**Response:** `201 Created` with `Topic`

---

### `POST /api/courses/:courseId/topics/sync`

**Deprecated (#1031):** `GET /api/courses/:courseId/topics` now auto-syncs imported courses on every read; no UI surface calls this endpoint anymore. Kept for API compatibility.

Sync topics from EduAI for an imported course. Creates local topics for any upstream topics not yet present. Returns information about local topics missing from upstream for remapping.

**Auth:** PROFESSOR (course instructor).

**Response:**
```json
{
  "topics": "Topic[]",
  "missingTopics": "Topic[] (local topics not found upstream)"
}
```

---

### `POST /api/courses/:courseId/topics/remap`

**Deprecated (#1031):** the only UI caller (`TopicSyncMappingDialog`) was removed along with the "Sync now" button. Kept for API compatibility — an admin can still call this directly to consolidate local topics that have drifted from upstream, since nothing in the UI surfaces `missingTopics` anymore.

Remap activities from one topic to another, then delete the source topic. Handles both `mainTopic` and `secondaryTopics` reassignment in a transaction.

**Auth:** PROFESSOR (course instructor).

**Body:**
```json
{
  "mappings": [
    {
      "fromTopicId": "number",
      "toTopicId": "number"
    }
  ]
}
```

**Response:** `200`

---

## Prompts

### `GET /api/prompts`

List all prompt templates.

**Auth:** PROFESSOR.

**Response:** `PromptTemplate[]`

---

### `POST /api/prompts`

Create a new prompt template. A unique slug is auto-generated from the name.

**Auth:** PROFESSOR.

**Body:**
```json
{
  "name": "string (required)",
  "systemPrompt": "string (required)",
  "temperature": "number (0-2)",
  "topP": "number (0-1)"
}
```

**Response:** `201 Created` with `PromptTemplate`

---

## Suggested Prompts

### `GET /api/suggested-prompts`

List active suggested prompts, grouped by mode.

**Auth:** Any authenticated user.

**Response:** `SuggestedPrompt[]` with fields: `id`, `mode` (teach/guide), `text`, `position`, `isActive`.

---

## AI Models

### `GET /api/ai-models`

List available AI models.

**Auth:** Any authenticated user.

**Behavior:** Students see only models allowed by the admin AI model policy. Instructors and admins see all models.

**Response:** `AiModel[]` with fields: `id`, `modelId`, `modelName`, `provider`, `summary`, `costTier`, `roleHint`, `studentSelectable` (whether the AI model policy allows this model for students), `availability` (`allowed` | `admin-only`), `isDefaultTutor` (true on the one model the admin AI model policy designates as the tutor default — clients should read this instead of hardcoding a model id).

---

### `POST /api/ai-models/validate-key`

Validate a provider API key against the provider's lightweight model-listing endpoint.

**Auth:** Any authenticated user.

**Body:**
```json
{
  "provider": "google | openai",
  "apiKey": "string"
}
```

**Response:**
```json
{
  "valid": "boolean",
  "error": "string (if invalid)"
}
```

---

## Admin

All admin endpoints require `role === 'ADMIN'`.

### `GET /api/admin/users`

List all users in the system.

**Response:** `AdminUser[]` with fields: `id`, `name`, `email`, `role`, `createdAt`.

---

### `PATCH /api/admin/users/:userId/role`

**Status: 410 Gone.** Role changes are now managed in EduAI.

---

### `GET /api/admin/courses`

List all course offerings.

**Pagination:** Required — see [Pagination](#pagination). `page` and `pageSize` are both mandatory; omitting either returns `400 PAGINATION_REQUIRED`.

**Response:** `Paginated<Course>` — `{ data: Course[], total, page, pageSize }`

---

### `GET /api/admin/courses/:courseId/enrollments`

List enrolled students and available (non-enrolled) students for a course.

**Response:**
```json
{
  "enrolled": "AdminUser[]",
  "available": "AdminUser[]"
}
```

---

### `POST /api/admin/courses/:courseId/enrollments`

Enroll a student in a course.

**Body:**
```json
{
  "userId": "string"
}
```

**Response:** `{ "ok": true }`

---

### `DELETE /api/admin/courses/:courseId/enrollments/:userId`

Remove a student's enrollment from a course.

**Response:** `{ "ok": true }`

---

### `POST /api/admin/courses/:courseId/sync-enrollments`

Manually sync enrollments from EduAI for an imported course. Creates local users and Better Auth accounts for new external students.

**Auth:** ADMIN.

**Response:** `200`

---

### `GET /api/admin/settings/eduai-api-key`

Get EduAI API key configuration status.

**Response:**
```json
{
  "configured": "boolean",
  "source": "ENV | ADMIN | NONE"
}
```

---

### `PUT /api/admin/settings/eduai-api-key`

Set a database override for the EduAI API key.

**Body:**
```json
{
  "apiKey": "string"
}
```

**Response:** `EduAiApiKeyStatus`

---

### `DELETE /api/admin/settings/eduai-api-key`

Remove the admin override, falling back to the `EDUAI_API_KEY` environment variable.

**Response:** `EduAiApiKeyStatus`

---

### `GET /api/admin/settings/ai-model-policy`

Get the current AI model policy.

**Response:**
```json
{
  "allowedTutorModels": ["string[]"],
  "defaultTutorModel": "string",
  "defaultSupervisorModel": "string",
  "dualLoopEnabled": "boolean",
  "maxSupervisorIterations": "number (1-5)"
}
```

---

### `PUT /api/admin/settings/ai-model-policy`

Update the AI model policy.

**Body:** Same shape as the GET response.

**Response:** `AdminAiModelPolicy`

---

## Bug Reports

### `POST /api/bug-reports`

Create a bug report with diagnostic context.

**Auth:** STUDENT or PROFESSOR.

**Body:**
```json
{
  "description": "string (required)",
  "isAnonymous": "boolean (default false)",
  "consoleLogs": "string",
  "networkLogs": "string",
  "screenshot": "string (base64)",
  "pageUrl": "string",
  "userAgent": "string",
  "courseOfferingId": "number",
  "moduleId": "number",
  "lessonId": "number",
  "activityId": "number"
}
```

**Response:**
```json
{
  "id": "string (cuid)",
  "status": "unhandled",
  "createdAt": "ISO 8601"
}
```

---

### `GET /api/admin/bug-reports`

List all bug reports with user info and context details.

**Auth:** ADMIN.

**Response:** `AdminBugReportRow[]` with reporter info (respects anonymity), context titles, diagnostics, and status.

---

### `PATCH /api/admin/bug-reports/:bugReportId`

Update a bug report's status.

**Auth:** ADMIN.

**Body:**
```json
{
  "status": "unhandled | in_progress | resolved"
}
```

**Response:** `AdminBugReportRow`

---

## Shared Validation Schemas

Request bodies for activities and AI chat are validated using Zod schemas shared between frontend and backend:

| Schema | Location | Used By |
|--------|----------|---------|
| `CreateActivitySchema` | `shared/schemas/activity.js` | `POST /lessons/:id/activities` |
| `UpdateActivitySchema` | `shared/schemas/activity.js` | `PATCH /activities/:id` |
| `TeachRequestSchema` | `shared/schemas/aiGuidance.js` | `POST /activities/:id/teach` |
| `GuideRequestSchema` | `shared/schemas/aiGuidance.js` | `POST /activities/:id/guide` |
| `CustomRequestSchema` | `shared/schemas/aiGuidance.js` | `POST /activities/:id/custom` |
| `ActivityFeedbackRequestSchema` | `shared/schemas/aiGuidance.js` | `POST /activities/:id/feedback` |
