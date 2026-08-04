# Unauthenticated actor

AI Tutor has no local session store, password flow, or OAuth client of its own — every request's identity is derived fresh, per-request, by `requireAuth` (`apps/extensions/ai-tutor/server/src/middleware/auth.js`) forwarding the browser's `Cookie` header to Core's `POST /api/sessions/validate` and trusting whatever `{ user }` Core returns. There is no session cache, no JWT verification performed locally, and no fallback identity source. This file covers what happens before that validation succeeds — missing cookie, expired/invalid session, a Core outage during validation — and the small set of routes deliberately carved out of the auth gate entirely.

The gate itself (`apps/extensions/ai-tutor/server/src/app.js`) is a single `app.use('/api', ...)` middleware applied to everything mounted under `/api`, with three explicit exemptions checked by path/method **before** `requireAuth` runs:

```js
if (req.path === '/health') return next();
if (req.method === 'POST' && req.path === '/logout') return next();
if (req.path.startsWith('/internal/')) return next();       // service-key auth instead, see service-caller.md
return requireAuth(req, res, next);
```

Everything else — including `GET /me`, which is how the frontend discovers *whether* a session exists — requires a Core-validated cookie.

---

### UC-UNAUTH-001: No session cookie at all

- **Category:** Happy Path
- **Actor:** A first-time visitor with no `Cookie` header
- **Preconditions:** None
- **Entry point(s):** `GET /me`, or any other `/api/*` route (`apps/extensions/ai-tutor/server/src/middleware/auth.js`)
- **Flow:**
  1. Browser (or a raw HTTP client) sends `GET /api/me` with no cookie
  2. `requireAuth` calls Core's `POST /api/sessions/validate` with `{ cookie: req.headers.cookie ?? '' }` — an empty cookie string; Core's own session lookup fails to find anything and responds non-`2xx`
  3. `requireAuth` checks `!response.ok` and returns `401 { error: 'Authentication required' }` immediately, never calling `next()`
- **Expected outcome:** `401` on every protected route; the frontend's route loader treats this as "not logged in" and redirects to Core's login flow (outside this codebase).
- **Failure modes / what could go wrong:** None — this is the expected default-deny state.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/middleware/auth.js`

---

### UC-UNAUTH-002: Expired, revoked, or tampered session cookie

- **Category:** Typical Use
- **Actor:** A previously-logged-in user whose Core session has since expired or been revoked (logout elsewhere, admin-forced sign-out, or a manually edited cookie value)
- **Preconditions:** None
- **Entry point(s):** `apps/extensions/ai-tutor/server/src/middleware/auth.js` (`requireAuth`)
- **Flow:**
  1. Client sends a `Cookie` header that Core no longer recognizes as valid (or that fails Core's own signature/expiry check)
  2. `requireAuth` forwards it verbatim to Core's `/api/sessions/validate`; Core responds non-`2xx` for the same reason it would for a missing cookie — AI Tutor does not distinguish "no cookie," "expired cookie," and "tampered cookie" in its own logic; it only checks `response.ok`
  3. `401 { error: 'Authentication required' }`
- **Expected outcome:** `401`, uniformly, with no information disclosed about *why* validation failed (expired vs. tampered vs. simply unknown) — Core owns that distinction entirely.
- **Failure modes / what could go wrong:** None — treating every non-`2xx` from Core identically avoids leaking session-state details (e.g. "this cookie format is valid but expired" vs. "this cookie is garbage") that could otherwise help an attacker refine a forgery attempt.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/middleware/auth.js`

---

### UC-UNAUTH-003: Health check reachable with no auth at all

- **Category:** Typical Use
- **Actor:** A load balancer / uptime monitor / anyone
- **Preconditions:** None
- **Entry point(s):** `GET /api/health` (`apps/extensions/ai-tutor/server/src/app.js`)
- **Flow:**
  1. Caller sends `GET /api/health` with no credentials
  2. The route is registered *before* the auth middleware is even applied (`app.get('/api/health', ...)` at line 59, ahead of the `app.use('/api', ...)` gate at line 75) — it isn't merely exempted by a path check, it's structurally outside the gated router entirely
  3. Handler runs `SELECT 1` against Postgres and returns `{ ok: true }` or `{ ok: false, error }`
- **Expected outcome:** `200`/`500` reflecting only DB connectivity — no user data, no auth state.
- **Failure modes / what could go wrong:** The error message on DB failure is `String(e)`, which could include a raw driver error (connection string fragments, etc.) in a non-production environment; worth confirming this is monitored internally only and not exposed publicly, though the response contains no application data regardless.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/app.js`

---

### UC-UNAUTH-004: Logging out with an invalid or missing session

- **Category:** Typical Use
- **Actor:** Anyone, authenticated or not
- **Preconditions:** None
- **Entry point(s):** `POST /api/logout` (`apps/extensions/ai-tutor/server/src/routes/authentication.js`)
- **Flow:**
  1. Client sends `POST /api/logout` with no cookie, an expired cookie, or a valid one
  2. This route is explicitly exempted from `requireAuth` (checked by exact path+method match in `app.js`, ahead of the generic gate) — per its own comment, "signing out an invalid session is a no-op, not an error"
  3. The handler proxies to Core's `POST /api/auth/sign-out`, forwarding whatever cookie was present; if Core's call fails or throws (network error, Core down), the `catch` logs it and **execution continues** rather than propagating the failure
  4. `res.json({ ok: true })` is returned unconditionally, regardless of whether Core's sign-out actually succeeded
- **Expected outcome:** `200 { ok: true }` always, from AI Tutor's perspective — a client can never get an error from `/api/logout` itself. The actual sign-out durability depends entirely on Core's own endpoint succeeding, which this response doesn't reflect.
- **Failure modes / what could go wrong:** If Core's sign-out silently fails (e.g. Core is briefly down when the user clicks logout), the client is told `ok: true` and will likely treat itself as logged out locally, but the underlying Core session may still be valid — a subsequent request with the same stale cookie could still authenticate successfully. This is a deliberate simplicity/robustness tradeoff (never block a user's ability to *attempt* logout) but it does mean `/api/logout`'s `200` is not a reliable signal that the session was actually invalidated server-side.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/routes/authentication.js`

