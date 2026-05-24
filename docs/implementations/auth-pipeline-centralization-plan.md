# Auth Pipeline Centralization — Architecture Plan

> **This is a living document.** It is a work in progress and should be treated as a starting point, not a final answer. Any section can be revised, restructured, or replaced entirely as the team learns more and makes decisions together.

**Epic:** EduAICore #58 (sub-track of Phase 1)  
**Last Updated:** May 20, 2026

---

## Table of Contents

- [0. TL;DR](#0-tldr)
- [1. Current State](#1-current-state)
  - [1.1 Core — Auth Provider](#11-core--auth-provider)
  - [1.2 AI Tutor — Transitional State](#12-ai-tutor--transitional-state)
  - [1.3 Question Maker — Standalone](#13-question-maker--standalone)
- [2. Target State](#2-target-state)
- [3. Gap Analysis](#3-gap-analysis)
  - [3.1 Core — Session Validation Endpoint](#31-core--session-validation-endpoint)
  - [3.2 AI Tutor — Auth Table Cleanup](#32-ai-tutor--auth-table-cleanup)
  - [3.3 Question Maker — Auth Migration](#33-question-maker--auth-migration)
- [4. Migration Plan](#4-migration-plan)
  - [Phase 1: Core Session Validation Endpoint](#phase-1-core-session-validation-endpoint)
  - [Phase 2: Extension Migration](#phase-2-extension-migration)
  - [Phase 3: End-to-End Verification](#phase-3-end-to-end-verification)
- [5. Auth Contract](#5-auth-contract)
- [6. Session Validation Middleware Pattern](#6-session-validation-middleware-pattern)
- [7. Key Decisions](#7-key-decisions)
- [8. File Reference](#8-file-reference)

---

## 0. TL;DR

**Core is the single auth provider for the entire platform. No extension manages its own users or issues its own tokens.**

The approach is cross-subdomain cookie sharing plus a Core session validation endpoint. When a user logs in on Core, the session cookie is set with `Domain=.eduai.ok.ubc.ca` and is readable by every extension. Each extension's auth middleware validates the cookie by calling `POST /api/sessions/validate` on Core: no OAuth PKCE flow, no Better Auth in extensions, no local session storage.

Current state:

- **AI Tutor** is in a transitional state. It currently uses Better Auth + `genericOAuth` (an OAuth PKCE flow against Core), which is being replaced with the simpler session validation approach. Its local `User`, `Session`, `Account`, and `Verification` tables are being dropped.
- **Question Maker** has a fully standalone JWT auth system — local `users` table, bcrypt passwords, own `/register` and `/login`. Nothing touches Core. This is being replaced entirely.

---

## 1. Current State

### 1.1 Core — Auth Provider

Core uses **Better Auth** with email/password enabled and a PostgreSQL adapter via Prisma.

```
apps/core/app/lib/auth/server.ts
```

| Capability | Status |
|---|---|
| Email/password auth for Core users | Implemented |
| Session management (7-day expiry) | Implemented |
| Cross-subdomain cookies | Implemented (`crossSubDomainCookies: true`) |
| Rate limiting | Implemented |
| `POST /api/sessions/validate` for extensions | **Not yet implemented** |
| Login redirect support (`?redirect=`) | Needs verification |

---

### 1.2 AI Tutor — Transitional State

AI Tutor currently uses Better Auth with the `genericOAuth` plugin — an OAuth PKCE flow against Core's OIDC endpoint. This is a transitional implementation. Per the schema design doc (Phase 2a/2b), it is being replaced with a thin session validation middleware and its local auth tables are being dropped.

```
apps/extensions/ai-tutor/server/src/auth.js          ← being removed
apps/extensions/ai-tutor/server/src/middleware/auth.js ← being rewritten
```

| Capability | Current | Target |
|---|---|---|
| Auth delegation to Core | OAuth PKCE via `genericOAuth` | Session cookie validation via `POST /api/sessions/validate` |
| Local `User` table | Exists (read-through projection) | **Dropped** |
| Local `Session`, `Account`, `Verification` tables | Exists (Better Auth) | **Dropped** |
| Local password/registration | Disabled | Stays disabled |

---

### 1.3 Question Maker — Standalone

Question Maker has a completely independent auth system with no connection to Core.

```
apps/extensions/question-maker/app/backend/src/middleware/auth.js
apps/extensions/question-maker/app/backend/src/routes/auth.js
apps/extensions/question-maker/app/backend/src/schema/User.js
```

| Capability | Status |
|---|---|
| Local JWT issuance and verification | Implemented (standalone) |
| Local `users` table with `password_hash` (bcrypt) | Implemented |
| `POST /api/auth/register` — local account creation | Implemented |
| `POST /api/auth/login` — local credential check | Implemented |
| Core session integration | **None** |
| Shared identity with Core or AI Tutor | **None** |

A user who logs in to Question Maker has a completely separate account from their Core identity. There is no way to know they are the same person, and no way to enforce roles set by Core administrators.

The local `User` schema (Sequelize) will be replaced entirely.

---

## 2. Target State

```
  ┌────────────────────────────────────────────────────────────┐
  │                          Core                              │
  │                                                            │
  │  Better Auth (email/pw + CWL/SAML2)                        │
  │                                                            │
  │  • Issues and owns all sessions                            │
  │  • Sets Domain=.eduai.ok.ubc.ca cookie on login            │
  │  • POST /api/sessions/validate — validates cookie for      │
  │    extension middleware                                    │
  │  • Owns all user accounts + role assignments               │
  └──────────────────────┬─────────────────────────────────────┘
                         │  shared session cookie
              ┌──────────┴──────────┐
              │                     │
  ┌───────────▼──────────┐  ┌───────▼──────────────────┐
  │       AI Tutor       │  │     Question Maker       │
  │                      │  │                          │
  │  requireAuth()       │  │  requireAuth()           │
  │  → POST /sessions/   │  │  → POST /sessions/       │
  │    validate on Core  │  │    validate on Core      │
  │  → req.user set      │  │  → req.user set          │
  │                      │  │                          │
  │  No local auth tables│  │  Thin local users table  │
  │                      │  │  (CUID PK, no password)  │
  └──────────────────────┘  └──────────────────────────┘

  Login flow for any extension:
  1. User hits protected route → no valid cookie → redirect to Core login
  2. User logs in on Core → Core sets Domain=.eduai.ok.ubc.ca session cookie
  3. Core redirects back to extension (?redirect= param)
  4. Extension middleware calls POST /api/sessions/validate → gets user identity
  5. Request proceeds with req.user populated
```

---

## 3. Gap Analysis

### 3.1 Core — Session Validation Endpoint

One new endpoint is needed. Everything else (cross-subdomain cookies, session management) is already in place.

| ID | Gap | Status | Blocking |
|---|---|---|---|
| C-1 | `POST /api/sessions/validate` — accepts session cookie, returns authenticated user | Not started | Both extension migrations |
| C-2 | Login page supports `?redirect=<url>` param — must validate the redirect URL is under `.eduai.ok.ubc.ca` (prod) or `localhost:` (dev) before redirecting; strip or reject other origins to prevent open redirect. Default to `/dashboard` if URL is absent or invalid. | Not started | Extension login redirect flow |

**Open PRs superseded by this approach:**

| PR | Title | Disposition |
|---|---|---|
| #48 | OAuth 2.0 provider plugin in Better Auth | **Close.** Extensions don't use OAuth PKCE; Core doesn't need to expose an OIDC provider. |
| #49 | Better Auth API key schema fix | **Close.** Original motivation was OAuth Bearer tokens for extension auth, which is no longer the approach. Service-to-service calls use `EDUAI_API_KEY` as a simple shared secret; the Better Auth `apiKey` plugin was already removed from Core's `server.ts` (commit `e797e15`). |
| #50 | Admin UI for sister-app OAuth client registration | **Close.** No OAuth clients to register. |
| #51 | OAuth Bearer auth for sister-app API access | **Close.** Replaced by session cookie forwarding for user-scoped calls and `EDUAI_API_KEY` for service-level calls. |

---

### 3.2 AI Tutor — Auth Table Cleanup

AI Tutor's session middleware needs to be rewritten and its Better Auth tables dropped. The login redirect behaviour replaces the OAuth flow.

| ID | Task | Effort | Priority |
|---|---|---|---|
| AT-A | Rewrite session middleware to call `POST /api/sessions/validate` on Core | Small | Critical |
| AT-B | Add login redirect: when no valid session, redirect to `{CORE_URL}/login?redirect=<current-url>` | Small | Critical |
| AT-C | Remove `server/src/auth.js` (Better Auth + `genericOAuth` config) | Small | High |
| AT-D | Drop `User`, `Session`, `Account`, `Verification` tables via Prisma migration | Medium | High |
| AT-E | Remove local `Role` Prisma enum (no model uses it after User table is dropped) | Small | High |
| AT-F | Remove Better Auth dependency from `package.json` | Small | Low |

---

### 3.3 Question Maker — Auth Migration

| ID | Task | Effort | Priority |
|---|---|---|---|
| QM-A | Write session validation middleware — calls `POST /api/sessions/validate`, sets `req.user` | Small | Critical |
| QM-B | Add login redirect: when no valid session, redirect to `{CORE_URL}/login?redirect=<current-url>` | Small | Critical |
| QM-C | Remove `POST /api/auth/register` and `POST /api/auth/login` endpoints | Small | Critical |
| QM-D | Delete `src/routes/auth.js` and remove the auth router from `app.js` | Small | Critical |
| QM-E | Redesign `users` table: CUID string PK, no `password_hash`, create row on first login | Medium | Critical |
| QM-F | Update `user_id` FK columns in `courses`, `canvas_integrations`, `canvas_course_mappings` from `INTEGER` to `VARCHAR` | Medium | Critical |
| QM-G | Update all routes that read `req.user` to use the new session shape | Medium | High |
| QM-H | Update `.env` template: add `CORE_URL`; remove JWT/auth vars | Small | High |

---

## 4. Migration Plan

### Phase 1: Core Session Validation Endpoint

**Goal:** Core exposes `POST /api/sessions/validate`. Both extension migrations are blocked until this exists.

**Tasks:**
- [ ] Implement `POST /api/sessions/validate` — reads the session cookie from the request, validates it via Better Auth's session store, and returns `{ user: { id, email, name, role, image } }` or `401`
- [ ] Implement `?redirect=<url>` support on Core's login page with open-redirect protection: validate that the redirect URL's origin is under `.eduai.ok.ubc.ca` (production) or `localhost:` (development) before redirecting. Strip or reject all other origins and fall back to `/dashboard`
- [ ] Add rate limiting to `POST /api/sessions/validate`: Better Auth's built-in rate limiter does not cover custom routes. This endpoint will receive one call per authenticated request from both extensions, so it should have its own IP-based rate limit (e.g. 300 req/min per IP, tunable) to prevent abuse
- [ ] Write a contract test: POST with a valid session cookie → 200 + user object; POST with no cookie or expired cookie → 401
- [ ] Smoke-test manually: log in on Core, copy the session cookie, call `POST /api/sessions/validate` from curl — confirm the user object comes back with the correct role

**Done when:** the endpoint is live in dev, contract test passes, and a manual curl test returns the expected user shape.

---

### Phase 2: Extension Migration

**Goal:** Both extensions validate sessions through Core. No local auth logic, no local passwords.

**Prerequisites:** Phase 1 complete and tested.

#### AI Tutor (Phase 2a in schema doc)

- [ ] Rewrite `src/middleware/auth.js` — replace Better Auth session lookup with `POST /api/sessions/validate` call (AT-A). See [§6](#6-session-validation-middleware-pattern) for the middleware description.
- [ ] Add login redirect to the middleware: when `POST /api/sessions/validate` returns 401, redirect to `{CORE_URL}/login?redirect={encodeURIComponent(req.originalUrl)}` (AT-B)
- [ ] Delete `server/src/auth.js` (AT-C)
- [ ] Run Prisma migration to drop `User`, `Session`, `Account`, `Verification` tables (AT-D)
- [ ] Remove local `Role` enum from `schema.prisma` (AT-E)
- [ ] Remove `better-auth` from `package.json` (AT-F)

#### Question Maker (Phase 2b in schema doc)

- [ ] Write `src/middleware/auth.js` — session validation middleware (QM-A, QM-B). Replaces the existing JWT middleware entirely.
- [ ] Delete `src/routes/auth.js`; remove auth router from `app.js` (QM-C, QM-D)
- [ ] Write Sequelize migration: drop `users` table; create new `users` table with CUID string PK, no `password_hash` (QM-E)
- [ ] Write Sequelize migration: change `user_id` columns in `courses`, `canvas_integrations`, `canvas_course_mappings` from `INTEGER` to `VARCHAR` (QM-F)
- [ ] Update `src/services/authService.js` — replace register/login logic with a `findOrCreateUser(coreUser)` function that upserts a local row from the Core session payload (QM-E)
- [ ] Update all route handlers that read `req.user` to use the new session shape (QM-G)
- [ ] Update `.env.example`: add `CORE_URL`; remove `JWT_SECRET`, `JWT_EXPIRES_IN`, and any auth-related vars (QM-H)

**Done when:** both extensions redirect to Core login when unauthenticated, return to the original URL after login, and serve protected routes without any local password or JWT logic.

---

### Phase 3: End-to-End Verification

**Goal:** Confirm single identity across all three extensions with no re-auth between them.

- [ ] Log in on Core
- [ ] Navigate to AI Tutor — confirm same identity and role, no re-auth prompt
- [ ] Navigate to Question Maker — confirm same identity and role, no re-auth prompt
- [ ] Log out on Core — confirm both extensions require re-authentication immediately on the next request
- [ ] Change a user's role in Core admin → confirm the change takes effect in both extensions on the next request (session re-validation picks up the updated role)
- [ ] Confirm `POST /api/auth/register` and `POST /api/auth/login` return 404 on Question Maker

---

## 5. Auth Contract

### Session validation (extension middleware → Core)

```
POST {CORE_URL}/api/sessions/validate
Cookie: <core session cookie forwarded from the incoming request>

200 Response:
{
  "user": {
    "id":    "user_cuid",
    "email": "user@example.com",
    "name":  "User Name",
    "image": "https://...",
    "role":  "STUDENT | PROFESSOR | TA | ADMIN | UNIT_ADMIN"
  }
}

401 Response: no body (or { "error": "Unauthorized" })
```

### Login redirect

```
GET {CORE_URL}/login?redirect={encodeURIComponent(returnUrl)}
```

After a successful login, Core redirects to `returnUrl`. Extensions set this to the URL the user was trying to reach so they land in the right place after authentication.

### Role handling

The `role` field in the session response maps directly onto Core's `UserRole` enum. Extensions should apply a defensive normalization — unknown values default to `STUDENT` (least-privilege). No OAuth claim parsing or `normalizeEduAiRole` function is needed; the role is a plain string from Core's database.

---

## 6. Session Validation Middleware Pattern

Both extensions implement the same middleware. QM writes it from scratch; AI Tutor replaces its existing Better Auth middleware. Some example pseudocode:

```js
// requireAuth(req, res, next)
// Drop-in replacement for any existing auth middleware.
async function requireAuth(req, res, next) {
  const response = await fetch(`${process.env.CORE_URL}/api/sessions/validate`, {
    method: 'POST',
    headers: { cookie: req.headers.cookie ?? '' }, // forward the raw Cookie header verbatim
  })

  if (!response.ok) {
    // API routes (called by fetch, not browser navigation) → return 401, let the client handle it
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    // Browser routes → redirect to Core login, return here after auth
    const returnUrl = encodeURIComponent(`${process.env.EXTENSION_URL}${req.originalUrl}`)
    return res.redirect(`${process.env.CORE_URL}/login?redirect=${returnUrl}`)
  }

  const { user } = await response.json()
  req.user = user // { id, email, name, image, role }
  next()
}
```

`req.user` is populated with the shape from the [auth contract](#5-auth-contract). Unknown roles default to `STUDENT` at the point of use (least-privilege).

**Performance note:** this adds one Core HTTP round-trip per authenticated request. For the initial implementation, call Core on every request. This gives instant logout propagation and keeps the middleware simple. See [§7](#7-key-decisions) for the session validation cache decision.

---

## 7. Key Decisions

### Cookie domain during local development

**Resolved — use `COOKIE_DOMAIN=localhost` in all extension `.env` files.**

Core's `crossSubDomainCookies` is enabled for `*.eduai.ok.ubc.ca` in production. Locally, the equivalent is setting `COOKIE_DOMAIN=localhost` in each service's `.env`. All modern browsers (Chrome, Firefox, Edge) handle `Domain=localhost` cookies correctly across ports when `SameSite=Lax` is set, which is Better Auth's default in non-HTTPS environments. No host file edits are required.

All three services must be running simultaneously for the auth flow to work locally. If a developer encounters cookie issues, the first thing to verify is that `COOKIE_DOMAIN=localhost` is set and the Core dev server is running. This must be documented in the local dev setup guide before Phase 2 work begins.

### Session validation cache

**Deferred — do not implement in Phase 1 or 2.**

The no-cache baseline (one Core HTTP call per authenticated request) is the correct starting point. At the expected scale of this platform, the added latency is negligible (~5–10ms intra-datacenter) and instant logout propagation comes for free.

If latency on authenticated routes becomes measurable in production, a short-lived in-memory cache keyed on the session token can be added at that point. The trade-off to document at that time: logout from Core will not propagate to extensions until the cache TTL expires. That staleness window must be an explicit team decision, not an implementation detail.

---

## 8. File Reference

| File | Purpose |
|---|---|
| `apps/core/app/lib/auth/server.ts` | Core's Better Auth config |
| `apps/core/app/lib/auth/guards.server.ts` | Core's route auth guards |
| `apps/extensions/ai-tutor/server/src/auth.js` | Better Auth + OAuth config — **being removed (AT-C)** |
| `apps/extensions/ai-tutor/server/src/middleware/auth.js` | Session middleware — **being rewritten (AT-A)** |
| `apps/extensions/question-maker/app/backend/src/middleware/auth.js` | QM's JWT middleware — **being replaced (QM-A)** |
| `apps/extensions/question-maker/app/backend/src/routes/auth.js` | QM's local auth routes — **being deleted (QM-C, QM-D)** |
| `apps/extensions/question-maker/app/backend/src/schema/User.js` | QM's local User model — **being redesigned (QM-E)** |
| `apps/extensions/question-maker/app/backend/src/services/authService.js` | QM's local auth service — **being replaced with `findOrCreateUser` (QM-E)** |
| `apps/extensions/question-maker/app/backend/src/services/eduaiService.js` | QM's Core API client — update to use session cookie forwarding, not admin API key, for user-scoped calls |

### `eduaiService.js` — cookie forwarding vs. API key

Two kinds of calls go from QM to Core. The distinction matters for auth:

```js
// User-scoped call: the action is on behalf of a specific user.
// Forward their session cookie so Core can identify and authorize them.
async function getUserCourses(req) {
  return fetch(`${process.env.CORE_URL}/api/courses`, {
    headers: { cookie: req.headers.cookie ?? '' },
  })
}

// Service-level call: no user context, QM is acting as a trusted service.
// Use the shared API key instead of a user cookie.
async function getInternalConfig() {
  return fetch(`${process.env.CORE_URL}/api/internal/config`, {
    headers: { 'x-api-key': process.env.EDUAI_API_KEY },
  })
}
```

The rule of thumb: if the call result depends on who the user is, forward the cookie. If it's infrastructure or admin data that any service can access, use `EDUAI_API_KEY`.
