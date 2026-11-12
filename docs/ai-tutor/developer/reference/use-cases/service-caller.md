# Service-caller actor

This file covers server-to-server traffic between AI Tutor and Core, in both directions. Unlike Core's own `service-caller.md` (a single `EDUAI_API_KEY` + optional `proxyUser` pattern), AI Tutor actually uses **three distinct upstream-auth patterns** depending on the call, plus one inbound pattern for Core calling into AI Tutor:

1. **User-scoped, cookie-forwarded** — the acting user's own `Cookie` header is forwarded to Core so Core's session validation authorizes the call *as that user*. Used for anything that must reflect a specific user's Core-side permissions (listing their courses, chat completions, enrollment role changes). No `EDUAI_API_KEY` involved.
2. **Service-key, bulk/admin-scoped** — `Authorization: Bearer <EDUAI_API_KEY>` sent to Core, used for calls that need data Core wouldn't (or couldn't) scope to a single user's cookie: course topics, enrollment rosters, the AI model catalog, testable-question banks, and publish-state writes. This bypasses Core's own per-user RBAC — Core is expected to treat this key as fully trusted machine access.
3. **Inbound service-key** — Core calling **into** AI Tutor, gated by `requireServiceKey` (`apps/extensions/ai-tutor/server/src/middleware/serviceAuth.js`), which is exempt from the normal `requireAuth` cookie gate entirely (see [`unauthenticated.md`](unauthenticated.md) UC-UNAUTH-007).

There is no `proxyUser`-style impersonation pattern anywhere in AI Tutor's codebase — every call is either genuinely user-scoped (real cookie) or genuinely service-scoped (real shared secret), never "service key acting as a specific user."

---

### UC-SVC-001: Core cascade-deletes a course, propagating to AI Tutor's mirror

