# Unauthenticated actor

An unauthenticated actor has no valid session — either never logged in, or a session that has expired/been revoked. This file covers pre-login browsing, the login/registration flow, and adversarial probing of protected routes without credentials.

Core has no single global auth gate: `apps/core/app/root.tsx`'s loader calls `auth.api.getSession` and falls back to `GUEST_ROOT_PREFERENCES` for unauthenticated requests (it does not redirect), so gating is enforced per-route. Each protected page loader (e.g. `apps/core/app/routes/dashboard.tsx`, `apps/core/app/routes/courses.$courseId.tsx`, `apps/core/app/routes/admin.users.tsx`) independently calls `auth.api.getSession` and redirects to `/auth/login` if there is no session. API routes under `apps/core/app/routes/api/` return a `401 Unauthorized` JSON body instead of redirecting.

---

### UC-UNAUTH-001: Visiting `/login` and signing in successfully

- **Category:** Happy Path
- **Actor:** No session (fresh browser, no cookie)
- **Preconditions:** A `User` row exists with an active credential account (`isActive: true`)
- **Entry point(s):** `apps/core/app/routes/login.ts`, `apps/core/app/routes/auth/login.tsx`
- **Flow:**
  1. Actor navigates to `/login` and is redirected, preserving any query string, to `/auth/login` (`apps/core/app/routes/login.ts` loader → `redirect('/auth/login${search}')`)
  2. `/auth/login`'s loader calls `auth.api.getSession` and, finding none, computes `redirectTo` from `?redirect=` via `validateRedirectUrl` (`apps/core/app/lib/auth/guards.server.ts`) and reads the `auth.allowPublicRegistration` policy (`apps/core/app/lib/policy.server.ts`) to decide whether to show the "Sign up" link
  3. Actor fills in email/password and submits the form (`apps/core/app/routes/auth/login.tsx` action)
  4. Action validates the input with `signInSchema` (`apps/core/app/lib/auth/schemas.ts`)
  5. Action builds an internal sub-request to `/api/auth/sign-in/email` via `buildAuthSubRequest` and calls `auth.handler` (`apps/core/app/lib/auth/auth-handler-request.ts`, `apps/core/app/lib/auth/server.ts`)
  6. On success, `appendAuthSetCookies` copies the session cookie onto the outer response (`apps/core/app/lib/auth/forward-session-cookies.ts`), a `LOGIN_SUCCESS` security event is logged (`apps/core/app/lib/logging.server.ts`), and the actor is redirected to `redirectTo` (default `/dashboard`)
- **Expected outcome:** `302` redirect to `redirectTo` (or `/dashboard`) with a `Set-Cookie` session header; `LOGIN_SUCCESS` audit row written.
- **Failure modes / what could go wrong:** None expected on the happy path; deactivated-user and bad-password cases are covered separately (UC-UNAUTH-004, UC-UNAUTH-008).
- **Related code:**
  - `apps/core/app/routes/login.ts`
  - `apps/core/app/routes/auth/login.tsx`
  - `apps/core/app/lib/auth/guards.server.ts`
  - `apps/core/app/lib/auth/schemas.ts`
  - `apps/core/app/lib/auth/server.ts`
  - `apps/core/app/lib/auth/forward-session-cookies.ts`

---

### UC-UNAUTH-002: Browsing the public marketing pages

- **Category:** Typical Use
- **Actor:** No session
- **Preconditions:** None
- **Entry point(s):** `apps/core/app/routes/home.tsx`, `apps/core/app/routes/team.tsx`
- **Flow:**
  1. Actor navigates to `/` (`apps/core/app/routes/home.tsx` loader calls `auth.api.getSession`; with no session it returns `{}` and renders the marketing page instead of redirecting)
  2. Root loader (`apps/core/app/root.tsx`) resolves guest UI defaults (`GUEST_ROOT_PREFERENCES`) and platform policies (`getPolicies`) in parallel so the page renders without a session
  3. Actor clicks through to `/team` (`apps/core/app/routes/team.tsx`) to view the research team page — no session check gates this route
- **Expected outcome:** `200` with the marketing/team page rendered; no cookies set, no DB writes.
- **Failure modes / what could go wrong:** None — this is intentionally public. If a session *does* exist, `home.tsx`'s loader redirects to `/dashboard` instead of showing the marketing page.
- **Related code:**
  - `apps/core/app/routes/home.tsx`
  - `apps/core/app/routes/team.tsx`
  - `apps/core/app/root.tsx`

---

### UC-UNAUTH-003: Session expires mid-use; redirected to login (redirect-back gap)

