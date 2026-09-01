# Dev Notes (Onboarding Gotchas)

This file supplements `README.md` and the in-app **Help Center**. It captures behaviors that are
“obvious once you know them” but confusing for new developers.

## Quick onboarding checklist

1. Copy env: `cp .env.example .env` in `apps/extensions/question-maker/` (not a per-package `.env` —
   both the backend and frontend read from this one).
2. Start the stack from the **monorepo root** (`npm install && npm run dev`, or
   `npx turbo run dev --filter='question-maker-*'` for just this extension). The Compose-only path
   (`docker compose -f docker-compose.dev.yml up` from this directory — no `npm run dev:up` wrapper
   script exists) still works but is not the primary dev workflow anymore.
3. Sign in through Core — there is no local login form. Question Maker trusts whatever Core session
   cookie the browser already has; `EDUAI_API_KEY` in your `.env` must match Core's.
   - New users start with zero courses. Real courses arrive by linking/importing a Core course from
     the course picker, or automatically on `/auth/me` for a caller who teaches (INSTRUCTOR) or TAs a
     Core course (`services/importTaughtCoursesService.js`) — nothing is demo-seeded.
   - For local fixture data, `npm run seed` (`app/backend/scripts/seedUnified.js`) seeds Core-linked
     data across Core/AI Tutor/QM together.

## Non-obvious product behaviors

### 1) Exports are blocked by Draft vs Reviewed

Canvas export/import and TXT/Word exports are blocked when an assessment still contains draft
(unreviewed) variants.

What to check:
- On the question composer or assessment builder, make sure every variant you want to export is
  marked **Reviewed** (the "Mark as reviewed" checkbox / draft toggle).
- A reviewed variant's content is then locked — editing it forces it back to draft for re-review
  (`VARIANT_LOCKED`, §19 of the RBAC matrix).

### 2) Canvas is connected per user, and the credential lives in Core

Canvas integration credentials are not read from `.env`, and as of #1084 Question Maker doesn't store
them at all — Core does.

What to check:
- Use the app UI "Connect" flow inside the **Export to Canvas** / **Import from Canvas** / **Sync
  question bank** dialogs, or from `/settings`.
- After connecting, pick the Canvas course/quiz/bank from the list Core returns.
- If you're chasing a Canvas auth bug, look in Core's Canvas integration storage, not in this
  database — QM has no `CanvasIntegration` table anymore.

Code pointers:
- Backend routes: `app/backend/src/routes/canvas.js`
- Backend service (all calls proxy through Core): `app/backend/src/services/canvasService.js`,
  `app/backend/src/services/coreApiService.js`

### 3) Bug-report admin access is role-based, not email-based

The admin triage page (`/admin/bug-reports`) is gated on `req.user.role === "ADMIN"` (the caller's
platform role from Core), not an email allowlist. `BUG_REPORT_ADMIN_EMAILS` is not read by the
bug-report routes.

What to check:
- If you expect to see the admin triage page and don't, confirm your Core account's platform role is
  `ADMIN`.

Code pointer: `app/backend/src/routes/bug-reports.js` — it's a thin proxy to Core's own
`/api/admin/bug-reports*`; there is no local `BugReport` model or `bugReportService.js`.

### 4) AI provider keys live in Core, with a browser fallback

When a user adds an "External" AI provider key (Google/OpenAI/DeepSeek/Anthropic/OpenCode), it's
saved to Core (`POST /api/eduai/provider-settings`, session-cookie authenticated) so it follows the
account across devices. Only if that write fails does it fall back to an account-scoped,
AES-GCM-encrypted `localStorage` entry in the current browser.

What to check:
- If generation fails with an auth/key error, confirm the right provider is selected and that its key
  was actually saved — the composer's save button reports whether it landed in Core or only the local
  fallback.
- The UBC-hosted campus model (`vllm:*`) needs no client key at all, but does need UBC network/VPN.

Code pointer: `app/frontend/src/services/apiKeyStorage.ts`

### 5) Where “starter content” comes from

If you can't find starter courses/topics after first sign-in:
- This is expected — a brand-new account starts with zero courses. Link or import a Core course to
  populate the list; nothing is seeded automatically except for a caller who already teaches/TAs a
  Core course, which auto-imports.
- For local dev fixture data, run `npm run seed` from `app/backend` (`scripts/seedUnified.js`).

### 6) A question's course, type, and primary topic are (mostly) locked once reviewed

Once any variant of a question is reviewed (non-draft), that question's `type` and `primaryTopicId`
are locked — the same 409 `VARIANT_LOCKED` convention that guards variant content. Move every sibling
variant back to draft before changing them. Course relocation is never supported at all — a
question/assessment cannot move between courses via a PUT.

## Troubleshooting quick checks

- "Export blocked": check draft/review status on every variant in the assessment.
- "Canvas not connected": connect in the UI (or `/settings`), then re-open the export/import/sync
  dialog — the connection lives in Core, not this app's `.env`.
- "Bug reports admin page not visible": verify the signed-in Core account's platform role is `ADMIN`.
- "AI generation auth errors": verify the selected model's provider has a key saved (Core-stored, or
  the local encrypted fallback), or that you're on UBC network/VPN for the campus model.
- "Can't edit a question's type/topic": check whether any of its variants are reviewed — revert them
  to draft first.
