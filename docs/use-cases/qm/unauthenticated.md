# Unauthenticated actor

QM has no session system of its own — every protected route validates the caller's cookie against Core's `POST /api/sessions/validate` on **every request** (`requireAuth`, `middleware/auth.js`); there is no local session store, token issuance, or QM-side login page. This backend is API-only (`app.js` mounts everything under `/api/*`, plus `GET /` and `GET /healthz` as unauthenticated info/health endpoints) — there is no non-API page route in this Express app at all.

One documentation/code mismatch worth noting up front: `requireAuth`'s own header comment claims *"API routes (path starts with /api/) return 401 on failure; other routes redirect to Core login with a `?redirect=` param so the user lands back here."* The actual implementation has **no such branching** — it unconditionally returns `401 JSON` regardless of path, for every route. Given this backend has no non-`/api` protected routes to redirect *from* in the first place, the comment describes a code path that doesn't exist and, as far as this router structure goes, couldn't currently apply to anything.

---

### UC-UNAUTH-001: First-ever authenticated request provisions only a thin local user

- **Category:** Happy Path
- **Actor:** Any Core-authenticated user (any platform role) hitting QM for the very first time
- **Preconditions:** Valid Core session cookie; no local QM `User` row exists yet for this Core user id
- **Entry point(s):** `middleware/auth.js` (`requireAuth`), `services/authService.js` (`findOrCreateUser`)
- **Flow:**
  1. User's browser sends any request to a `requireAuth`-gated QM route with a valid Core session cookie (e.g. the frontend's initial `GET /api/auth/me`)
  2. `requireAuth` validates against Core, gets back `{ user: coreUser }`, normalizes the role, and calls `findOrCreateUser(normalizedUser)`
  3. `prisma.user.upsert` creates the local row with `id`, `email`, and `name`
     when it does not already exist
  4. No course or demo-content seeding is invoked from authentication
- **Expected outcome:** QM has the thin local identity needed for foreign keys.
  Courses arrive only through Core-linked ensure/import flows.
- **Failure modes / what could go wrong:** None found. A platform `STUDENT`
  receives no demo courses or instructor-rank content as a side effect of
  authentication.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/middleware/auth.js`
  - `apps/extensions/question-maker/app/backend/src/services/authService.js`

---

### UC-UNAUTH-002: Returning authenticated user provisioning is idempotent

- **Category:** Typical Use
- **Actor:** Any previously-provisioned user, valid Core session
- **Preconditions:** Local `User` row already exists
- **Entry point(s):** `middleware/auth.js`, `services/authService.js`
- **Flow:**
  1. `requireAuth` validates the session and calls `findOrCreateUser` again (every request, not just the first)
  2. `prisma.user.upsert` matches the row by Core user id and applies an empty
     update
  3. `req.user` is populated from the freshly validated Core response
- **Expected outcome:** No duplicate user or course rows are created.
- **Failure modes / what could go wrong:** The local identity fields are not
  refreshed on later requests because the upsert update is intentionally
  empty; authorization still uses the current Core response rather than the
  local row.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/services/authService.js`

---

### UC-UNAUTH-003: Sign-out succeeds even with no session at all

- **Category:** Typical Use
- **Actor:** Unauthenticated caller (no cookie, expired cookie, or already-signed-out session)
- **Preconditions:** None
- **Entry point(s):** `routes/auth.js` (`POST /api/auth/logout`)
- **Flow:**
  1. Caller sends `POST /api/auth/logout` with no cookie or a stale one
  2. This route deliberately has **no** `requireAuth` gate (the code comment: *"signing out an invalid session is a no-op, not an error"*) — it proxies straight to Core's `POST /api/auth/sign-out`, forwarding whatever cookie header exists (even `''`)
  3. Whether Core's response is `ok` or not, the route only logs a `console.error` on failure — it never surfaces that failure to the caller
- **Expected outcome:** `200 { ok: true }` unconditionally, regardless of whether a session existed, was already invalid, or Core itself was reachable.
- **Failure modes / what could go wrong:** None — this is intentional idempotent behavior for a sign-out endpoint, not a gap.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/routes/auth.js`

---

### UC-UNAUTH-004: Core is unreachable while validating a session

- **Category:** Error Recovery
- **Actor:** A user with a genuinely valid Core session, but Core is down or the network call fails
- **Preconditions:** Core unreachable from QM's backend
- **Entry point(s):** `middleware/auth.js`
- **Flow:**
  1. Caller sends any request to a `requireAuth`-gated route with a valid cookie
  2. The `fetch` to `POST /api/sessions/validate` throws (network error, timeout, DNS failure, 5xx)
  3. `requireAuth`'s outer `catch` block returns `401` — a Core outage and a genuinely invalid session produce the **identical** response
- **Expected outcome:** `401 { success: false, error: 'Authentication required' }`. Fails closed: a legitimate user simply cannot use QM at all while Core is down, with no distinguishing signal that the problem is Core's availability rather than their own session.
- **Failure modes / what could go wrong:** No graceful degradation or cached-session fallback exists — by design, since QM has no independent notion of a valid session at all (Core is authoritative on every single request, not just at login). This is a strict, understandable trade-off (no state to go stale), but it does mean a Core outage is a full QM outage for every authenticated action, with an error message indistinguishable from "you're logged out."
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/middleware/auth.js`

