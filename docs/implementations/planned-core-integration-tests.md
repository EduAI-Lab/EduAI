# EduAICore Integration Tests

Planned integration test cases for `apps/core`. All tests live under `app/tests/integration/` and are run with Vitest against a real test database.

**Not covered here:** `/api/auth/*` (handled by better-auth internals), `/api/chat` (AI streaming — too expensive/slow for integration tests).

---

### `courses.test.ts`

`**GET /api/courses`**

- Returns `200` with a `{ courses: [] }` array with no session (no auth required)
- Returns `200` with an empty array when no courses exist
- Returns all courses in the database, not filtered by user

`**POST /api/courses**`

- Returns `201` with the created course when an admin submits valid form data
- Returns `403` when a non-admin authenticated user attempts to create a course
- Returns `403` when the request has no session
- Returns `400` with validation details when `name` is missing
- Returns `400` with validation details when `code` is missing
- Returns `400` with validation details when `year` is not a valid integer

`**PATCH /api/courses/:id**`

- Returns `200` with the updated course when the owning professor patches their own course
- Returns `200` with the updated course when an admin patches any course
- Returns `400` with validation details when the request body fails schema validation
- Returns `401` when no session is present
- Returns `403` when an authenticated non-admin, non-owner user patches the course
- Returns `404` when the course ID does not exist

---

### `courses-topics.test.ts`

`**GET /api/courses/:id/topics**`

- Returns `200` with a `{ topics: [] }` array for any authenticated user
- Returns `200` with an empty array when the course has no topics
- Returns `401` when no session is present
- Returns `400` when `courseId` path param is missing

`**POST /api/courses/:id/topics**`

- Returns `201` with the created topic when an admin posts a valid `{ name }` body
- Returns `403` when a non-admin authenticated user attempts to create a topic
- Returns `401` when no session is present
- Returns `400` when `name` is an empty string
- Returns `409` when a topic with the same name already exists on that course
- Returns `400` when `courseId` path param is missing

`**DELETE /api/courses/:id/topics**`

- Returns `204` when an admin deletes a topic by `topicId`
- Returns `204` when an admin deletes a topic by `name`
- Returns `403` when a non-admin authenticated user attempts to delete a topic
- Returns `401` when no session is present
- Returns `404` when no topic matches the given `topicId` or `name`
- Returns `400` when neither `topicId` nor `name` is provided in the body

---

### `courses-materials.test.ts`

`**GET /api/courses/:courseId/materials**`

- Returns `200` with `{ materials: [] }` for the course professor
- Returns `200` with `{ materials: [] }` for an enrolled student
- Returns `200` with `{ materials: [] }` for a TA of the course
- Returns `401` when no session is present
- Returns `404` when the user is not enrolled in, TA of, or professor of the course
- Returns `400` when `courseId` path param is missing

`**POST /api/courses/:courseId/materials**`

- Returns `200` with `{ success: true, materialId }` when a professor uploads a valid plain-text file
- Returns `409` when the same file content (matching checksum) is uploaded a second time to the same course
- Returns `400` when no `file` field is present in the form data
- Returns `401` when no session is present
- Returns `404` when the user does not have access to the course
- Returns `400` when `courseId` path param is missing

---

### `chats.test.ts`

`**GET /api/chats/:chatId**`

- Returns `200` with the chat object when the owner requests their own chat
- Returns `401` when no session is present
- Returns `404` when the chat belongs to a different user
- Returns `404` when the chat ID does not exist
- Returns `400` when `chatId` path param is missing

---

### `users.test.ts`

`**GET /api/users**`

- Returns `200` with an array of all users when called by an admin
- Each user object includes `id`, `email`, `name`, `role`, `isActive`, and `_count` of related records
- Returns `403` when called by a non-admin authenticated user
- Returns `403` when no session is present

`**POST /api/users**`

- Returns `201` with the created user when an admin posts a valid body
- Returns `400` with validation details when required fields are missing
- Returns `400` when an invalid `role` value is provided
- Returns `409` when the email address is already registered
- Returns `403` when called by a non-admin authenticated user
- Returns `403` when no session is present

`**PATCH /api/users/:id**`

- Returns `200` with the updated user when an admin patches valid fields
- Returns `400` with validation details when the body fails schema validation
- Returns `400` when an admin attempts to set their own `isActive` to `false`
- Returns `404` when the target user ID does not exist
- Returns `409` when the patched email is already taken by another user
- Returns `403` when called by a non-admin authenticated user
- Returns `403` when no session is present

`**DELETE /api/users/:id**`

- Returns `204` when an admin deletes a different user
- Returns `400` when an admin attempts to delete their own account
- Returns `404` when the target user ID does not exist
- Returns `400` when the user has existing related data that prevents deletion
- Returns `403` when called by a non-admin authenticated user
- Returns `403` when no session is present

---

### `ai-providers.test.ts`

`**GET /api/ai-providers**`

- Returns `200` with an array of all providers including their `models` and `_count`
- Returns `200` with an empty array when no providers exist (no auth required)

`**POST /api/ai-providers**`

- Returns `201` with the created provider when an admin posts a valid body
- Returns `400` with validation details when required fields are missing or invalid
- Returns `409` when a provider with the same name already exists
- Returns `403` when called by a non-admin authenticated user

`**PATCH /api/ai-providers/:id**`

- Returns `200` with the updated provider when an admin patches valid fields
- Returns `400` with validation details when the body fails schema validation
- Returns `404` when the provider ID does not exist
- Returns `409` when the patched name is already taken by another provider
- Returns `400` when the provider ID is missing from the URL
- Returns `403` when called by a non-admin authenticated user

`**DELETE /api/ai-providers/:id**`

- Returns `204` when an admin deletes a provider with no associated models
- Returns `409` when the provider has one or more associated models
- Returns `404` when the provider ID does not exist
- Returns `400` when the provider ID is missing from the URL
- Returns `403` when called by a non-admin authenticated user

---

### `ai-models.test.ts`

`**GET /api/ai-models**`

- Returns `200` with an array of all models, each including their `provider`
- Returns `200` with an empty array when no models exist (no auth required)

`**POST /api/ai-models**`

- Returns `201` with the created model (including provider) when an admin posts a valid body
- Returns `400` with validation details when required fields are missing or the `type` enum is invalid
- Returns `400` when the referenced `providerId` does not exist
- Returns `409` when the `modelId` is already used by the same provider
- Returns `403` when called by a non-admin authenticated user

`**PATCH /api/ai-models/:id**`

- Returns `200` with the updated model when an admin patches valid fields
- Returns `400` with validation details when the body fails schema validation
- Returns `404` when the model ID does not exist
- Returns `409` when the patch creates a duplicate `modelId` for the same provider
- Returns `400` when the model ID is missing from the URL
- Returns `403` when called by a non-admin authenticated user

`**DELETE /api/ai-models/:id**`

- Returns `204` when an admin deletes an existing model
- Returns `404` when the model ID does not exist
- Returns `400` when the model ID is missing from the URL
- Returns `403` when called by a non-admin authenticated user

---

### `ollama-models.test.ts`

`**GET /api/ollama-models**`

- Returns `200` with `{ models, baseUrl }` when Ollama is reachable and the caller is an admin
- Returns `403` when called by a non-admin authenticated user
- Returns `403` when no session is present
- Returns `500` with a descriptive error message when the Ollama server is unreachable
- Accepts an optional `?baseUrl=` query param and uses it in place of `OLLAMA_BASE_URL`