- **Category:** Happy Path
- **Actor:** Core, deleting a `CourseOffering` that AI Tutor has imported/mirrored
- **Preconditions:** AI Tutor has a local `CourseOffering` with `coreOfferingId` matching the deleted Core course
- **Entry point(s):** `DELETE /internal/courses/:coreOfferingId` (`apps/extensions/ai-tutor/server/src/routes/internal.js`)
- **Flow:**
  1. Core, after deleting its own course record, calls `DELETE {AI_TUTOR_URL}/api/internal/courses/:coreOfferingId` with `Authorization: Bearer <EDUAI_API_KEY>`
  2. This path is exempted from AI Tutor's cookie-based `requireAuth` (`app.js`'s `req.path.startsWith('/internal/')` check) but gated instead by `requireServiceKey`, which validates the bearer token via a `timingSafeEqual` comparison of SHA-256 hashes of both the presented token and the configured `EDUAI_API_KEY` (hashing first specifically so a length mismatch between token and key can't itself leak timing information)
  3. On success, `prisma.courseOffering.deleteMany({ where: { coreOfferingId } })` runs; Prisma's `onDelete: Cascade` foreign keys tear down every descendant row — modules, lessons, activities, submissions, chat sessions, enrollments — in one statement
  4. The response distinguishes "found and deleted" from "nothing to delete" via `{ success: true, deleted: result.count > 0 }` rather than a `404`, making the call idempotent — Core can retry safely if its own delivery is at-least-once
- **Expected outcome:** `200 { success: true, deleted: true|false }`; AI Tutor's mirror of a Core-deleted course, and everything a student or instructor built on top of it locally, is fully removed rather than left as an orphaned, unreachable-but-present record.
- **Failure modes / what could go wrong:** None found — the idempotent response shape means a redelivered request (common in at-least-once delivery systems) is harmless.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/routes/internal.js`
  - `apps/extensions/ai-tutor/server/src/middleware/serviceAuth.js`

---

### UC-SVC-002: AI Tutor pulling course-scoped data from Core with the service key

- **Category:** Happy Path
- **Actor:** AI Tutor, mid student AI-tutoring request or instructor content-import flow
- **Preconditions:** `EDUAI_API_KEY` is configured identically in both apps' env
- **Entry point(s):** `listCourseTestableQuestions`, `listEduAiCourseTopics`, `listEduAiCourseEnrollmentsServiceKey`, `listEduAiModels`, `setCoreCoursePublishState` (`apps/extensions/ai-tutor/server/src/services/eduaiClient.js`)
- **Flow:**
  1. Any of these functions reads `process.env.EDUAI_API_KEY` (or, for `listEduAiModels`, the DB-stored effective key via `getEffectiveEduAiApiKey`) directly — not from any per-request context — and throws a plain `Error('EDUAI_API_KEY not configured')` with **no `status` property** if it's unset
  2. When set, the call is made with `Authorization: Bearer <key>` via the shared `requestEduAi` helper, which surfaces any non-`2xx` Core response as an `Error` with `.status` set to Core's HTTP status, and parses the body against a Zod schema (`EduAiCourseListSchema`, `EduAiQuestionListSchema`, etc.) — a schema mismatch is itself converted to a `502`-status `Error`, distinct from Core's own error status
  3. E.g. `handleAiInteraction` (`activities.js`) calls `listCourseTestableQuestions(course.coreOfferingId, { limit: 20 }).catch(() => [])` — deliberately fail-soft, since a testable-question-bank fetch failure shouldn't block the student's tutoring request, just degrade the supervisor's context
- **Expected outcome:** `200`-equivalent (a parsed, schema-validated array) on success; callers that can tolerate degraded context (like the testable-question fetch above) swallow failures, while callers where the data is load-bearing (e.g. `setCoreCoursePublishState` during a publish action) propagate the error up to a `500`/`502` response to the end user.
- **Failure modes / what could go wrong:** None in the happy path — but see UC-SVC-005 for what happens when the two apps' `EDUAI_API_KEY` values don't match, and UC-SVC-006 for a base-URL configuration hazard specific to this call family.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/services/eduaiClient.js`
  - `apps/extensions/ai-tutor/server/src/routes/activities.js`

---

### UC-SVC-003: Forwarding a user's own session cookie for user-scoped Core calls

- **Category:** Typical Use
- **Actor:** AI Tutor, acting strictly *as* the requesting user (not as a service)
- **Preconditions:** The requesting user has a valid Core session
- **Entry point(s):** `listEduAiCourses`, `patchCoreEnrollmentRole`, `deleteCoreEnrollment`, `listCoreAdminUsers`, `listCoreAdminBugReports`, and — outside `eduaiClient.js` — the chat proxy in `aiGuidance.js`'s `callEduAI`
- **Flow:**
  1. Each of these functions requires a non-empty `cookie` argument and throws a `401`-status `Error` immediately if it's missing — there is no silent fallback to the service key for these calls
  2. `listEduAiCourses({ cookie })` specifically calls out (in its own doc comment) that it must use the cookie and **not** the service key, "that returns the full catalog" — i.e. using the service key here would over-broaden the result beyond what the acting user is actually permitted to see in Core
  3. The forwarded cookie is the literal value from the original browser request (`req.headers.cookie`), passed through unmodified — AI Tutor performs no cookie minting, signing, or transformation of its own
- **Expected outcome:** Core's own session-based RBAC governs the result exactly as if the user had called Core directly — AI Tutor is a transparent relay for these calls, not a privilege-widening intermediary.
- **Failure modes / what could go wrong:** None found — the deliberate cookie-vs-service-key split (documented in-line at `listEduAiCourses`) is the load-bearing mechanism that prevents a lower-privileged AI Tutor user from seeing Core data broader than their own Core-side access; getting this choice wrong at any call site would be a real authorization bug, which is presumably why the comment exists.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/services/eduaiClient.js`
  - `apps/extensions/ai-tutor/server/src/services/aiGuidance.js`

---

### UC-SVC-004: Retrying a course cascade-delete after a partial failure

- **Category:** Error Recovery
- **Actor:** Core, redelivering `DELETE /internal/courses/:coreOfferingId` after a prior attempt's response was lost (network blip on Core's side, even though AI Tutor's delete actually committed)
- **Preconditions:** The first delete already succeeded server-side
- **Entry point(s):** `DELETE /internal/courses/:coreOfferingId` (`apps/extensions/ai-tutor/server/src/routes/internal.js`)
- **Flow:**
  1. Core redelivers the identical `DELETE` request
  2. `prisma.courseOffering.deleteMany({ where: { coreOfferingId } })` matches zero rows this time (already deleted) — Prisma's `deleteMany` doesn't throw on a zero-row match, it simply returns `{ count: 0 }`
  3. Route returns `200 { success: true, deleted: false }` rather than a `404` or `500`
- **Expected outcome:** `200`, not an error — Core can treat any response from this endpoint as "AI Tutor's mirror is now definitely gone," without needing to distinguish "I just deleted it" from "it was already gone."
- **Failure modes / what could go wrong:** None — this is exactly the idempotency property a cascade-delete webhook needs to be safe under at-least-once redelivery.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/routes/internal.js`

---

### UC-SVC-005: `EDUAI_API_KEY` unset or mismatched between the two apps

- **Category:** Wrong/Malformed Usage
- **Actor:** An operator who deployed AI Tutor and Core with different (or one missing) `EDUAI_API_KEY` values
- **Preconditions:** Misconfigured environment
- **Entry point(s):** Any `eduaiClient.js` function that reads `EDUAI_API_KEY` directly; `requireServiceKey` on the receiving end
- **Flow (AI Tutor → Core, key unset locally):**
  1. AI Tutor calls e.g. `setCoreCoursePublishState`; `process.env.EDUAI_API_KEY` is falsy, so the function throws a plain `Error('EDUAI_API_KEY not configured')` with **no `.status` set**
  2. Route-level callers that don't special-case this fall through to their generic `catch` and return a bare `500` with the raw message — except the course-import routes (`courses.js`'s `respondEduAiUpstreamError`), which run the error through `mapEduAiServiceKeyError` (`eduaiServiceKeyErrors.js`) first, detecting the `'EDUAI_API_KEY not configured'` substring and converting it to a friendlier `503` with an explicit ops message telling the operator to set the same value in both apps' `.env` files