---

### UC-UNAUTH-005: Core sign-out itself fails, but QM's logout endpoint still reports success

- **Category:** Error Recovery
- **Actor:** Authenticated (or unauthenticated) caller signing out while Core is unreachable
- **Preconditions:** Core unreachable
- **Entry point(s):** `routes/auth.js`
- **Flow:**
  1. Caller sends `POST /api/auth/logout`
  2. The `fetch` to Core's sign-out endpoint throws; the `catch` logs `console.error('[question-maker] Core sign-out request failed', err)` and the comment explicitly says *"Proceed even if Core is unreachable"*
  3. Route returns success regardless
- **Expected outcome:** `200 { ok: true }` even though Core's session (if it still exists) was never actually invalidated by this call.
- **Failure modes / what could go wrong:** The asymmetry with UC-UNAUTH-004 is notable: session **validation** fails closed (Core down → treated as logged out), but session **invalidation** fails open (Core down → still reports logged out to the client) — the client-side cookie handling and Core's own session lifecycle are what actually determine whether the session persists, not this endpoint's response. Not a QM-side vulnerability (QM holds no session state to leak), but worth knowing the `{ ok: true }` here isn't a guarantee Core's session was cleared.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/routes/auth.js`

---

### UC-UNAUTH-006: Missing, empty, or expired cookie on a protected route

- **Category:** Wrong/Malformed Usage
- **Actor:** Unauthenticated caller — no cookie header, an empty cookie, or a cookie from an already-expired/invalidated Core session
- **Preconditions:** None
- **Entry point(s):** `middleware/auth.js`
- **Flow:**
  1. Caller sends `GET /api/questions` (or any protected route) with `req.headers.cookie` absent or stale
  2. `requireAuth` forwards `req.headers.cookie ?? ''` to Core's validate endpoint regardless of whether it's present
  3. Core returns non-`ok` (no session found / expired) for any of these cases uniformly
- **Expected outcome:** `401 { success: false, error: 'Authentication required' }` for all three variants (missing/empty/expired) — no distinct error messaging between them.
- **Failure modes / what could go wrong:** None — this is correct, uniform rejection; not distinguishing "you were never logged in" from "your session expired" is a minor UX flatness, not a security concern (avoids leaking whether a given cookie value was ever valid).
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/middleware/auth.js`

---

### UC-UNAUTH-007: Unauthenticated caller attempts the inbound cascade-delete route without a service key

- **Category:** Malicious/Adversarial
- **Actor:** Unauthenticated caller, or a caller holding a valid **user** session cookie but no `EDUAI_API_KEY`, attempting `DELETE /api/internal/courses/:coreCourseId`
- **Preconditions:** None
- **Entry point(s):** `routes/internal.js`, `middleware/serviceAuth.js`
- **Flow:**
  1. Attacker sends `DELETE /api/internal/courses/123` with no `Authorization` header, or with a session cookie instead of a bearer token
  2. This route is gated by `requireServiceKey`, not `requireAuth` — it never even looks at `req.headers.cookie`; it only checks `req.headers.authorization` for a `Bearer <token>` matching `EDUAI_API_KEY` (via `timingSafeEqual` on SHA-256 hashes, so a length-mismatched or wrong guess doesn't leak timing information)
  3. No `Authorization: Bearer ...` header at all → rejected before any comparison happens
- **Expected outcome:** `401 { success: false, error: 'MISSING_SERVICE_KEY' }` for a missing header; `403 { success: false, error: 'INVALID_SERVICE_KEY' }` for a wrong token (or an unconfigured `EDUAI_API_KEY` on the server side, which also yields `403`). A valid **user** session cookie provides no path into this route at all — it's structurally a different trust boundary from every other route in this app.
- **Failure modes / what could go wrong:** None found — the internal route is the one place in QM where "unauthenticated" and "authenticated-but-wrong-mechanism" produce the same outcome (rejection), by design; there is no privilege level of ordinary user session that substitutes for the service key.
- **Related code:**
  - `apps/extensions/question-maker/app/backend/src/middleware/serviceAuth.js`
  - `apps/extensions/question-maker/app/backend/src/routes/internal.js`
