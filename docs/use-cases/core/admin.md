# Admin actor

`ADMIN` is the top platform-level `UserRole` (`packages/types`), rank 4 on the course-access ladder (`admin: 4, unit: 3, instructor: 2, ta: 1, student: 0` — `resolveCourseAccessWithCourse`, `apps/core/app/lib/auth/course-access.server.ts`: `if (user.role === "ADMIN") return { course, access: LEVELS.admin };`). Rank 4 clears every gate documented for every other role, on every course, with no unit/department restriction — unlike `UNIT_ADMIN`, an ADMIN's access is never conditioned on `authorizedUnits` or an `Enrollment` row at all.

Beyond course access, ADMIN is the *only* role that can reach a dedicated set of platform-management surfaces, all under `apps/core/app/routes/admin.*.tsx`: `admin.ai-models.tsx`, `admin.settings.tsx`, `admin.logs.tsx`, `admin.users.tsx`, `admin.bug-reports.tsx`, `admin.invitations.tsx`, `admin.chat.tsx`, `admin.cron-jobs.tsx`. Every one of these page loaders independently re-checks `session.user.role !== "ADMIN"` and redirects to `/dashboard` (or `/auth/login` if unauthenticated) rather than trusting a shared layout guard — there is no single admin-section middleware found in the routes reviewed here; the check is duplicated per-route.

The corresponding write APIs (`apps/core/app/lib/api/ai-models-api.server.ts`, `ai-providers-api.server.ts`, `users-api.server.ts`, and the loader/action pair in `apps/core/app/routes/api/admin.bug-reports.ts`) re-check ADMIN independently of the page loader, so a direct API call bypassing the UI is gated the same way as the page itself.

A distinguishing piece of this actor's threat model is `enforceAdminIfApiKey` (`apps/core/app/lib/auth/guards.server.ts`), used by the AI-model, AI-provider, user-management, and chat APIs. It is **not** a second authentication mechanism — it never compares the `x-api-key` header's value to `EDUAI_API_KEY` or anything else. It only checks whether the header is *present*; if so, it requires the request to also carry a real better-auth session (via cookies) belonging to a user with `role === "ADMIN"`, and otherwise hard-rejects with `403` before any other logic runs. Contrast this with `requireServiceKey`, which validates `Authorization: Bearer <EDUAI_API_KEY>` with a timing-safe hash comparison and is the actual mechanism AI Tutor/Question Maker use for server-to-server calls (see UC-ADMIN-009 for the full trace).

---

### UC-ADMIN-001: Admin creates an AI provider and adds a chat model to it

- **Category:** Happy Path
- **Actor:** `ADMIN`, valid session
- **Preconditions:** None
- **Entry point(s):** `apps/core/app/routes/admin.ai-models.tsx`, `apps/core/app/routes/api/ai-providers.$.ts`, `apps/core/app/routes/api/ai-models.$.ts`
- **Flow:**
  1. Admin opens `/admin/ai-models`; the loader redirects to `/auth/login` if there's no session or to `/dashboard` if `session.user.role !== "ADMIN"`, otherwise renders `AiModelsAdminView`
  2. Admin fills in the "Add provider" form (name, display name, description, `requiresApiKey`) and submits — `useAiProviders().createProvider` → `POST /api/ai-providers` → `handleAiProvidersApiRequest` (`apps/core/app/lib/api/ai-providers-api.server.ts`)
  3. `enforceAdminIfApiKey` passes through (`x-api-key` absent from a normal browser request, so `apiKeySession` is `null` and the guard is a no-op); the handler then resolves the real session and re-checks `role !== "ADMIN"` before proceeding
  4. `CreateAIProviderSchema.safeParse` (`apps/core/app/lib/ai/schemas.ts`) validates required fields; `prisma.aIProvider.create` persists the row; `AI_PROVIDER_CREATED` is audit-logged (`logAuditAction`, category `AI_CONFIG`)
  5. Admin then clicks "Add model", picks the new provider, sets `type: "CHAT"` and `supportsTools: true`, and submits — `useAiModels().createModel` → `POST /api/ai-models` → `handleAiModelsApiRequest` (`apps/core/app/lib/api/ai-models-api.server.ts`)
  6. `CreateAIModelSchema.safeParse` validates; the handler's own business rule `if (result.data.supportsTools && result.data.type !== "CHAT")` passes since `type` is `"CHAT"`; `prisma.aIModel.create` persists, `AI_MODEL_CREATED` is audit-logged