- **Category:** Error Recovery
- **Actor:** Actor whose session cookie has expired or been deleted server-side (e.g. deactivated mid-session, per the `after` hook in `apps/core/app/lib/auth/server.ts`)
- **Preconditions:** Actor was previously on `/dashboard` or `/courses/:courseId` with a session that is no longer valid
- **Entry point(s):** `apps/core/app/routes/dashboard.tsx`, `apps/core/app/routes/courses.$courseId.tsx`
- **Flow:**
  1. Actor's browser re-requests a protected page, e.g. `/dashboard` (`apps/core/app/routes/dashboard.tsx` loader)
  2. Loader calls `auth.api.getSession`; the `after` hook on `/get-session` (`apps/core/app/lib/auth/server.ts`) has already deleted the session row if the user was deactivated, or better-auth's own expiry check fails it
  3. Loader executes `if (!session?.user) return redirect("/auth/login")` — **note this redirect does not attach a `?redirect=` query param**, so `/auth/login`'s `redirectTo` defaults to `/dashboard` regardless of which page the actor was actually on
  4. Actor logs in again and lands on `/dashboard`, not the original page (e.g. `/courses/42`) they were viewing
- **Expected outcome:** `302` to `/auth/login`, then after re-auth a `302` to `/dashboard` (default), not necessarily back to the original URL.
- **Failure modes / what could go wrong:** This is a UX gap, not a security issue: `dashboard.tsx` and `courses.$courseId.tsx` (and other protected loaders) call `redirect('/auth/login')` with no `redirect` query param, so the "return to where you were" behavior only works when the caller explicitly builds `/auth/login?redirect=...` (as `apps/core/app/routes/login.ts` does by forwarding the original search string). No code was found that appends the current pathname when a *page loader* (as opposed to the `/login` redirector) bounces an expired session to `/auth/login`.
- **Related code:**
  - `apps/core/app/routes/dashboard.tsx`
  - `apps/core/app/routes/courses.$courseId.tsx`
  - `apps/core/app/routes/auth/login.tsx`
  - `apps/core/app/lib/auth/guards.server.ts`
  - `apps/core/app/lib/auth/server.ts`

---

### UC-UNAUTH-004: Submitting malformed or invalid login credentials

- **Category:** Wrong/Malformed Usage
- **Actor:** No session
- **Preconditions:** None
- **Entry point(s):** `apps/core/app/routes/auth/login.tsx`
- **Flow:**
  1. Actor submits the login form with an invalid email format or a password under 8 characters
  2. Action validates with `signInSchema.safeParse` (`apps/core/app/lib/auth/schemas.ts`); on failure it returns `{ fieldErrors }` without calling `auth.handler` at all
  3. Form re-renders with per-field error messages ("Please enter a valid email address" / "Password must be at least 8 characters")
  4. If the input passes Zod but the credentials are simply wrong, the sub-request to `/api/auth/sign-in/email` returns a non-OK response; the action logs `LOGIN_FAILED` (`apps/core/app/lib/logging.server.ts`) with the attempted email as `entityLabel`, and returns `{ formError }` built from the response body
- **Expected outcome:** `200` (loader/action render, no redirect); no session cookie set; `LOGIN_FAILED` audit row written for wrong-but-well-formed credentials.
- **Failure modes / what could go wrong:** None found — validation happens before any credential check, so malformed input never reaches better-auth's password comparison.
- **Related code:**
  - `apps/core/app/routes/auth/login.tsx`
  - `apps/core/app/lib/auth/schemas.ts`
  - `apps/core/app/lib/logging.server.ts`

---

### UC-UNAUTH-005: Directly POSTing to `/api/chat` with no session

- **Category:** Malicious/Adversarial
- **Actor:** No session, no `x-api-key`, no `Authorization` header
- **Preconditions:** None
- **Entry point(s):** `apps/core/app/routes/api/chat.ts`
- **Flow:**
  1. Attacker sends `POST /api/chat` directly (no browser session cookie) with a crafted JSON body
  2. Action calls `enforceAdminIfApiKey(request)` (`apps/core/app/lib/auth/guards.server.ts`); with no `x-api-key` header this is a no-op (`{ response: null, session: null }`)
  3. Action calls `auth.api.getSession({ headers: request.headers })`; no cookie means `session` is `null`
  4. Since `!session?.user`, action calls `requireServiceKey(request)` (`apps/core/app/lib/auth/guards.server.ts`) looking for `Authorization: Bearer <EDUAI_API_KEY>`; absent, so it returns a `401 { error: "MISSING_SERVICE_KEY" }` response, which is returned to the caller as `serviceKeyError`
  5. (If a service key header had been present but invalid, this would instead be a `403 { error: "INVALID_SERVICE_KEY" }`.)
