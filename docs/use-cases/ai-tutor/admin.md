# Admin actor

An ADMIN in AI Tutor is a platform user with `role === 'ADMIN'` (Core's `UserRole`), resolved the same way as every other role — see [`student.md`](student.md) for the cookie-forwarding auth flow. Unlike Core, where ADMIN is simply the top of a permission hierarchy that can still reach every ordinary route, AI Tutor **structurally isolates** admins: a dedicated gate in `apps/extensions/ai-tutor/server/src/app.js` runs immediately after `requireAuth` and, for `req.user.role === 'ADMIN'`, rejects any request whose path isn't on an explicit allow-list (`isAllowedAdminPath`) — admins cannot use the student tutoring endpoints or the instructor authoring endpoints at all, even though nothing in RBAC logic elsewhere would stop them. This file covers the admin console surface (user/course inventory, enrollment management, system settings, AI model policy, cross-course AI-trace oversight) and the adversarial/wrong-usage cases specific to that isolation boundary and to system-settings mutation.

Two structural points carry through every scenario below:

- **User identity and roles are owned by Core, not this DB.** `PATCH /admin/users/:userId/role` is a permanent `410 GONE` — the code comment explicitly warns future maintainers not to "fix" this by writing roles locally, since that would silently diverge from Core on the next sync.
- **System settings (`EDUAI_API_KEY`, `AI_MODEL_POLICY`) live in a `SystemSetting` key/value table**, not env vars, so admin changes take effect immediately for the next request — no redeploy needed, but also no environment-level audit trail beyond whatever the app itself logs.

---

### UC-ADMIN-001: Managing course enrollment and reviewing AI model policy

- **Category:** Happy Path
- **Actor:** ADMIN
- **Preconditions:** At least one `CourseOffering` exists
- **Entry point(s):** `GET /admin/courses/:courseId/enrollments`, `POST /admin/courses/:courseId/enrollments`, `GET /admin/settings/ai-model-policy`, `PUT /admin/settings/ai-model-policy` (`apps/extensions/ai-tutor/server/src/routes/admin.js`)
- **Flow:**
  1. Admin opens the course roster editor; `GET /admin/courses/:courseId/enrollments` (gated `requireRole(['ADMIN','UNIT_ADMIN','INSTRUCTOR'])`, then `isCourseAdmin`) returns both `enrolledStudents` (names/emails resolved from Core via `listCoreAdminUsers`/`listEduAiCourseEnrollmentsServiceKey`, degrading gracefully to bare `userId` if Core is unreachable) and `availableStudents` (Core users with role `STUDENT` not already enrolled)
  2. Admin enrolls a student: `POST /admin/courses/:courseId/enrollments { userId, role? }`; the write is an idempotent `upsert` keyed on `courseOfferingId_userId`, so a duplicate enroll is a no-op update rather than a conflict
  3. Separately, admin reviews the AI model policy: `GET /admin/settings/ai-model-policy` returns `{ policy, availableModels, availableModelsError }` (`getAiModelPolicyState`, `aiModelPolicy.js`) — the live EduAI catalog is fetched fresh each time and reconciled against the stored allow-list
  4. Admin narrows the allowed tutor models and sets a stricter `maxSupervisorIterations`: `PUT /admin/settings/ai-model-policy { allowedTutorModelIds, defaultTutorModelId, defaultSupervisorModelId, dualLoopEnabled, maxSupervisorIterations }`; `setAiModelPolicy` re-validates against the live catalog and persists to `SystemSetting`
- **Expected outcome:** `200`/`201` on each step; the new policy is picked up by `resolveTutorModelSelection`/`resolveSupervisorSettings` on the very next student tutoring request (no caching layer to invalidate).
- **Failure modes / what could go wrong:** None on the happy path.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/routes/admin.js`
  - `apps/extensions/ai-tutor/server/src/services/aiModelPolicy.js`
  - `apps/extensions/ai-tutor/server/src/services/eduaiClient.js`

---

### UC-ADMIN-002: Auditing AI tutoring behavior across courses via interaction traces

- **Category:** Typical Use
- **Actor:** ADMIN
- **Preconditions:** Students have used Teach/Guide/Custom mode somewhere in the platform
- **Entry point(s):** `GET /admin/ai-traces` (`apps/extensions/ai-tutor/server/src/routes/admin.js`)
- **Flow:**
  1. Admin opens the AI oversight panel; `GET /admin/ai-traces?limit=100` runs unscoped for `ADMIN` (no `department` filter unless `unit` is explicitly passed, and for `ADMIN` that filter is "optional filtering, not an authorization boundary" per the source comment) — every course's traces are visible
  2. `limit` is clamped to `[1, 200]` (default 50); an invalid `courseId` query param returns `400` before any query runs
  3. The response is deliberately narrow: `id, mode, knowledgeLevel, tutorModelId, supervisorModelId, iterationCount, finalOutcome, createdAt, user{id,name}, activity{id,title}, courseId, courseTitle` — it does **not** include `userMessage`, `finalResponse`, or the full iteration `trace` JSON blob that `AiInteractionTrace` actually stores
  4. Student display names are resolved the same best-effort way as UC-ADMIN-001 (`listCoreAdminUsers` + id→name map, degrading to `null` on Core failure)
- **Expected outcome:** `200` with a cross-course oversight feed suitable for spotting anomalous `finalOutcome` patterns (e.g. many `safe_fallback`s for one model) without exposing verbatim chat transcripts in this particular list view.
- **Failure modes / what could go wrong:** None found for the endpoint itself, but worth noting: the *underlying* `AiInteractionTrace` row does store the full conversation content (`userMessage`, `finalResponse`, per-iteration `trace`) — this endpoint just chooses not to surface it. Any future endpoint or direct DB access that does expose those fields inherits full chat-content sensitivity (including whatever the student typed, which could include personal information).
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/routes/admin.js`

---

### UC-ADMIN-003: Rotating the shared EduAI API key

- **Category:** Typical Use
- **Actor:** ADMIN
- **Preconditions:** None
- **Entry point(s):** `GET /admin/settings/eduai-api-key`, `PUT /admin/settings/eduai-api-key`, `DELETE /admin/settings/eduai-api-key` (`apps/extensions/ai-tutor/server/src/routes/admin.js`)
- **Flow:**
  1. Admin checks current status: `GET /admin/settings/eduai-api-key` → `getEduAiApiKeyStatus()` (`systemSettings.js`) — returns whether a key is set, not the key value itself (mirroring how Core never round-trips secrets to the client)
  2. Admin sets a new key: `PUT /admin/settings/eduai-api-key { apiKey }`; the route rejects a non-string or all-whitespace value with `400` before writing, then persists the trimmed value to `SystemSetting('EDUAI_API_KEY')`
  3. Every subsequent server-to-server call that needs this key (e.g. bulk Core data pulls not covered by the student's own forwarded cookie) picks up the new value immediately — no cache, no redeploy
  4. Admin can also `DELETE` the key to clear it (`clearSystemSetting`), returning the app to whatever the env-var fallback (if any) provides
- **Expected outcome:** `200` with the updated status on all three verbs; the key value itself is never echoed back in any response.
- **Failure modes / what could go wrong:** None found for the endpoint logic itself — but note that unlike the student-facing chat flow (where each student supplies and never persists their own provider key), this admin-set key is stored server-side in `SystemSetting`, so its blast radius on compromise is platform-wide, not per-user.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/routes/admin.js`
  - `apps/extensions/ai-tutor/server/src/services/systemSettings.js`

---

### UC-ADMIN-004: Enrollment role change succeeds in Core but fails to persist locally

- **Category:** Error Recovery
- **Actor:** ADMIN, promoting a student to TA on a Core-linked course
- **Preconditions:** Course has `externalSource === 'EDUAI'` and a linked Core enrollment; the local Prisma write fails after the Core write-through succeeds (e.g. a transient DB connection blip)
- **Entry point(s):** `PATCH /admin/courses/:courseId/enrollments/:userId/role` (`apps/extensions/ai-tutor/server/src/routes/admin.js`)
- **Flow:**
  1. Admin sends `PATCH .../role { role: 'TA' }`; route validates `role` is `'STUDENT'|'TA'` (`400` otherwise), loads the course and enrollment (`404` if either is missing), and checks `isCourseAdmin`
  2. Because the course is Core-linked, the route calls `patchCoreEnrollmentRole(course.externalId, coreEnrollment.id, 'TA', cookie)` **first** and captures a `coreRollback` closure that would patch the role back to its prior value
  3. The Core call succeeds; the route then attempts `prisma.courseEnrollment.update(...)` inside an inner `try`
  4. The local update throws; the `catch` immediately invokes `coreRollback()` (best-effort — its own failure is swallowed via `.catch(() => {})`) and rethrows `dbErr` to the outer handler, which returns `500`
- **Expected outcome:** `500 { error: ... }`; the code attempts to leave Core and AI Tutor consistent by rolling Core's role back to match the (unchanged) local state, rather than leaving Core showing "TA" while AI Tutor still shows "STUDENT."
- **Failure modes / what could go wrong:** The rollback is genuinely best-effort — if the rollback `patchCoreEnrollmentRole` call *also* fails (e.g. the same transient outage extends to that second call), the failure is silently swallowed (`.catch(() => {})`) and Core is left in the new "TA" state while AI Tutor's local `CourseEnrollment.role` remains "STUDENT," a real (if narrow-window) divergence the admin isn't told about beyond the generic `500`.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/routes/admin.js`

---

### UC-ADMIN-005: Setting an AI model policy that violates its own invariants

- **Category:** Wrong/Malformed Usage
- **Actor:** ADMIN
- **Preconditions:** None
- **Entry point(s):** `PUT /admin/settings/ai-model-policy` (`apps/extensions/ai-tutor/server/src/routes/admin.js`, `apps/extensions/ai-tutor/server/src/services/aiModelPolicy.js`)
- **Flow:**
  1. Admin submits a policy with `allowedTutorModelIds: []` (or a `defaultTutorModelId` that isn't in the allow-list, or a `defaultSupervisorModelId` not in the live catalog)
  2. `setAiModelPolicy` loads the live catalog, resolves the submitted policy against it, then explicitly checks each invariant and `throw new Error(...)` with a message containing `"must"`/`"At least one"` for each violation — no `status` property is attached to these errors
  3. The route's `catch` maps the error to `400` specifically by string-matching `e.message.includes('must') || e.message.includes('At least one')` — any *other* unexpected error message (e.g. a raw Prisma error) instead falls through to `500`
- **Expected outcome:** `400` with the specific validation message for the three documented invariants (empty allow-list; default tutor not in allow-list; default supervisor not in catalog); the previously-stored policy is left untouched since `setSystemSetting` is never reached.
- **Failure modes / what could go wrong:** The `400` classification is done by matching substrings in the thrown error's `.message` rather than a typed/coded error — fragile if the message wording ever changes (a future edit to one of those three `throw new Error(...)` strings could silently downgrade a validation failure to a `500`), but not exploitable today.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/services/aiModelPolicy.js`
  - `apps/extensions/ai-tutor/server/src/routes/admin.js`

---

### UC-ADMIN-006: Admin attempts to use the student or instructor endpoints directly

- **Category:** Malicious/Adversarial
- **Actor:** ADMIN (or an attacker who has compromised/is testing boundaries of an admin session)
- **Preconditions:** None
- **Entry point(s):** `apps/extensions/ai-tutor/server/src/app.js` (the admin path-isolation gate), any non-admin route e.g. `POST /activities/:activityId/teach`
- **Flow:**
  1. Admin (or someone with an admin session) sends `POST /activities/123/teach` — perhaps assuming ADMIN, as the top platform role, can preview the student tutoring experience
  2. The isolation middleware in `app.js` runs before any route handler: `if (req.user.role === 'ADMIN') { if (isAllowedAdminPath(req.path)) return next(); return res.status(403)... }`; `/activities/123/teach` is **not** on the allow-list (the allow-list covers `/courses`, `/courses/*`, `/modules/*`, `/lessons/*`, `/activities/*` only for *course-structure* reads/writes bundled with the instructor authoring shell that admins also share — but the activities allow-list entry is a path-prefix match, so `/activities/123/teach` actually *does* match `path.startsWith('/activities/')` and is let through to the route itself)
  3. Once past the gate, `activities.js`'s own handler for `/teach` checks `authUser.role !== 'STUDENT'` and returns `403 { error: 'Only students can use AI tutoring' }` regardless — so the *second*, route-local check is what actually blocks the admin here, not the path-isolation gate
- **Expected outcome:** `403 Forbidden`, but via the activity route's own student-only check rather than the admin path-isolation gate (which is permissive for anything under `/activities/*` since admins share the instructor authoring shell for that prefix).
- **Failure modes / what could go wrong:** Not a vulnerability, but a documentation correction worth having on record: the `isAllowedAdminPath` allow-list is coarser than "admin console only" — its `/activities/`, `/courses/`, `/modules/`, `/lessons/` prefixes intentionally let admins reach the *authoring* surface for those resources (course-structure CRUD), and it's each individual route handler's own role check (not the gate) that ultimately prevents an admin from reaching the student-only AI chat endpoints.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/app.js`
  - `apps/extensions/ai-tutor/server/src/routes/activities.js`

---

### UC-ADMIN-007: Non-admin attempts to reach admin-only settings/user endpoints

- **Category:** Malicious/Adversarial
- **Actor:** INSTRUCTOR or UNIT_ADMIN with a valid session
- **Preconditions:** None
- **Entry point(s):** `GET /admin/users`, `PUT /admin/settings/eduai-api-key`, `PUT /admin/settings/ai-model-policy` (`apps/extensions/ai-tutor/server/src/routes/admin.js`)
- **Flow:**
  1. Attacker (INSTRUCTOR role) sends `GET /admin/users` or attempts to `PUT /admin/settings/eduai-api-key` with a forged/tampered request
  2. Each of these routes is gated by `requireRole('ADMIN')` (not the broader `['ADMIN','UNIT_ADMIN','INSTRUCTOR']` used for enrollment endpoints) — the middleware checks `req.user.role` sourced from the Core-validated session, not anything in the request body, and returns `403` for a non-ADMIN role
  3. Separately, even a `UNIT_ADMIN` (who *does* pass some `/admin/*` routes like `/admin/courses/:courseId/enrollments`) is explicitly blocked from `/admin/settings/*` and `/admin/users*` by the `app.js` isolation gate itself, one layer before the route's own `requireRole` even runs
- **Expected outcome:** `403 Forbidden` for both INSTRUCTOR and UNIT_ADMIN on every ADMIN-only endpoint; system settings and the full user directory are reachable only by the platform ADMIN role.
- **Failure modes / what could go wrong:** None found — the defense is layered (path-isolation gate + per-route `requireRole`), so even if one layer had a gap the other would likely still catch it; role comes exclusively from the Core-validated session, never from client-supplied data.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/app.js`
  - `apps/extensions/ai-tutor/server/src/routes/admin.js`
  - `apps/extensions/ai-tutor/server/src/middleware/auth.js`

---

### UC-ADMIN-008: Attempting to "fix" a user's role through the deprecated endpoint

- **Category:** Wrong/Malformed Usage
- **Actor:** ADMIN
- **Preconditions:** None
- **Entry point(s):** `PATCH /admin/users/:userId/role` (`apps/extensions/ai-tutor/server/src/routes/admin.js`)
- **Flow:**
  1. Admin (or a stale client build still calling the old endpoint) sends `PATCH /admin/users/:userId/role { role: 'INSTRUCTOR' }`
  2. The handler is a one-line permanent stub: `return res.status(410).json({ error: 'Roles are managed in EduAI' })` — it never touches the database or forwards anything to Core
- **Expected outcome:** `410 GONE { "error": "Roles are managed in EduAI" }` unconditionally; the caller is redirected (by the error message) to change the role in Core instead, which is the actual source of truth AI Tutor mirrors via `normalizeRole` in `auth.js` on every session validation.
- **Failure modes / what could go wrong:** None — this is intentionally a dead-end by design (per the file's own header comment) specifically to stop a future maintainer from "fixing" it into a local write that would silently diverge from Core on the next role sync.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/routes/admin.js`
  - `apps/extensions/ai-tutor/server/src/middleware/auth.js`
