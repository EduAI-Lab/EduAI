# Dev Notes (Onboarding Gotchas)

This file supplements `README.md` and the in-app **Help Center**. It captures behaviors that are “obvious once you know them” but confusing for new developers.

## Quick onboarding checklist

1. Copy env:
   - `cp .env.example .env`
2. Start the stack:
   - Docker dev: `npm run dev:up`
   - Or local: run backend (`app/backend`) and frontend (`app/frontend`) in two terminals.
3. Register/login a new user.
   - The backend seeds a starter dataset (default courses/topics + sample questions) for newly registered users.
   - Code pointer: `app/backend/src/services/seedNewUserService.js`.

## Non-obvious product behaviors

### 1) Exports are blocked by Draft vs Reviewed

Canvas export/import and TXT/Word exports are blocked when variants are still drafts.

What to check:
- On the question/assessment variant workflow, ensure variants are marked **Reviewed** (draft toggle unchecked).

## 2) Canvas is connected *per user* inside the UI

Canvas integration credentials are not configured only via `.env`.

What to check:
- Use the app UI “Connect” flow in the **Export to Canvas** / **Import from Canvas** dialogs.
- After connecting, pick a Canvas course/quiz from the returned list.

Code pointers:
- Backend routes: `app/backend/src/routes/canvas.js`
- Backend service: `app/backend/src/services/canvasService.js`

### 3) Bug-report admin access is email-based

The admin triage page is enabled by email (not by a dedicated “role” table).

What to check:
- Default admin email is hard-coded as `admin@mail.com`
- Additional emails come from `BUG_REPORT_ADMIN_EMAILS` (comma-separated)

Code pointer: `app/backend/src/services/bugReportService.js`

### 4) External AI keys live in the browser (encrypted localStorage)

When using “External” AI provider models, provider API keys are stored in the browser (encrypted at rest) rather than being only backend environment variables.

What to check:
- If generation fails with an auth error, confirm the correct provider key is set in the UI model/key flow.
- Clear browser storage if you’re testing new keys.

Code pointer: `app/frontend/src/services/apiKeyStorage.ts`

### 5) Where “starter content” comes from

If you can’t find starter courses/topics after first login:
- The expected behavior is that newly registered users are seeded with default courses/topics/questions.

Code pointer: `app/backend/src/services/seedNewUserService.js`

## Troubleshooting quick checks

- “Export blocked”: check draft/review status on variants.
- “Canvas not connected”: connect in the UI, then re-open the export/import dialog.
- “Bug reports admin page not visible”: verify email matches `admin@mail.com` or `BUG_REPORT_ADMIN_EMAILS`.
- “AI generation auth errors”: verify provider selection + browser-stored (encrypted) provider key.