- **Expected outcome:** `401 { "error": "MISSING_SERVICE_KEY" }` (per `apps/core/app/routes/api/chat.ts`'s branch at the `!session?.user` check); the model is never invoked, no DB writes occur.
- **Failure modes / what could go wrong:** Guarded correctly — the route requires either a valid better-auth session, an admin `x-api-key`, or a valid `EDUAI_API_KEY` bearer token before any chat logic runs.
- **Related code:**
  - `apps/core/app/routes/api/chat.ts`
  - `apps/core/app/lib/auth/guards.server.ts`

---

### UC-UNAUTH-006: Hitting an admin-only route while unauthenticated

- **Category:** Malicious/Adversarial
- **Actor:** No session
- **Preconditions:** None
- **Entry point(s):** `apps/core/app/routes/admin.users.tsx`
- **Flow:**
  1. Attacker navigates directly to `/admin/users` with no session cookie
  2. Loader calls `auth.api.getSession({ headers: request.headers })`; `session` resolves to `null`
  3. `if (!session?.user) return redirect('/auth/login')` fires before the `role !== 'ADMIN'` check is ever reached
- **Expected outcome:** `302` redirect to `/auth/login`; no user list data, no admin UI rendered, no information disclosed about whether the route even exists.
- **Failure modes / what could go wrong:** None found for the unauthenticated case specifically — the loader checks session presence before role, so an anonymous request gets the same redirect as any other unauthenticated page. (A *logged-in but non-admin* actor gets a distinct `redirect('/dashboard')` branch — that scenario belongs in the STUDENT/INSTRUCTOR actor files, not here.)
- **Related code:**
  - `apps/core/app/routes/admin.users.tsx`

---

### UC-UNAUTH-007: Attempting public self sign-up when registration is disabled

- **Category:** Malicious/Adversarial
- **Actor:** No session
- **Preconditions:** `auth.allowPublicRegistration` policy is off
- **Entry point(s):** `apps/core/app/routes/auth/register.tsx`, `apps/core/app/routes/api/auth.$.ts`
- **Flow:**
  1. Attacker either loads `/auth/register` (loader reads `getPolicy("auth.allowPublicRegistration")` and returns `{ registrationDisabled: true }`, so the page shows an "invite-only" message instead of a form) or bypasses the UI and POSTs directly to `/api/auth/sign-up/email`
  2. A direct POST reaches `apps/core/app/routes/api/auth.$.ts`, which strips any internal invite-signup header (`stripInternalAuthHeaders`, `apps/core/app/lib/auth/auth-handler-request.ts`) before forwarding to `auth.handler`
  3. `betterAuth`'s `before` hook in `apps/core/app/lib/auth/server.ts` runs: for `ctx.path === "/sign-up/email"` with no `INTERNAL_INVITE_SIGNUP_HEADER`, it calls `getPolicy("auth.allowPublicRegistration")`; if disabled, it logs a `logPolicyDenial` and throws `APIError("FORBIDDEN", { message: "Public registration is disabled" })`
- **Expected outcome:** UI path shows the disabled-registration message (`200`, no form); direct-POST path returns a `403`-class error from better-auth with "Public registration is disabled"; a `POLICY_DENIAL` log entry is recorded via `logPolicyDenial`.
- **Failure modes / what could go wrong:** The header-stripping in `apps/core/app/routes/api/auth.$.ts` is what prevents a browser from forging the `INTERNAL_INVITE_SIGNUP_HEADER` to bypass this check on a direct POST — confirmed present via `stripInternalAuthHeaders`.
- **Related code:**
  - `apps/core/app/routes/auth/register.tsx`
  - `apps/core/app/routes/api/auth.$.ts`
  - `apps/core/app/lib/auth/server.ts`
  - `apps/core/app/lib/auth/auth-handler-request.ts`

---

### UC-UNAUTH-008: Signing in as a deactivated user

- **Category:** Wrong/Malformed Usage
- **Actor:** Actor with correct credentials for a `User` row where `isActive: false`
- **Preconditions:** A deactivated account with a known-correct password exists
- **Entry point(s):** `apps/core/app/routes/auth/login.tsx`
- **Flow:**
  1. Actor submits correct email/password for a deactivated account
  2. The `before` hook in `apps/core/app/lib/auth/server.ts` intercepts `ctx.path === "/sign-in/email"`, looks up `prisma.user.findUnique({ where: { email }, select: { isActive: true } })`; finding `isActive: false`, it still hashes the submitted password (`ctx.context.password.hash(password)`) to keep timing consistent with the "user not found" branch, then throws `APIError("UNAUTHORIZED", { message: "Invalid email or password" })`
  3. `auth.handler` returns a non-OK response; the login action logs `LOGIN_FAILED` and returns `{ formError: "Invalid email or password" }` (or the `response.status`-suffixed fallback message)
- **Expected outcome:** Login form re-renders with a generic "Invalid email or password" error — the account is never told it was deactivated specifically, and no session cookie is issued.
- **Failure modes / what could go wrong:** None found — the deliberate dummy-hash call is there specifically so response timing can't be used to distinguish "wrong password" from "deactivated account".
- **Related code:**
  - `apps/core/app/lib/auth/server.ts`
  - `apps/core/app/routes/auth/login.tsx`

---

### UC-UNAUTH-009: Open-redirect attempt via the login `redirect` query param

- **Category:** Security
- **Actor:** No session
- **Preconditions:** None
- **Entry point(s):** `apps/core/app/routes/auth/login.tsx`, `apps/core/app/lib/auth/guards.server.ts`
- **Flow:**
  1. Attacker crafts a phishing link like `/login?redirect=https://evil.example.com` or the backslash-obfuscated `/login?redirect=/\evil.com` (browsers normalize `\` to `/`, yielding the protocol-relative `//evil.com`) and sends it to a victim
  2. `/login` redirects to `/auth/login${search}`, preserving the `redirect` param (`apps/core/app/routes/login.ts`)
  3. `/auth/login`'s loader calls `validateRedirectUrl(url.searchParams.get("redirect"))` (`apps/core/app/lib/auth/guards.server.ts`): it normalizes backslashes to `/` first, then rejects anything starting with `//`, and for absolute URLs only allows `localhost`/`127.0.0.1` or `*.eduai.ok.ubc.ca`/`eduai.ok.ubc.ca` hostnames — anything else falls back to `/dashboard`
  4. Victim logs in; the hidden `redirectTo` form field carries the *sanitized* value through to the post-login `redirect()` call in the action
- **Expected outcome:** Victim is redirected to `/dashboard` (or another same-origin/allow-listed path), never to the attacker's external domain.
- **Failure modes / what could go wrong:** Guarded — `validateRedirectUrl` is the single chokepoint used by both the loader (to render the hidden field) and is re-applied server-side on the action's own `formData.redirectTo` read, so a tampered hidden-field value on submit is re-validated rather than trusted.
- **Related code:**
  - `apps/core/app/routes/login.ts`
  - `apps/core/app/routes/auth/login.tsx`
  - `apps/core/app/lib/auth/guards.server.ts`

---

### UC-UNAUTH-010: Replaying an expired or tampered session cookie against `/api/sessions/validate`

- **Category:** Security
- **Actor:** Attacker holding a stale/expired or bit-flipped session cookie value (e.g. intercepted from a log, or a guessed token)
- **Preconditions:** None (the target session may or may not have ever been valid)
- **Entry point(s):** `apps/core/app/routes/api/sessions.validate.ts`
- **Flow:**
  1. Attacker sends `POST /api/sessions/validate` with a forged/expired `Cookie` header
  2. Route first derives the request IP via `getRequestContext` and checks `isRateLimited(ip)` (`apps/core/app/lib/auth/rate-limit.server.ts`, in-memory, default 300/min via `SESSION_VALIDATE_RATE_LIMIT`); if tripped, logs `RATE_LIMIT_EXCEEDED` and returns `429`
  3. Otherwise calls `auth.api.getSession({ headers: request.headers })`; better-auth verifies the session token/signature against its `Session` table and expiry — a tampered or unknown token fails verification and resolves to `null`
  4. `if (!session?.user)` returns `401 { error: "Unauthorized" }`
- **Expected outcome:** `401 { "error": "Unauthorized" }` for any cookie that doesn't map to a live, non-expired, non-deactivated-owner `Session` row; `429` if the same IP has exceeded the validate-endpoint rate limit.
- **Failure modes / what could go wrong:** The rate limiter (`apps/core/app/lib/auth/rate-limit.server.ts`) is a plain in-memory `Map` keyed by IP with no persistence or distributed coordination — it resets on process restart and does not share state across multiple server instances, so it is a soft mitigation against brute-force/credential-stuffing probing of this endpoint rather than a hard guarantee in a multi-instance deployment. Token verification itself relies entirely on better-auth's internal session-lookup/expiry logic; no separate signature-tampering check was found or needed to be — a modified token simply won't match a stored session.
- **Related code:**
  - `apps/core/app/routes/api/sessions.validate.ts`
  - `apps/core/app/lib/auth/rate-limit.server.ts`
  - `apps/core/app/lib/auth/server.ts`