---

### UC-UNAUTH-005: Core is unreachable while validating a session

- **Category:** Error Recovery
- **Actor:** Any user, authenticated or not, during a Core outage
- **Preconditions:** Core is down, network-partitioned, or timing out
- **Entry point(s):** `apps/extensions/ai-tutor/server/src/middleware/auth.js` (`requireAuth`)
- **Flow:**
  1. Client sends any protected request with a cookie that *would* validate under normal conditions
  2. `requireAuth`'s `fetch()` to `${CORE_URL}/api/sessions/validate` throws (connection refused, DNS failure, timeout with no configured `AbortSignal` — this call has no explicit timeout wired, unlike `aiGuidance.js`'s `callEduAI`)
  3. The outer `try { ... } catch { res.status(401)... }` catches the throw and returns `401 { error: 'Authentication required' }` — indistinguishable from an actually-invalid cookie
- **Expected outcome:** `401` for every user during a Core outage — AI Tutor fails **closed**, not open: a Core outage locks everyone out rather than granting degraded/cached access.
- **Failure modes / what could go wrong:** This is safe (no unauthorized access is ever granted), but it does mean AI Tutor has a hard runtime dependency on Core's availability for every single request, with no timeout of its own on the validation call — a slow-but-not-fully-down Core could make every AI Tutor request hang for as long as the underlying TCP/HTTP stack allows before failing, rather than failing fast. This is a availability/resilience gap worth noting (contrast with `aiGuidance.js`'s deliberate `EDUAI_CALL_TIMEOUT_MS` bound on the chat-completion path), not a security one.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/middleware/auth.js`

---

### UC-UNAUTH-006: Probing protected/admin endpoints without credentials

- **Category:** Malicious/Adversarial
- **Actor:** Unauthenticated attacker enumerating the API surface
- **Preconditions:** None
- **Entry point(s):** Any route other than `/health`, `POST /logout`, `/internal/*` — e.g. `GET /admin/users`, `POST /activities/1/teach`, `GET /courses/1`
- **Flow:**
  1. Attacker sends requests to a range of endpoints, including admin- and role-gated ones, with no cookie
  2. Every one of them passes through the single `app.use('/api', ...)` gate first; since none of the three path-based exemptions match, `requireAuth` runs, fails Core validation (empty cookie), and returns `401` **before** the request ever reaches route-specific `requireRole`/`isCourseAdmin`/`isTa` logic
  3. Because the failure is uniform (`401 { error: 'Authentication required' }`) regardless of which endpoint was probed, an attacker learns nothing about whether a given resource id, course, or activity exists — role/ownership checks never run without a validated identity first
- **Expected outcome:** `401` uniformly across the entire protected surface; no endpoint leaks existence/ownership information to an unauthenticated caller (contrast with UC-STUDENT-008 in `student.md`, where an *authenticated-but-unauthorized* caller can distinguish a `404` from a `403` on some routes — that distinction never even becomes reachable without valid auth first).
- **Failure modes / what could go wrong:** None found — the auth gate runs ahead of all role/ownership logic for every route except the three explicit, narrow exemptions.
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/app.js`
  - `apps/extensions/ai-tutor/server/src/middleware/auth.js`

---

### UC-UNAUTH-007: Attempting to call an internal service-to-service route as a browser client

- **Category:** Malicious/Adversarial
- **Actor:** Unauthenticated (or normally-authenticated-as-a-user) caller attempting `apps/extensions/ai-tutor/server/src/routes/internal.js`
- **Preconditions:** None
- **Entry point(s):** `DELETE /internal/courses/:coreOfferingId` (and any other `/internal/*` route)
- **Flow:**
  1. Caller sends a request to an `/internal/*` path — this **is** exempted from `requireAuth` by the `app.js` path check (`req.path.startsWith('/internal/')`), so a missing/invalid session cookie doesn't produce the usual `401`
  2. However, the route itself is separately gated by `requireServiceKey` (`apps/extensions/ai-tutor/server/src/middleware/serviceAuth.js`), which requires `Authorization: Bearer <token>` matching `EDUAI_API_KEY` via a `timingSafeEqual` hash comparison (both sides SHA-256'd first specifically so a length mismatch can't itself leak timing information)
  3. A browser client (which sends cookies, not a bearer token it wouldn't know) gets `401 { error: 'MISSING_SERVICE_KEY' }` if no `Authorization` header is present, or `403 { error: 'INVALID_SERVICE_KEY' }` if one is present but wrong
- **Expected outcome:** `401`/`403` — a normal user session (even a valid one) cannot invoke internal routes; only possession of the shared `EDUAI_API_KEY` secret does.
- **Failure modes / what could go wrong:** None found in this route's own logic — full server-to-server-vs-user-session separation is enforced by using an entirely different credential type, not just a role check that a compromised user session might satisfy. (Full detail on the internal-route contract itself belongs in a future `service-caller.md`.)
- **Related code:**
  - `apps/extensions/ai-tutor/server/src/middleware/serviceAuth.js`
  - `apps/extensions/ai-tutor/server/src/routes/internal.js`
  - `apps/extensions/ai-tutor/server/src/app.js`