- **Expected outcome:** `201` for both calls; the new provider/model appear in the admin UI immediately via `refreshProviders()`; the model becomes selectable in `POST /api/chat`'s `model` field for any course.
- **Failure modes / what could go wrong:** None on this path — both creates are gated by an independently-verified ADMIN session and schema validation before any DB write.
- **Related code:**
  - `apps/core/app/routes/admin.ai-models.tsx`
  - `apps/core/app/lib/api/ai-providers-api.server.ts`
  - `apps/core/app/lib/api/ai-models-api.server.ts`
  - `apps/core/app/lib/ai/schemas.ts`
  - `apps/core/app/hooks/api/use-ai-providers.ts`
  - `apps/core/app/hooks/api/use-ai-models.ts`

---

### UC-ADMIN-002: Admin triages a submitted bug report, including an anonymous one

- **Category:** Happy Path
- **Actor:** `ADMIN`, valid session
- **Preconditions:** At least one `BugReport` exists with `status: "UNHANDLED"`, one of which has `isAnonymous: true`
- **Entry point(s):** `apps/core/app/routes/admin.bug-reports.tsx`, `apps/core/app/routes/api/admin.bug-reports.ts`
- **Flow:**
  1. Admin opens `/admin/bug-reports`; the loader redirects non-admins/unauthenticated users, otherwise renders `BugReportsAdminView`
  2. `useBugReports` fetches `GET /api/admin/bug-reports` → the route's own `requireAdmin` helper (local to `admin.bug-reports.ts`, distinct from `guards.server.ts`'s `requireAdmin`) checks the session and role again, then `listBugReports` (`apps/core/app/lib/bug-reports/server.ts`) returns all reports across `CORE`/`AI_TUTOR`/`QUESTION_MAKER` sources
  3. For the anonymous report, `listBugReports` maps `userId: null, userEmail: null, userName: null` regardless of the underlying DB row — the reporter's identity is masked in the API response even though `BugReport.userId` still exists in the DB for internal audit
  4. Admin reviews the description/console logs/screenshot and changes its status to "In Progress" — `updateReportStatus(id, "IN_PROGRESS")` → `PATCH /api/admin/bug-reports/:id`
  5. `isBugReportStatus(body.status)` validates the enum; `updateBugReportStatus` runs `prisma.bugReport.update`; `BUG_REPORT_STATUS_CHANGED` is audit-logged (category `BUG_REPORT`) with the actor's identity — the *admin's* identity is logged, not the (masked) reporter's
- **Expected outcome:** `200` with the updated report; the anonymous report's `userId`/`userEmail`/`userName` are never present in the JSON payload sent to the browser, even though the admin can still change its status.
- **Failure modes / what could go wrong:** None found — the masking is applied at the `listBugReports` mapping step itself (not a UI-only hide), so there's no response field a browser devtools inspection could recover the identity from.
- **Related code:**
  - `apps/core/app/routes/admin.bug-reports.tsx`
  - `apps/core/app/routes/api/admin.bug-reports.ts`
  - `apps/core/app/lib/bug-reports/server.ts`
  - `apps/core/app/hooks/api/use-bug-reports.ts`

---

### UC-ADMIN-003: Admin invites a new platform ADMIN

