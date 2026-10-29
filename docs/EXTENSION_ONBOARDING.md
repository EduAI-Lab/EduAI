# Extension Onboarding Guide

**Issue:** EduAICore #636  
**Last Updated:** 2026-10-17  
**Verified against:** AI Tutor, Question Maker, example-extension

This guide explains how to connect a new extension to the EduAI Core platform. It covers auth, session handling, role enforcement, calling Core APIs, and registering the extension in Core's sidebar.

**Working example:** `apps/extensions/example-extension/` is a minimal Express server that proves this pattern end-to-end with no database. Start there if you want to see auth working before building your extension's actual features.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites](#2-prerequisites)
3. [Environment variables](#3-environment-variables)
4. [Session validation middleware](#4-session-validation-middleware)
5. [Login redirect flow](#5-login-redirect-flow)
6. [Role-based access control](#6-role-based-access-control)
7. [Calling Core APIs](#7-calling-core-apis)
8. [Registering with Core's app switcher](#8-registering-with-cores-app-switcher)
9. [Local development setup](#9-local-development-setup)
10. [Verification checklist](#10-verification-checklist)

---

## 1. Overview

Core is the single identity provider for the entire platform. Extensions do not manage their own user accounts, issue their own tokens, or run their own auth flows.

**How it works:**

1. A user logs in on Core. Core sets an HTTP-only session cookie. Hosted subdomains share it when `COOKIE_DOMAIN` is configured for their parent domain. Localhost uses a host-only cookie (no Domain attribute), shared across ports. JavaScript cannot read the HTTP-only cookie.
2. When the user navigates to an extension, the extension's auth middleware forwards the raw `Cookie` header to `POST /api/sessions/validate` on Core.
3. Core validates the cookie and returns the user identity (`{ id, email, name, image, role }`).
4. The middleware populates `req.user` and the request continues.

No OAuth PKCE flow, no local passwords, no token issuance.

---

## 2. Prerequisites

Before an extension can use Core auth, the following must be in place:

- Core is deployed and reachable at a known URL (`CORE_URL`).
- A shared service key (`EDUAI_API_KEY`) is configured in Core's `.env`. The same value goes in the extension's `.env` for server-to-server calls.
- The extension runs under `*.eduai.ok.ubc.ca` in production (so the shared session cookie is accessible). For local development, all services run on `localhost` with different ports.

---

## 3. Environment variables

Add the following to the extension's `.env` and `.env.example`:

```env
# URL of Core — used by session validation middleware and login redirects
CORE_URL=http://localhost:3000

# Public URL of this extension — used to build the ?redirect= param after Core login
EXTENSION_URL=http://localhost:8000

# Shared service key — must match EDUAI_API_KEY in Core's .env
# Required for POST /api/sessions/validate (missing key yields 403) and for
# server-to-server calls that are not on behalf of a specific user
EDUAI_API_KEY=

# Core API base URL — used by service-level API calls
EDUAI_BASE_URL=http://localhost:3000/api
```

> **Note:** Do not add `JWT_SECRET`, local user table vars, or any credential that implies the extension manages its own auth. Those belong only in Core.

---

## 4. Session validation middleware

Use the maintained middleware in [AI Tutor](../apps/extensions/ai-tutor/server/src/middleware/auth.js) or [Question Maker](../apps/extensions/question-maker/app/backend/src/middleware/auth.js) as the implementation reference. The example extension is a minimal demonstration, not a production-ready error-handling contract.

- Forward the incoming raw Cookie header and the server-only EDUAI_API_KEY to POST /api/sessions/validate.
- Preserve the distinction between an invalid session (401), a bad service configuration (403), rate limiting (429), and a Core outage (503). Do not turn every failure into a sign-in loop.
- Treat the returned platform role and authorized units as identity, then check course access separately for every course operation.
- Redirect unauthenticated browser navigation to Core’s /auth/login with a validated return URL. API requests should return an error for the frontend to handle.
- Never expose the service key through a VITE_ variable, browser request, or source bundle.

### Core response shape

`POST /api/sessions/validate` returns:

```json
{
  "user": {
    "id": "user_cuid",
    "email": "user@example.com",
    "name": "User Name",
    "image": "https://...",
    "role": "STUDENT | INSTRUCTOR | ADMIN | UNIT_ADMIN",
    "authorizedUnits": []
  }
}
```

`authorizedUnits` is only populated for `UNIT_ADMIN` users. Extensions that implement unit-level scoping (like AI Tutor) use this array to filter which courses a unit admin can see. A course-scoped extension must enforce those units or deny unit-admin access; ignoring them must not grant cross-unit access.

Returns `401` with a JSON error when the session is missing or expired. Invalid service credentials return `403`, with repeated invalid requests rate-limited to `429`; valid callers can also receive `429` when admission limits are exceeded.

---

## 5. Login redirect flow

When `requireAuth` receives a `401` from Core on a non-API route, it redirects the user to Core's login page with a `?redirect=` parameter:

```
GET {CORE_URL}/auth/login?redirect={encodeURIComponent(extensionUrl + req.originalUrl)}
```

After a successful login, Core validates the `?redirect=` value and redirects the user back. Core's `validateRedirectUrl` function accepts:

- Relative paths (starting with `/`)
- Absolute URLs under `localhost` or `*.eduai.ok.ubc.ca`

All other values fall back to `/dashboard` on Core to prevent open-redirect attacks. This means `EXTENSION_URL` **must** be set to the correct public URL of the extension for redirects to work in production.

---

## 6. Role-based access control

After `requireAuth` sets `req.user`, use a `requireRole` middleware factory to gate routes:

```js
export function requireRole(allowed) {
  const roles = Array.isArray(allowed) ? allowed : [allowed];
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: `One of the following roles required: ${roles.join(', ')}` });
    }
    next();
  };
}
```

Apply it after `requireAuth` on any route that requires a specific role:

```js
// Single role
router.get('/admin/users', requireAuth, requireRole('ADMIN'), handler);

// Multiple roles
router.post('/courses', requireAuth, requireRole(['ADMIN', 'INSTRUCTOR']), handler);
```

Role values from Core:

| Role | Meaning |
|---|---|
| `STUDENT` | Enrolled student |
| `INSTRUCTOR` | Course instructor |
| `ADMIN` | Platform administrator |
| `UNIT_ADMIN` | Department-level administrator scoped to authorized units |

> **Note:** `role` on `req.user` is the platform-level `UserRole` from Core, not a per-course enrollment role. `TA` is an enrollment-level role (see AI Tutor's `enrollment.role`), not a value of `user.role` — don't add it to `VALID_ROLES` or `requireRole` allow-lists.

---

## 7. Calling Core APIs

There are two kinds of server-to-server calls from an extension to Core. The auth method differs between them.

### User-scoped calls

When an extension makes an API call **on behalf of a specific user** (e.g., fetching that user's courses), forward the raw `Cookie` header from the incoming request. Core resolves the user identity from the session cookie and applies the appropriate role filtering.

```js
async function getUserCourses(req, { page = 1, pageSize = 25 } = {}) {
  const response = await fetch(
    `${process.env.EDUAI_BASE_URL}/courses?page=${page}&pageSize=${pageSize}`,
    { headers: { cookie: req.headers.cookie ?? '' } },
  );
  if (!response.ok) throw new Error(`Core returned ${response.status}`);
  // { data, total, page, pageSize }
  return response.json();
}
```

> **Core's list endpoints are paginated (#1041).** `GET /api/users`, `/api/courses`, `/api/ai-models`, and `/api/ai-providers` **require** `page` and `pageSize` — a request without them is a `400 PAGINATION_REQUIRED`. They all answer with the same envelope:
>
> ```json
> { "data": [], "total": 0, "page": 1, "pageSize": 25 }
> ```
>
> `pageSize` is clamped to 1–200. If you only need a handful of records you already know the ids of, use `?ids=a,b,c` on `/api/users` and `/api/courses` instead — it is unpaged, returns the same envelope, and cannot be combined with `page`/`pageSize`. `?search=` is also available on both. Do not page-loop a whole table to build an id→record map; that is what `?ids=` is for.
>
> `/api/courses` additionally accepts repeatable `?status=` (`published`|`draft`), `?term=<code>::<year>`, and `?department=` filters that narrow the complete role-scoped dataset before pagination, and a role-scoped `GET /api/courses/facets` returns those filter option values for the caller's whole accessible set (never just the current page).

### Service-level calls

When an extension makes an API call that is **not** on behalf of a user (e.g., syncing enrollments in a background job, submitting a bug report), use the shared service key:

```js
async function getEnrollments(courseId) {
  const response = await fetch(`${process.env.EDUAI_BASE_URL}/courses/${courseId}/enrollments`, {
    headers: { Authorization: `Bearer ${process.env.EDUAI_API_KEY}` },
  });
  if (!response.ok) throw new Error(`Core returned ${response.status}`);
  return response.json();
}
```

**Rule of thumb:** If the result depends on who the user is, forward the cookie. If it's infrastructure data any service can access, use `EDUAI_API_KEY`.

### Writes need the service key, even with a cookie

Core's root middleware rejects any **cookie-bearing** `POST`/`PATCH`/`PUT`/`DELETE` that cannot prove same-site provenance (`Origin`, then `Referer`, then `Sec-Fetch-Site: same-origin`, checked against `BETTER_AUTH_URL`'s origin and the request's own origin):

```json
HTTP/1.1 403 Forbidden
{ "error": "CROSS_ORIGIN_MUTATION" }
```

A server-to-server call has no browser origin, so **a mutation that forwards only the user's cookie will be blocked.** Send `Authorization: Bearer <EDUAI_API_KEY>` alongside the cookie (or on its own) — a valid service key is the documented bypass.

Reads are unaffected. Your own extension should run the mirror-image guard on its own mutating routes; see `requireSameOriginMutation` (AI Tutor) and `csrfOriginGuard` (Question Maker) for two working implementations.

### Core endpoints that accept service key calls

| Endpoint | Description |
|---|---|
| `POST /api/sessions/validate` | Session validation — **requires** the key; a cookie alone is `403` |
| `GET /api/courses` | List courses (role-filtered when a cookie is forwarded; unscoped for a bare service key) |
| `GET /api/courses/:id` | Single-course live read-through |
| `GET /api/courses/:id/topics` | Service-key callers receive staff topics, including suggestions, by default. Pass `?audience=learner` for the topics students may see (accepted, not hidden, no `Uncategorized`) and use that for any student-facing list ([#1956](https://github.com/EduAI-Lab/EduAI/issues/1956)) |
| `GET /api/courses/:id/enrollments` | Course roster |
| `GET /api/policies` | Platform feature flags |
| `POST /api/completion` | Stateless LLM completion for extension AI-assist |
| `POST /api/bug-reports` | Submit a bug report |
| `POST /api/questions` | Push a question variant to Core |

Core also calls **outward** to extensions using the same key: on course deletion it makes a best-effort cascade call to `QM_BACKEND_URL` / `AI_TUTOR_SERVER_URL` (`/api/internal/...`). If you implement that endpoint, gate it with `requireServiceKey` and make it idempotent — Core does not retry, and your nightly reconcile job is the safety net.

---

## 8. Registering with Core's app switcher

Once your extension is running, add it to Core's app switcher (the **Switch app** tray opened from the app icon at the top of the left navigation bar, or from the top bar on a phone) so users can navigate to it.

### Without touching `apps.tsx` (recommended)

Set `VITE_EXTRA_EXTENSIONS` in `apps/core/.env` to a JSON array of extension descriptors. Core will pick it up on the next dev server restart (or build).

```env
# apps/core/.env
VITE_EXTRA_EXTENSIONS='[{"id":"my-ext","name":"My Extension","url":"http://localhost:9000","description":"Does something useful"}]'
```

Fields:

| Field | Required | Notes |
|---|---|---|
| `id` | Yes | Stable string — used to mark the current app in the switcher |
| `name` | Yes | Display name |
| `url` | Yes | Absolute URL to the extension root |
| `description` | No | One-line description shown under the name |
| `color` | No | CSS color string for the icon tile (defaults to purple) |

Extra extensions show up with a puzzle-piece icon and are visible to all roles. If you need role gating, add your extension to `getLauncherApps()` in `apps/core/app/lib/apps.tsx` instead and pass a `roles` array (same pattern as Question Maker's `QUESTION_MAKER_ROLES`).

> **Vite env vars are baked in at build time.** Changing `VITE_EXTRA_EXTENSIONS` requires restarting the Core dev server (or rebuilding for production). This is intentional — it gives you an explicit approval step before a new extension appears in the UI.

### Quick demo with the example extension

```env
# apps/core/.env
VITE_EXTRA_EXTENSIONS='[{"id":"example","name":"Example Extension","url":"http://localhost:9000","description":"Minimal auth demo"}]'
```

Then start both:

```bash
# Terminal 1 — Core (already running)
# Terminal 2
cd apps/extensions/example-extension
cp .env.example .env
npm install
npm run dev
```

Open Core in a browser and select the Core icon at the top of the left navigation bar to open **Switch app** — "Example Extension" appears in the list. Click it to trigger the login redirect flow end-to-end.

---

## 9. Local development setup

Core and the new extension must run simultaneously for the auth flow to work.

| Service | Default port | `CORE_URL` value |
|---|---|---|
| Core (SSR app + API) | `3000` | — |
| AI Tutor frontend | `3001` | — (browser only) |
| AI Tutor API | `4000` | `http://localhost:3000` |
| Question Maker frontend | `5173` | — (browser only) |
| Question Maker API | `8000` | `http://localhost:3000` |
| Example extension | `9000` | `http://localhost:3000` |

**Cookie behavior across ports:**  
On localhost, Core deliberately omits the Domain attribute and ignores loopback `COOKIE_DOMAIN` values. Cookies are shared across ports on the same hostname. Use `localhost` consistently rather than mixing it with `127.0.0.1`; keep `credentials: "include"` on cross-origin browser API calls.

**Common local dev failures:**

| Symptom | Cause | Fix |
|---|---|---|
| Extension always redirects to Core login | `CORE_URL` is wrong or Core is not running | Verify Core is running on port 3000 and `CORE_URL` matches |
| `POST /api/sessions/validate` returns 401 even after login | Cookie domain mismatch | Confirm `BETTER_AUTH_SECRET` is set in Core's `.env`; restart Core |
| Redirect after login lands on Core dashboard instead of extension | `EXTENSION_URL` is wrong | Set `EXTENSION_URL` to the extension's actual base URL |
| 401 on service-level API calls | `EDUAI_API_KEY` mismatch | The key in the extension's `.env` must match the key in Core's `.env` |

---

## 10. Verification checklist


Run through these steps after wiring up a new extension. All items must pass before the extension is considered onboarded.

### Auth flow

- [ ] Start Core and the new extension locally.
- [ ] Visit a protected extension route without a session — confirm a redirect to `{CORE_URL}/auth/login?redirect=<extension-url>`.
- [ ] Log in on Core — confirm you land back on the extension at the original URL.
- [ ] Hit a protected extension API route without a session (e.g., `curl http://localhost:<port>/api/me`) — confirm `401 Authentication required`.
- [ ] Log out on Core — confirm the next request to the extension redirects to Core login.

### Identity and role

- [ ] After login, confirm `req.user` in the extension contains `{ id, email, name, role }` matching the Core account.
- [ ] In Core admin, change the user's role — confirm the role change is reflected in the extension on the next request (no re-login required).
- [ ] Test a role-gated route with an unauthorized role — confirm `403 Forbidden`.

### SSO across extensions

- [ ] Log in once on Core.
- [ ] Navigate to AI Tutor — confirm same identity, no re-auth prompt.
- [ ] Navigate to Question Maker — confirm same identity, no re-auth prompt.
- [ ] Navigate to the new extension — confirm same identity, no re-auth prompt.

### API connectivity

- [ ] Make a user-scoped call from the extension to `GET /api/courses?page=1&pageSize=25` (forwarding the session cookie) — confirm the response contains courses the user has access to, in the `{ data, total, page, pageSize }` envelope.
- [ ] Make a service-level call using `EDUAI_API_KEY` — confirm a `200` response.
- [ ] Make a **mutating** call to Core with only the cookie — confirm `403 CROSS_ORIGIN_MUTATION`, then confirm the same call succeeds once `Authorization: Bearer <EDUAI_API_KEY>` is added.
- [ ] Confirm there are no local `/register` or `/login` routes. If a legacy auth system existed, confirm those routes return `404`.

### Sidebar registration

- [ ] Set `VITE_EXTRA_EXTENSIONS` in `apps/core/.env` and restart Core — confirm the extension appears in the **Switch app** tray.

---

## Reference implementations

| Extension | Middleware | Service client | Auth service |
|---|---|---|---|
| **Example** | `apps/extensions/example-extension/src/middleware/auth.js` | `src/server.js` (inline) | — (no DB) |
| AI Tutor | `apps/extensions/ai-tutor/server/src/middleware/auth.js` | `apps/extensions/ai-tutor/server/src/services/eduaiClient.js` | `apps/extensions/ai-tutor/server/src/services/eduaiAuth.js` |
| Question Maker | `apps/extensions/question-maker/app/backend/src/middleware/auth.js` | — | `apps/extensions/question-maker/app/backend/src/services/authService.js` |

**Core session validation endpoint:** `apps/core/app/routes/api/sessions.validate.ts`  
**Core login redirect protection:** `apps/core/app/lib/auth/guards.server.ts` (`validateRedirectUrl`)  
**Core app switcher registration:** `apps/core/app/lib/apps.tsx` (`getLauncherApps`, `parseExtraExtensions`)  
**Auth pipeline design doc:** `docs/implementations/auth-pipeline-centralization-plan.md`
