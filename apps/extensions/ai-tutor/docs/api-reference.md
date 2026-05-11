# API Reference

Complete endpoint reference for the AiTutor backend API. All routes are mounted under `/api`.

## Authentication

All endpoints require an authenticated session (Better Auth cookie) unless noted otherwise. Requests must include `credentials: "include"` for cookie transmission.

**Error responses:**
- `401 Unauthorized` — No valid session.
- `403 Forbidden` — Insufficient role or not a course member.

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

**Response:** `Course[]`

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

### `PATCH /api/courses/:courseId`

Update course metadata.

**Auth:** PROFESSOR (course instructor).

**Body:**
```json
{
  "title": "string",
  "description": "string",
  "startDate": "ISO 8601",
  "endDate": "ISO 8601"
}
```

**Response:** `Course`

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

**Behavior:** Returns courses from EduAI that have not yet been imported by this instructor.

**Response:** `EduAiCourse[]`

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

Creates a `CourseOffering` with `externalSource: 'EDUAI'`, then syncs topics and student enrollments from EduAI concurrently.

**Response:** `201 Created` with `Course`

---

## Modules

### `GET /api/courses/:courseId/modules`

List modules for a course.

**Auth:** Course member.

**Behavior:** Students see published modules only, with progress data.

**Response:** `Module[]`

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

**Response:** `Lesson[]`

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

**Response:** `Activity[]`

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

**Auth:** Course member.

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

**Response:** `Topic[]`

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

**Response:** `AiModel[]` with fields: `id`, `name`, `provider`, `description`, cost tier metadata.

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

**Response:** `Course[]`

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
