# Extension Onboarding Guide

**Issue:** EduAICore #636  
**Last Updated:** 2026-07-08  
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
8. [Registering with Core's sidebar](#8-registering-with-cores-sidebar)
9. [Local development setup](#9-local-development-setup)
9. [Verification checklist](#9-verification-checklist)

---

## 1. Overview

Core is the single identity provider for the entire platform. Extensions do not manage their own user accounts, issue their own tokens, or run their own auth flows.

**How it works:**

1. A user logs in on Core. Core sets a session cookie with `Domain=.eduai.ok.ubc.ca` (production) or `Domain=localhost` (development). The cookie is readable by every extension running under the same domain.
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
# Used for server-to-server calls that are not on behalf of a specific user
EDUAI_API_KEY=

# Core API base URL — used by service-level API calls
EDUAI_BASE_URL=http://localhost:3000/api
```

> **Note:** Do not add `JWT_SECRET`, local user table vars, or any credential that implies the extension manages its own auth. Those belong only in Core.

---

## 4. Session validation middleware

Both extensions implement the same `requireAuth` middleware. Copy this pattern exactly:

```js
// src/middleware/auth.js

const VALID_ROLES = new Set(['STUDENT', 'PROFESSOR', 'TA', 'ADMIN', 'UNIT_ADMIN']);

function normalizeRole(role) {
  return VALID_ROLES.has(role) ? role : 'STUDENT';
}

export async function requireAuth(req, res, next) {
  try {
    const response = await fetch(`${process.env.CORE_URL}/api/sessions/validate`, {
      method: 'POST',
      headers: { cookie: req.headers.cookie ?? '' },
    });

    if (!response.ok) {
      if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const returnUrl = encodeURIComponent(`${process.env.EXTENSION_URL}${req.originalUrl}`);
      return res.redirect(`${process.env.CORE_URL}/login?redirect=${returnUrl}`);
    }

    const { user } = await response.json();
    req.user = { ...user, role: normalizeRole(user.role) };
    next();
  } catch {
    res.status(401).json({ error: 'Authentication required' });
  }
}
```

Key points:

- **Forward the raw `Cookie` header verbatim.** Do not parse or filter it — Core's session store resolves the correct session from the cookie value.
- **API routes (`/api/*`) return 401.** These are called by fetch, not browser navigation. Let the client handle it.
- **All other routes redirect to Core login.** The `?redirect=` param tells Core where to send the user after authentication.
- **Unknown roles normalize to `STUDENT`.** This is the least-privilege default and guards against future roles that the extension hasn't been updated to recognize.

### Core response shape

`POST /api/sessions/validate` returns:

```json
{
  "user": {
    "id": "user_cuid",
    "email": "user@example.com",
    "name": "User Name",
    "image": "https://...",
    "role": "STUDENT | PROFESSOR | TA | ADMIN | UNIT_ADMIN",
    "authorizedUnits": []
  }
}
```

`authorizedUnits` is only populated for `UNIT_ADMIN` users. Extensions that implement unit-level scoping (like AI Tutor) use this array to filter which courses a unit admin can see. Extensions that do not implement unit scoping can ignore the field.

Returns `401` (no body) when the session is missing or expired.

---

## 5. Login redirect flow

When `requireAuth` receives a `401` from Core on a non-API route, it redirects the user to Core's login page with a `?redirect=` parameter:

```
GET {CORE_URL}/login?redirect={encodeURIComponent(extensionUrl + req.originalUrl)}
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
router.post('/courses', requireAuth, requireRole(['ADMIN', 'PROFESSOR']), handler);
```

Role values from Core:

| Role | Meaning |
|---|---|
| `STUDENT` | Enrolled student |
| `PROFESSOR` | Course instructor (in AI Tutor, this role is called `INSTRUCTOR`) |
| `TA` | Teaching assistant |
| `ADMIN` | Platform administrator |
| `UNIT_ADMIN` | Department-level administrator scoped to authorized units |

> **AI Tutor note:** AI Tutor maps `PROFESSOR` → `INSTRUCTOR` internally. If your extension uses different role names, apply the mapping inside `normalizeRole` before setting `req.user` — never after.

---

## 7. Calling Core APIs

There are two kinds of server-to-server calls from an extension to Core. The auth method differs between them.

### User-scoped calls

When an extension makes an API call **on behalf of a specific user** (e.g., fetching that user's courses), forward the raw `Cookie` header from the incoming request. Core resolves the user identity from the session cookie and applies the appropriate role filtering.

```js
async function getUserCourses(req) {
  const response = await fetch(`${process.env.EDUAI_BASE_URL}/courses`, {
    headers: { cookie: req.headers.cookie ?? '' },
  });
  if (!response.ok) throw new Error(`Core returned ${response.status}`);
  return response.json();
}
```

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

### Core endpoints that accept service key calls

| Endpoint | Description |
|---|---|
| `GET /api/courses` | List all courses (role-filtered if cookie; all if service key) |
| `GET /api/courses/:id/topics` | Topics for a course |
| `GET /api/courses/:id/enrollments` | Student roster |
| `POST /api/bug-reports` | Submit a bug report |
| `POST /api/questions` | Push a question variant to Core |
| `GET /api/policies` | Fetch platform feature flags |

---

## 8. Registering with Core's sidebar

Once your extension is running, add it to the Core app switcher so users can navigate to it.

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

Open Core in a browser, look at the sidebar app switcher — "Example Extension" appears. Click it to trigger the login redirect flow end-to-end.

---

## 9. Local development setup

Core and the new extension must run simultaneously for the auth flow to work.

| Service | Default port | `CORE_URL` value |
|---|---|---|
| Core | `3000` | — |
| AI Tutor | `4000` | `http://localhost:3000` |
| Question Maker | `8000` | `http://localhost:3000` |
| Example extension | `9000` | `http://localhost:3000` |

**Cookie behavior across ports:**  
Core sets `Domain=localhost` in development. Modern browsers (Chrome, Firefox, Edge) share `Domain=localhost` cookies across ports when `SameSite=Lax` is set, which is Better Auth's default. No host file edits are required.

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
- [ ] Visit a protected extension route without a session — confirm a redirect to `{CORE_URL}/login?redirect=<extension-url>`.
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

- [ ] Make a user-scoped call from the extension to `GET /api/courses` (forwarding the session cookie) — confirm the response contains courses the user has access to.
- [ ] Make a service-level call using `EDUAI_API_KEY` — confirm a `200` response.
- [ ] Confirm there are no local `/register` or `/login` routes. If a legacy auth system existed, confirm those routes return `404`.

### Sidebar registration

- [ ] Set `VITE_EXTRA_EXTENSIONS` in `apps/core/.env` and restart Core — confirm the extension appears in the sidebar app switcher.

---

## Reference implementations

| Extension | Middleware | Service client | Auth service |
|---|---|---|---|
| **Example** | `apps/extensions/example-extension/src/middleware/auth.js` | `src/server.js` (inline) | — (no DB) |
| AI Tutor | `apps/extensions/ai-tutor/server/src/middleware/auth.js` | `apps/extensions/ai-tutor/server/src/services/eduaiClient.js` | `apps/extensions/ai-tutor/server/src/services/eduaiAuth.js` |
| Question Maker | `apps/extensions/question-maker/app/backend/src/middleware/auth.js` | — | `apps/extensions/question-maker/app/backend/src/services/authService.js` |

**Core session validation endpoint:** `apps/core/app/routes/api/sessions.validate.ts`  
**Core login redirect protection:** `apps/core/app/lib/auth/guards.server.ts` (`validateRedirectUrl`)  
**Core sidebar registration:** `apps/core/app/lib/apps.tsx` (`getLauncherApps`, `parseExtraExtensions`)  
**Auth pipeline design doc:** `docs/implementations/auth-pipeline-centralization-plan.md`