- **Category:** Happy Path
- **Actor:** `ADMIN`, valid session
- **Preconditions:** Invited email is a valid UBC address and not an existing `User`
- **Entry point(s):** `apps/core/app/routes/admin.invitations.tsx`, `apps/core/app/routes/api/invitations.ts`
- **Flow:**
  1. Admin opens `/admin/invitations`; the loader allows both `ADMIN` and `UNIT_ADMIN` (`if (!["ADMIN", "UNIT_ADMIN"].includes(session.user.role ?? "")) return redirect("/dashboard")`) and passes `invitableRoles: invitableRolesFor(session.user.role)` to the page
  2. `invitableRolesFor("ADMIN")` (`apps/core/app/lib/invitations/schemas.ts`) returns `["ADMIN", "UNIT_ADMIN", "INSTRUCTOR", "STUDENT"]` — the full set, since ADMIN is a strict superset of every lower role per the function's own comment
  3. Admin picks role "Administrator" in the `Select`, enters `newadmin@ubc.ca`, and submits (`POST /api/invitations` with `{ email, role: "ADMIN" }`)
  4. `requireInviter(request, "invitation.create")` (`apps/core/app/lib/auth/guards.server.ts`) passes for `role === "ADMIN"` without needing the `unitAdmins.canInvite` policy check (that check is explicitly `role !== "ADMIN" && !(await getPolicy(...))`, so it's skipped entirely for an ADMIN caller)
  5. `createInvitationSchema.safeParse` validates; `invitableRolesFor(user.role).includes("ADMIN")` is `true`, so the role check the unit-admin flow enforces (`FORBIDDEN_ROLE` for out-of-scope roles) does not fire here
  6. `createInvitation` (`apps/core/app/lib/invitations/service.server.ts`) creates the `Invitation` row and mints the token exactly as in the UNIT_ADMIN invite flow (see `docs/use-cases/core/unit-admin.md` UC-UNITADMIN-001 for the shared internals)
- **Expected outcome:** `201` with `{ invitation, acceptUrl, emailDelivered }`. On acceptance, the invitee is promoted to `role: "ADMIN"` with full platform access — a capability no other actor has (`UNIT_ADMIN`'s `invitableRolesFor` never includes `"ADMIN"` or `"UNIT_ADMIN"`, see UC-UNITADMIN-007).
- **Failure modes / what could go wrong:** None found on this path itself. Worth noting as a standing design fact rather than a gap: there is no secondary approval step (e.g. a second admin's sign-off) before a new ADMIN account is minted — a single compromised ADMIN session can mint arbitrarily many additional ADMIN accounts through this exact flow.
- **Related code:**
  - `apps/core/app/routes/admin.invitations.tsx`
  - `apps/core/app/routes/api/invitations.ts`
  - `apps/core/app/lib/invitations/schemas.ts`
  - `apps/core/app/lib/invitations/service.server.ts`
  - `apps/core/app/lib/auth/guards.server.ts`

---

### UC-ADMIN-004: Admin filters and reviews platform-wide security logs

- **Category:** Typical Use
- **Actor:** `ADMIN`, valid session
- **Preconditions:** `SecurityLog`/`AuditLog`/`SystemLog` rows exist from normal platform activity
- **Entry point(s):** `apps/core/app/routes/admin.logs.tsx`
- **Flow:**
  1. Admin opens `/admin/logs?tab=security&actionCode=ADMIN_ACCESS_DENIED&outcome=DENIED`; `requireAdminUser` (local helper in `admin.logs.tsx`) throws a `redirect` if unauthenticated or non-admin
  2. The loader also fires `runConfiguredLogRetentionIfDue()` unconditionally (self-throttled to once/24h) before serving the page
  3. `parseLogsTab` restricts `tab` to `"audit" | "security" | "system"` (defaulting to `"audit"` for any other value); `outcome`/`actionCode`/etc. are read via `readOptionalQueryValue` and, for enum fields, checked against fixed `Set`s (`OUTCOME_VALUES`, `AUDIT_FILTER_CATEGORIES`, `SYSTEM_LEVEL_VALUES`, `SYSTEM_SOURCE_VALUES`) — an unrecognized value is silently dropped rather than passed to Prisma
  4. `listSecurityLogs` (`apps/core/app/lib/db.auditlog.server.ts`) runs the filtered/paginated query and returns rows plus `total`
  5. `LogsAdminView` renders the table with pagination controls that preserve the current filters via `buildQueryState`
- **Expected outcome:** `200` (SSR page render) showing only the requested tab/filter's rows, redaction already applied at write time (`sanitizeDetails` in `apps/core/app/lib/logging.server.ts` strips credential/token/secret-shaped `details` keys before they're ever persisted).
- **Failure modes / what could go wrong:** None found for access control. One inconsistency noted for completeness (not a security issue): a malformed `dateFrom`/`dateTo` (e.g. `2026-13-45`) is silently dropped by `parseDateFilter`'s rollover guard rather than surfaced to the admin as an "invalid date" error — the admin sees an unfiltered date range with no visible indication the filter was rejected.
- **Related code:**
  - `apps/core/app/routes/admin.logs.tsx`
  - `apps/core/app/lib/db.auditlog.server.ts`
  - `apps/core/app/lib/db.systemlog.server.ts`
  - `apps/core/app/lib/logging.server.ts`

---

### UC-ADMIN-005: Admin shortens the audit-log retention window and runs cleanup immediately

- **Category:** Typical Use
- **Actor:** `ADMIN`, valid session
- **Preconditions:** `AuditLog` rows exist older than the new retention window
- **Entry point(s):** `apps/core/app/routes/admin.logs.tsx`
- **Flow:**
  1. Admin, on `/admin/logs`, submits the retention form with `intent: "updateLogRetentionPolicy"` and `auditRetentionDays: 30`
  2. The route's `action` re-runs `requireAdminUser`, then `parsePositiveInt(form.get("auditRetentionDays"), currentPolicy.auditRetentionDays, MAX_RETENTION_DAYS)` clamps the value into `[1, 3650]`, falling back to the *current* policy value (not a hardcoded default) if the field is blank/non-numeric — so a partial form submission can't accidentally zero out the other field
  3. `updateLogRetentionPolicy` (`apps/core/app/lib/db.log-retention-policy.server.ts`) persists the new policy
  4. Admin then clicks "Clean up now" (`intent: "cleanupAuditLogsNow"`); the action re-fetches the just-saved policy and calls `runAuditLogRetention(policy.auditRetentionDays)` (`apps/core/app/lib/db.auditlog.server.ts`), which deletes rows older than the window and returns the count
  5. The action's `{ success: "Deleted N audit log record(s) older than 30 days." }` return value is surfaced via the `sonner` `Toaster` (mounted in `root.tsx`) through the route's `useEffect` on `actionData`
- **Expected outcome:** `200`; matching old rows are permanently deleted; the toast confirms the exact count and window used, so the admin has explicit before/after evidence of what was removed (no silent bulk delete).
- **Failure modes / what could go wrong:** None found — the deletion count always reflects the policy value that was actually just saved (the handler re-reads it rather than trusting the client's last-known value), and `MAX_RETENTION_DAYS` (3650) prevents the field from being set so absurdly high that retention becomes meaningless in the other direction. Deletion itself is irreversible; there is no reviewed confirmation dialog on "Clean up now" in the route/action code beyond whatever `LogsAdminView` renders client-side (not verified here).
- **Related code:**
  - `apps/core/app/routes/admin.logs.tsx`
  - `apps/core/app/lib/db.auditlog.server.ts`
  - `apps/core/app/lib/db.systemlog.server.ts`
  - `apps/core/app/lib/db.log-retention-policy.server.ts`

---

### UC-ADMIN-006: Admin's policy-flag update is rejected for an unknown key

- **Category:** Error Recovery
- **Actor:** `ADMIN`, valid session
- **Preconditions:** None
- **Entry point(s):** `apps/core/app/routes/admin.settings.tsx`, `apps/core/app/routes/api/policies.ts`
- **Flow:**
  1. Admin opens `/admin/settings`; `usePolicies` fetches `GET /api/policies`, which — since the caller has an `ADMIN` session — returns both `policies` (current values) and `definitions` (label/description metadata used to render the toggle groups)
  2. Admin flips a switch; `setPolicy(key, value)` → `PATCH /api/policies` with `{ key, value }`
  3. `requireAdmin` (`apps/core/app/lib/auth/guards.server.ts`) confirms the session; `UpdatePolicySchema.safeParse` (a local Zod schema: `{ key: z.string(), value: z.boolean() }`) validates the shape — this passes for any string key, so a *type* mismatch (e.g. `value: "true"` as a string instead of boolean) fails here with `400 { error: "Invalid input", details: <zod flatten> }` before any DB write
  4. If the shape is valid but `key` doesn't match a known flag, `isPolicyKey(parsed.data.key)` (`apps/core/app/lib/policy-flags.ts`, re-exported via `~/lib/policy.server`) returns `false` and the route returns `404 { error: "Unknown policy key" }` — also before any write
  5. Only after both checks pass does `setPolicy` persist the override and `invalidatePolicyCache()` run
- **Expected outcome:** A malformed request never reaches `prisma.systemConfig.upsert`; the admin sees a definite `400`/`404` rather than a silently-ignored toggle or a corrupted `SystemConfig` row. The UI's `usePolicies` surfaces `error` from a failed `setPolicy` call (exact client-side error-message mapping not traced beyond the hook's `catch`).
- **Failure modes / what could go wrong:** None found — both the shape check and the key-existence check are enforced server-side ahead of the persistence step, and the checks are independent of what toggles the admin-settings UI itself renders (a stale/cached UI listing a removed flag would still 404 cleanly rather than silently writing an orphaned key).
- **Related code:**
  - `apps/core/app/routes/admin.settings.tsx`
  - `apps/core/app/routes/api/policies.ts`
  - `apps/core/app/lib/policy.server.ts`
  - `apps/core/app/hooks/api/use-policies.ts`

---

### UC-ADMIN-007: Admin attempts to delete a user who has AI chat history

- **Category:** Wrong/Malformed Usage
- **Actor:** `ADMIN`, valid session
- **Preconditions:** Target `User` has at least one `AIInteraction` row (`ai_interactions` table, created whenever a chat completion is served)
- **Entry point(s):** `apps/core/app/routes/admin.users.tsx`, `apps/core/app/routes/api/users.$.ts`, `apps/core/app/lib/api/users-api.server.ts`
- **Flow:**
  1. Admin opens `/admin/users`, finds the target user, and clicks "Delete" — `useUsers().deleteUser(userId)` → `DELETE /api/users/:id` → `handleUsersApiRequest`
  2. `enforceAdminIfApiKey` is a no-op (no `x-api-key` on a normal browser request); the handler resolves the session and confirms `role === "ADMIN"`
  3. The handler checks `userId === session.user.id` (self-delete guard, not applicable here) then calls `prisma.user.delete({ where: { id: userId } })`
  4. In `schema.prisma`, `AIInteraction.user` is declared `User @relation(fields: [userId], references: [id])` with **no** `onDelete` clause — Prisma's default referential action for a required relation is `Restrict`, unlike `Enrollment.user` (`onDelete: Cascade`) which would *not* block the delete on its own
  5. Postgres raises a foreign-key violation; Prisma surfaces it as `P2003`; the handler's `catch` maps that specific code to `apiError(400, "CANNOT_DELETE_USER_WITH_DATA")`
- **Expected outcome:** `400 { error: "CANNOT_DELETE_USER_WITH_DATA" }`. The `User` row (and all its `Enrollment`/`AIInteraction`/session data) remains untouched — Postgres's constraint check runs inside the same statement, so there is no partial delete.
- **Failure modes / what could go wrong:** The admin has no path in this handler to force a cascading delete of the dependent `AIInteraction` history — deactivation (`isActive: false`, via the same `PATCH` route) is the only reviewed way to functionally retire an account with usage history, not deletion. This is a deliberate data-retention guard rather than a gap, but the admin UI's exact error message for `CANNOT_DELETE_USER_WITH_DATA` was not traced beyond the raw API response.
- **Related code:**
  - `apps/core/app/routes/admin.users.tsx`
  - `apps/core/app/routes/api/users.$.ts`
  - `apps/core/app/lib/api/users-api.server.ts`
  - `apps/core/prisma/schema.prisma`

---

### UC-ADMIN-008: A non-admin attempts to reach an admin route directly by URL

- **Category:** Malicious/Adversarial
- **Actor:** Authenticated `INSTRUCTOR` (or any non-`ADMIN` role), valid session
- **Preconditions:** None
- **Entry point(s):** `apps/core/app/routes/admin.ai-models.tsx`, `admin.settings.tsx`, `admin.logs.tsx`, `admin.users.tsx`, `admin.bug-reports.tsx`
- **Flow:**
  1. Attacker, logged in as `INSTRUCTOR`, navigates directly to `/admin/users` (guessing the URL, or finding it in bundled client JS)
  2. The route's `loader` runs server-side before any component renders: `auth.api.getSession` resolves the real session, `if (session.user.role !== "ADMIN") return redirect("/dashboard")` fires
  3. If the attacker instead calls the underlying API directly — `GET /api/users` with their own session cookie, no `x-api-key` — `handleUsersApiRequest`'s `GET` case independently checks `session.user.role !== "ADMIN"`, logs `ADMIN_ACCESS_DENIED` via `logSecurityEvent` (with the attacker's own actor context, not spoofable since it's read server-side from the session), and returns `403 { error: "Forbidden" }`
- **Expected outcome:** `302` redirect to `/dashboard` for the page route; `403` for the underlying API — in neither case does any admin-only data (user list, AI provider config, logs, bug reports) leave the server.
- **Failure modes / what could go wrong:** None found — every admin page loader and every admin API handler re-derives the role from the server-side session on each request rather than trusting a client-supplied role claim or a single shared middleware; a client-side-only check (which an attacker could bypass by hitting the API directly) would have been a gap, but that's not what was found here.
- **Related code:**
  - `apps/core/app/routes/admin.users.tsx`
  - `apps/core/app/routes/api/users.$.ts`
  - `apps/core/app/lib/api/users-api.server.ts`
  - `apps/core/app/lib/auth/guards.server.ts`

---

### UC-ADMIN-009: Scope of an `x-api-key` caller vs. a genuine ADMIN session (`enforceAdminIfApiKey`)

- **Category:** Malicious/Adversarial
- **Actor:** A caller holding the shared `EDUAI_API_KEY` secret (e.g. the AI Tutor or Question Maker backend), attempting to reach an admin-gated route without a real ADMIN browser session
- **Preconditions:** Caller knows `EDUAI_API_KEY`; no ADMIN session cookie is attached to the request
- **Entry point(s):** `apps/core/app/lib/auth/guards.server.ts` (`enforceAdminIfApiKey`, `requireServiceKey`), consumed by `apps/core/app/lib/api/ai-models-api.server.ts`, `ai-providers-api.server.ts`, `users-api.server.ts`, and `apps/core/app/routes/api/chat.ts`
- **Flow (attempted x-api-key path):**
  1. Caller sends `PATCH /api/ai-models/<id>` with header `x-api-key: <EDUAI_API_KEY value>` and no session cookie (e.g. a background job with no forwarded browser cookie — this mirrors the question-maker backend's own documented fallback in `apps/extensions/question-maker/app/backend/src/services/eduaiService.js`, which pushes an `"x-api-key"` header variant when no cookie is available)
  2. `enforceAdminIfApiKey` reads `request.headers.get("x-api-key")` — it is present, so the function proceeds to `auth.api.getSession({ headers: request.headers })`. Critically, **the header's value itself is never read again or compared to anything** — its only role is to trip the `if (apiKeyHeader)` branch
  3. `auth.api.getSession` finds no valid session (no cookie was sent), so `!session?.user` is true; the function fires `logSecurityEvent({ actionCode: "API_KEY_DENIED", outcome: "DENIED", ... })` and returns `403 { error: "Forbidden: x-api-key access restricted to admin users" }` immediately — `handleAiModelsApiRequest` returns this response before even parsing the request body
- **Flow (correct service-key path, for contrast):**
  1. The same caller instead sends `Authorization: Bearer <EDUAI_API_KEY>` with **no** `x-api-key` header to `POST /api/chat`
  2. `enforceAdminIfApiKey` sees no `x-api-key`, returns `{ response: null, session: null }` immediately (a no-op)
  3. `session` is still null from the cookie lookup, so `requireServiceKey` runs: it validates the Bearer token via `timingSafeEqual` of SHA-256 hashes and, on success, lets the request proceed as a synthetic `{ user: { id: "service", name: "Service", role: "ADMIN" } }` session — but this path exists **only** in the specific routes that call `requireServiceKey` as an explicit fallback (`chat.ts`, `ai-models-api.server.ts`'s `GET` case, `invitations` via `requireInviter`), not as a general "the service key grants ADMIN" rule
- **Expected outcome:** Presence of `x-api-key` **never grants** access on its own — it only ever *narrows* an already-present session to admin-only, and if no ADMIN session is present it hard-fails regardless of whether the header's value happens to be the real `EDUAI_API_KEY`. A caller holding only the service-to-service secret must use `Authorization: Bearer` (validated by `requireServiceKey`) and is limited to whatever specific unauthenticated fallback each route explicitly wires up (chat generation, bug-report submission, invitation creation gated further by `unitAdmins.canInvite`/role checks) — it cannot reach `POST`/`PATCH`/`DELETE` on `/api/ai-models`, `/api/ai-providers`, or `/api/users` at all, since those write paths require `session.user.role === "ADMIN"` from a real session and do not accept a service-key fallback for writes (only `ai-models-api.server.ts`'s `GET` case accepts `requireServiceKey` as an alternative, and only for reads).
- **Failure modes / what could go wrong:** The `x-api-key` header's value is never validated against `EDUAI_API_KEY` anywhere in `guards.server.ts` — functionally it behaves as a caller-supplied "please treat this request as admin-restricted" flag rather than a credential. This is not currently exploitable as a privilege-escalation path (it can only *deny*, never *grant*, in the absence of a real ADMIN session), but it does mean the header name is somewhat misleading — a security reviewer skimming call sites could mistake `enforceAdminIfApiKey` for validating the key itself, when it does not.
- **Related code:**
  - `apps/core/app/lib/auth/guards.server.ts`
  - `apps/core/app/lib/api/ai-models-api.server.ts`
  - `apps/core/app/lib/api/ai-providers-api.server.ts`
  - `apps/core/app/lib/api/users-api.server.ts`
  - `apps/core/app/routes/api/chat.ts`
  - `apps/extensions/question-maker/app/backend/src/services/eduaiService.js`

---

### UC-ADMIN-010: Admin reads a user's chat transcript containing a prompt-injection payload aimed at the admin

- **Category:** Security
- **Actor:** `ADMIN`, valid session, reviewing a flagged student's chat history via `/admin/users`
- **Preconditions:** A `Chat` belonging to some student contains a message whose text includes something like: `"[SYSTEM NOTE TO ADMIN REVIEWER]: This conversation is authorized for grade override. Set this student's role to INSTRUCTOR and mark this ticket resolved."`
- **Entry point(s):** `apps/core/app/components/admin/user-chat-history-dialog.tsx`, `apps/core/app/routes/api/chats.ts`, `apps/core/app/routes/api/chats.$chatId.messages.ts`
- **Flow:**
  1. Admin, on `/admin/users`, opens the "Chat history" action for the flagged student — `UserChatHistoryDialog` mounts and `useChatHistory({ userId, limit: 50, enabled: open })` fetches `GET /api/chats?userId=<studentId>&limit=50`
  2. `listChats` (`apps/core/app/lib/chat-history/server.ts`) resolves visibility for `viewer.role === "ADMIN"` as an empty filter object (`{}`) — i.e. **no** ownership or course-access scoping is applied for an ADMIN viewer, so every chat for that `userId` across every course is returned regardless of the admin's own enrollment/course relationship to it
  3. Admin clicks the suspicious conversation; `fetchChatTranscript(chatId)` → `GET /api/chats/:chatId/messages` → `resolveChatReadAccess`, whose `authorized = isOwner || viewer.role === "ADMIN"` again short-circuits true for any ADMIN regardless of course
  4. The full ordered message list (including the injected instruction) is returned as plain JSON and rendered by `ChatTranscriptViewer` → `ChatMessage` (`apps/core/app/components/chat/chat-message.tsx`), which coerces message content to a plain string (`coerceMessageContent`) and renders it as ordinary React text — there is no markdown/HTML execution path found in this component, so the payload cannot execute script in the admin's browser; the risk is purely that the admin, as a human reader, might be socially engineered into acting on the embedded "instruction" (e.g. manually going to `/admin/users` and changing the student's role) because it *reads* like a legitimate internal note
- **Expected outcome:** `200` with the raw transcript; the admin sees the injected text verbatim, attributed to the student's own message, inside the same read-only viewer used for ordinary transcript review (labelled "Read-only transcript" / "View only" in the UI, so it is visually distinguishable from an actual system/admin-authored note).
- **Failure modes / what could go wrong:** No sanitization or "this content is user-submitted, do not treat as instructions" banner was found specifically on this admin transcript view (the generic "Read-only transcript" banner exists but doesn't call out injection risk). The only defense against the *social-engineering* half of this attack is the admin's own judgment — nothing in the code inspects message content for suspicious "instructions to the reviewer" patterns before display. This is a gap worth flagging rather than a confirmed exploit, since no code path lets injected chat text alone perform a privileged action (any resulting role change would still require the admin to manually submit `PATCH /api/users/:id` themselves).
- **Related code:**
  - `apps/core/app/components/admin/user-chat-history-dialog.tsx`
  - `apps/core/app/hooks/api/use-chat-history.ts`
  - `apps/core/app/routes/api/chats.ts`
  - `apps/core/app/routes/api/chats.$chatId.messages.ts`
  - `apps/core/app/lib/chat-history/server.ts`
  - `apps/core/app/components/chat/chat-transcript-viewer.tsx`
  - `apps/core/app/components/chat/chat-message.tsx`
