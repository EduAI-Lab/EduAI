# Service-caller actor

QM sits between two service-caller relationships: it is **called by** Core (one inbound route, cascade-delete) and it **calls** Core extensively (course/enrollment/topic data, question push, and AI chat/generation via a separately-configured `eduaiApiUrl`). Three distinct auth patterns exist across these calls, and QM deliberately chooses between them per-endpoint:

1. **Inbound, service-key only** (`middleware/serviceAuth.js`, `routes/internal.js`): Core → QM cascade-delete. Gated by `requireServiceKey`, comparing `Authorization: Bearer <token>` against `EDUAI_API_KEY` via `timingSafeEqual` on SHA-256 hashes (so length mismatches can't leak timing info). No session concept at all on this path.
2. **Outbound, service-key-with-cookie-fallback** (`services/coreApiService.js`, `fetchFromCore`): most QM → Core calls (enrollments, course lookups, topic push, question push) try the service key first (or cookie first, when `preferCookie` is set — e.g. `getCourseFromCore` prefers the caller's own cookie when available, since it needs the *caller's* view for RBAC purposes), and **retry with the alternate auth mode** on a `401`/`403` whose body says `INVALID_SERVICE_KEY`/`Unauthorized`/`Forbidden` — a stale or unset `EDUAI_API_KEY` doesn't hard-fail a request that could otherwise succeed on the user's own session.
3. **Outbound, cookie-only, no fallback** (`cookieOnly: true` calls like `listCoursesFromCore`, `getMyProfileFromCore`): explicitly session-scoped reads where falling back to the unscoped service key would leak data the caller's own Core role shouldn't see (the code comment on `getCourseEnrollmentsFromCore` is explicit about the *opposite* case: "never prefer cookie... students receive 403 on the session path" — i.e. some reads intentionally avoid the cookie path too, for the reverse reason).

QM also proxies AI chat/question-generation to a **separately configured** Core base URL (`config.eduaiApiUrl`, default `https://eduai.ok.ubc.ca`, distinct from `config.coreUrl` used for RBAC/course data) via `services/eduaiService.js` — same underlying Core deployment in practice, different env var, worth not confusing when tracing a call.

---

### UC-SVC-001: Core cascades a course deletion into QM

- **Category:** Happy Path
- **Actor:** Core, calling QM server-to-server with `EDUAI_API_KEY`
- **Preconditions:** A QM `Course` row exists with `coreCourseId` matching the course being deleted in Core
- **Entry point(s):** `routes/internal.js`
- **Flow:**
  1. An ADMIN (or authorized instructor) deletes a course in Core; Core's own deletion path fires a fire-and-forget cascade push (documented from the Core side in `docs/use-cases/core/*` and exercised by `tests/e2e/tests/cross-service/cascade-delete-propagation.spec.ts`, §802) to `DELETE /api/internal/courses/:coreCourseId` on QM, `Authorization: Bearer <EDUAI_API_KEY>`
  2. `requireServiceKey` validates the token; `Course.findOne({ where: { coreCourseId } })` locates the QM mirror
  3. `course.destroy()` — Sequelize cascades the delete to whatever `onDelete: CASCADE` associations exist on the schema (topics, questions, assessments, variants hanging off this course)
- **Expected outcome:** `200 { success: true, deleted: true }`. QM's mirror of the deleted course, and everything under it, is gone.
- **Failure modes / what could go wrong:** None on this path — the cross-service E2E test (`cascade-delete-propagation.spec.ts`) polls for exactly this outcome.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/routes/internal.js`
  - `apps/extensions/question-maker/app/backend/src/middleware/serviceAuth.js`

---

### UC-SVC-002: QM pushes an approved variant to Core, resolving topics on demand

- **Category:** Happy Path
- **Actor:** QM, calling Core server-to-server (service key) and forwarding the instructor's own cookie where RBAC needs it
- **Preconditions:** Variant approved (`isDraft: false`), course Core-linked
- **Entry point(s):** `services/coreWiringService.js` → `services/coreApiService.js`
- **Flow:** (already traced in full in `docs/use-cases/qm/instructor.md` UC-INSTRUCTOR-002) `pushVariantToCore` resolves each topic's `coreTopicId` (pushing missing ones via `pushTopicToCore`, itself a service-key `fetchFromCore` POST), then POSTs the assembled Question payload to Core
- **Expected outcome:** `variant.coreQuestionId` set from Core's response.
- **Failure modes / what could go wrong:** None on the happy path — see UC-INSTRUCTOR-005/006 in `instructor.md` for the 422/network failure branches of this exact call.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/services/coreWiringService.js`
  - `apps/extensions/question-maker/app/backend/src/services/coreApiService.js`

---

### UC-SVC-003: A stale `EDUAI_API_KEY` doesn't block a call that could succeed on the caller's session

- **Category:** Error Recovery
- **Actor:** QM, calling Core with a service key that Core no longer accepts (rotated/misconfigured) while the *caller* still holds a valid session
- **Preconditions:** `EDUAI_API_KEY` set on QM but stale/rotated on Core's side; caller's request carries a valid cookie
- **Entry point(s):** `services/coreApiService.js` (`fetchFromCore`)
- **Flow:**
  1. A call like `getCourseFromCore` builds `variants` via `authHeaderVariants` — since `preferCookie` can be true here, cookie is tried first in that specific call, but for calls where the service key is tried first (`preferCookie: false`), the service-key attempt gets `401`/`403` with `INVALID_SERVICE_KEY`
  2. `isRetryableAuthFailure(status, body)` matches (`401`/`403` + a recognized error code), and since `variants.length > 1` (both cookie and key are available), the loop `continue`s to the next variant instead of throwing
  3. The cookie-authed retry succeeds
- **Expected outcome:** The overall QM-side request the user initiated succeeds transparently — they never see the intermediate auth failure.
- **Failure modes / what could go wrong:** None — this is a deliberate resilience feature, not a gap. It does mean a genuinely revoked/wrong service key can go unnoticed for a long time in logs if every caller happens to also have a valid cookie (the failure is swallowed, not surfaced anywhere except perhaps a debug log at the `fetchFromCore` call site — not confirmed either way from this trace).
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/services/coreApiService.js`

---

### UC-SVC-004: Neither service key nor cookie is available for a required Core call

- **Category:** Error Recovery
- **Actor:** QM attempting a `fetchFromCore` call with `EDUAI_API_KEY` unset and no cookie forwarded (e.g. a background job context with no request cookie to propagate)
- **Preconditions:** `config.eduaiApiKey` is empty/unset; `cookie` argument is falsy
- **Entry point(s):** `services/coreApiService.js`
- **Flow:**
  1. `authHeaderVariants({ cookie: undefined, preferCookie })` returns an empty array (`service` is `null` since no key, `session` is `null` since no cookie)
  2. `fetchFromCore` checks `variants.length === 0` **before ever calling `fetch`** and throws immediately
- **Expected outcome:** `503`-shaped error (`{ error: 'CORE_SERVICE_UNAVAILABLE' }`, via `coreError(..., 503, ...)`) propagated up to whatever route triggered the call, without any network round-trip attempted.
- **Failure modes / what could go wrong:** None — fails fast and cheaply rather than making a doomed network call; the caller-facing route's own `catch`/`next(error)` determines the final HTTP status the QM user sees (typically the `errorHandler`'s `error.status || 500`, so `503` passes through as-is).
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/services/coreApiService.js`

---

### UC-SVC-005: Core cascade-delete for a course QM never mirrored

- **Category:** Wrong/Malformed Usage
- **Actor:** Core, cascading a delete for a course that was never imported/linked into QM (e.g. an instructor who never opened QM)
- **Preconditions:** No QM `Course` row has this `coreCourseId`
- **Entry point(s):** `routes/internal.js`
- **Flow:**
  1. Core sends `DELETE /api/internal/courses/:coreCourseId` as usual (it doesn't know or care whether QM has a mirror)
  2. `Course.findOne` returns `null`
  3. Route returns immediately, **without** calling `.destroy()`
- **Expected outcome:** `200 { success: true, deleted: false }` — explicitly idempotent, matching the route's own doc comment. Core's fire-and-forget cascade doesn't need to know or check whether QM had anything to delete.
- **Failure modes / what could go wrong:** None — this is correct, intended behavior for a cascade that fans out to multiple downstream services regardless of whether each one actually has a mirror.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/routes/internal.js`

---

### UC-SVC-006: A client-supplied `courseCode` in the EduAI proxy is re-verified against the caller's real QM access

- **Category:** Malicious/Adversarial
- **Actor:** Authenticated `INSTRUCTOR`-rank caller, attempting `POST /api/eduai/chat` or `/generate-questions` with a `courseCode` belonging to a course they have no QM access to
- **Preconditions:** Target course exists (owned/taught by someone else), attacker has no enrollment or ownership relationship to it
- **Entry point(s):** `routes/eduai.js`
- **Flow:**
  1. Attacker submits `POST /api/eduai/generate-questions` with `courseCode: "<victim's course code>"` — the route's own comment flags this explicitly: *"the client-supplied courseCode is otherwise unverified"* (issue #4)
  2. `resolveCourseCodeAccess` looks up local `Course` rows matching that code (case/whitespace-normalized), then calls `resolveAccessForCourse` for each match against the **actual authenticated caller**, requiring `rank >= LEVELS.ta.rank`
  3. No match returns sufficient access → `null`
- **Expected outcome:** `403 { success: false, error: 'You do not have access to this course', code: 'COURSE_ACCESS_DENIED' }` — the EduAI/Core call is never made; the attacker cannot use this proxy to generate or chat about content scoped to a course they can't reach in QM.
- **Failure modes / what could go wrong:** None found — the guard re-derives access from the real per-course RBAC path rather than trusting the client-supplied code, exactly mirroring the pattern used everywhere else in this app (resource loaders always re-derive from the DB/Core, never from client claims).
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/routes/eduai.js`
  - `apps/extensions/question-maker/app/backend/src/middleware/courseAccess.js`

---

### UC-SVC-007: `EDUAI_API_KEY` is a single shared secret across Core, AI Tutor, and QM

- **Category:** Security
- **Actor:** Anyone who obtains QM's `EDUAI_API_KEY` environment value (e.g. via a QM-side misconfiguration, leaked `.env`, or compromised deployment secret)
- **Preconditions:** Same key value is configured identically across Core, AI Tutor, and QM (per `CLAUDE.md`: *"Shared secret for AI Tutor / QM server-to-server calls"*)
- **Entry point(s):** `middleware/serviceAuth.js` (QM's own inbound check), and by extension every other app's equivalent guard (`apps/core/app/lib/auth/guards.server.ts`'s `requireServiceKey`, per `docs/use-cases/core/service-caller.md`)
- **Flow:**
  1. A secret leaked from QM's environment (weakest of the three deployments, or simply the one an attacker happened to compromise) is the *same* Bearer token accepted by Core's own service-key-gated admin/internal routes and AI Tutor's equivalent
  2. `timingSafeEqual`-based comparison in each app prevents a *brute-force/guessing* attack against the key, but does nothing to contain a key that's already been exfiltrated wholesale — there is no per-service key scoping (e.g. QM's key being valid only for QM-originated calls) visible in any of the three apps' guards
- **Expected outcome:** A single compromised secret grants server-to-server trust across all three services, not just the one it leaked from. This is a cross-app architectural characteristic (documented from Core's side too), not something QM's own code could unilaterally fix — flagging it here because it's directly relevant to reasoning about QM's own service-key blast radius.
- **Failure modes / what could go wrong:** No per-app key scoping exists; a leak anywhere is a leak everywhere trust boundary-wise. Mitigated in practice only by each app's own inbound routes being narrow in scope (QM's is a single cascade-delete endpoint; nothing more privileged is reachable with just this key) — the blast radius of a leaked key is bounded by what each app chooses to gate behind it, not by anything in the key mechanism itself.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/middleware/serviceAuth.js`
  - `apps/extensions/question-maker/app/backend/src/config/settings.js`