- **Flow (mismatched, i.e. both set but different values):**
  1. AI Tutor sends a real bearer token, but it doesn't match Core's configured key; Core's own equivalent `requireServiceKey` (mirrored per the source comment) returns `403 INVALID_SERVICE_KEY`
  2. `requestEduAi` surfaces this as an `Error` with `.status = 403`; `mapEduAiServiceKeyError` catches this specific shape too (`error.status === 403 && message.includes('INVALID_SERVICE_KEY')`) and remaps it to the same `503` ops-guidance response — but **only** for the routes that call `respondEduAiUpstreamError`/`mapEduAiServiceKeyError`; other call sites (e.g. inside `activities.js`'s `handleAiInteraction` fail-soft testable-question fetch) never see this remapping since they either swallow the error or propagate the raw `403`
- **Expected outcome:** Inconsistent by call site: the course-import UX gets a clear, actionable `503` message; most other service-key call sites surface either a generic `500` or a raw `403`/`401` with no operator guidance.
- **Failure modes / what could go wrong:** The helpful `mapEduAiServiceKeyError` remapping is opt-in per route (only where a handler explicitly calls it), not applied globally to every service-key call site — an operator debugging a *different* symptom (e.g. AI model catalog failing to load, or enrollment sync silently no-oping) may not get the same clear diagnostic that the course-import flow would give them for the identical root cause.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/services/eduaiClient.js`
  - `apps/extensions/ai-tutor/server/src/services/eduaiServiceKeyErrors.js`
  - `apps/extensions/ai-tutor/server/src/routes/courses.js`

---

### UC-SVC-006: Two different upstream base-URL environment variables for what is nominally the same Core instance

- **Category:** Wrong/Malformed Usage
- **Actor:** An operator configuring AI Tutor's environment
- **Preconditions:** None — this is a static code/config observation, reproducible in any deployment
- **Entry point(s):** `apps/extensions/ai-tutor/server/src/services/eduaiClient.js` (`getEduAiBaseUrl`, `getCoreBaseUrl`)
- **Flow:**
  1. `getEduAiBaseUrl()` reads `process.env.EDUAI_BASE_URL`, defaulting to `http://localhost:5174/api` if unset — this backs `requestEduAi`, and therefore `listEduAiCourses`, `listEduAiCourseTopics`, `listEduAiCourseEnrollmentsServiceKey`, `listEduAiModels`, `setCoreCoursePublishState`, `listCourseTestableQuestions`, and `getEduAiChatUrl()` (the chat-completion endpoint used by `aiGuidance.js`)
  2. `getCoreBaseUrl()` reads a **different** variable, `process.env.CORE_URL`, defaulting to `http://localhost:3000` — this backs `postCoreBugReport`, `listCoreAdminBugReports`, `listCoreAdminUsers`, `patchCoreAdminBugReportStatus`, and (separately, in `middleware/auth.js`) `requireAuth`'s session-validation call
  3. Both are meant to point at the same running Core instance in every deployment this codebase describes (per `CLAUDE.md`, Core listens on port 3000 in dev) — the `5174` default for `EDUAI_BASE_URL` doesn't correspond to Core's documented dev port at all
  4. If an operator sets only one of the two variables (a very plausible partial-config mistake, since both ultimately need to reach "Core"), roughly half of AI Tutor's Core-bound calls silently target the wrong host/port while the other half work fine — there's no startup-time consistency check between them
- **Expected outcome:** Whichever call family's env var was missed fails at request time with a connection error (surfaced as a `500`/`502` per the generic error handling in each call site), while the other family continues working — producing a confusing "some features work, others don't" failure mode rather than a clear single configuration error.
- **Failure modes / what could go wrong:** This is an operational/config-hygiene risk, not a runtime security bug (no auth bypass results from it — a wrong host simply fails to connect or connects to nothing), but it's worth flagging: two independently-named env vars for what should be one logical "where is Core" setting, with different (and not obviously matching) default ports, is a real footgun for anyone standing up a new environment without exhaustively reading both `eduaiClient.js` and `middleware/auth.js`.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/services/eduaiClient.js`
  - `apps/extensions/ai-tutor/server/src/middleware/auth.js`

---

### UC-SVC-007: Forged or missing bearer token against the inbound internal endpoint

- **Category:** Malicious/Adversarial
- **Actor:** An attacker (or a misconfigured third party) attempting to call AI Tutor's internal course-deletion endpoint directly
- **Preconditions:** None
- **Entry point(s):** `DELETE /internal/courses/:coreOfferingId` (`apps/extensions/ai-tutor/server/src/routes/internal.js`)
- **Flow:**
  1. Attacker sends the request with no `Authorization` header: `requireServiceKey` returns `401 { error: 'MISSING_SERVICE_KEY' }` before touching the DB
  2. Attacker sends a guessed/forged bearer token: the token and the real key are each SHA-256 hashed, then compared via `timingSafeEqual` — a mismatch (near-certain for a guessed value) yields `403 { error: 'INVALID_SERVICE_KEY' }`
  3. If `EDUAI_API_KEY` itself is unset server-side (a misconfiguration, not an attack), `requireServiceKey` returns `403 { error: 'INVALID_SERVICE_KEY' }` unconditionally for *any* presented token, rather than treating "no configured key" as "any key is valid" — a fail-closed default
- **Expected outcome:** `401`/`403` for every unauthorized attempt; a course can never be deleted from AI Tutor's mirror by this path without possession of the exact shared secret.
- **Failure modes / what could go wrong:** None found — the timing-safe comparison specifically defeats a byte-by-byte timing attack on the key, and the unset-key case fails closed rather than open.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/middleware/serviceAuth.js`
