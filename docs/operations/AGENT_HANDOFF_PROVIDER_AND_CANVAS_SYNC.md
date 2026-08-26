# Agent Handoff: Provider Keys and Core Course Sync

**Date:** 2026-08-26  
**Repository:** `EduAICoreLearning`  
**Status:** Committed on `codex/issue-1589-performance` as `05501ec8d` and pushed to `origin` (`https://github.com/mostafama/EduAICoreLearning.git`). **Not yet pushed to the org remotes** (`eduai` → `EduAI-Lab/EduAI`, `eduaicore` → `EduAI-Lab/EduAICore`) — push there too before any deploy/PR that assumes the org repo has it.

## User requirements

1. Google/OpenAI API keys entered on one platform must be shared by Core, Question Maker (QM), and AI Tutor.
2. Do not change deployment environment files unless a real blocker is found.
3. A Canvas sandbox course must appear in Core, QM, and AI Tutor after one Core sync.
4. Direction of ownership is **Core → QM + AI Tutor**.
5. AI Tutor must not ask users to configure the internal `EDUAI_API_KEY` in its AI settings.

## Work completed

### Central provider keys

- Core encrypted user provider settings are now the source of truth.
- Core `/api/completion` resolves the signed-in user’s stored provider settings and treats them as authoritative over stale client-supplied keys.
- QM proxies provider-setting GET/POST/DELETE requests to Core using the user’s session cookie.
- AI Tutor has the equivalent `/api/provider-settings` proxy.
- QM and AI Tutor only receive key status/sentinel values on reads; raw keys are sent to Core only during save or legacy migration.
- Existing browser-local keys from older QM/AI Tutor versions are migrated when Core is available. Failed migrations are retained locally.
- QM status probes understand Core-stored keys without sending the sentinel as an actual credential.

Primary files:

- `apps/core/app/lib/ai/completion.server.ts`
- `apps/core/app/routes/api/completion.ts`
- `apps/extensions/question-maker/app/backend/src/routes/eduai.js`
- `apps/extensions/question-maker/app/backend/src/services/coreApiService.js`
- `apps/extensions/question-maker/app/frontend/src/services/apiKeyStorage.ts`
- `apps/extensions/ai-tutor/server/src/routes/provider-settings.js`
- `apps/extensions/ai-tutor/server/src/services/eduaiClient.js`
- `apps/extensions/ai-tutor/app/hooks/use-api-keys.ts`

### AI Tutor internal service key UI

- Removed the user-facing `EDUAI_API_KEY` card and related loader data from AI Tutor admin/settings UI.
- The backend `EDUAI_API_KEY` support remains intentionally, because internal/background server-to-server calls still use it when no user session cookie is available. No environment values were changed.

### Core course propagation

- AI Tutor course authentication and course-list routes now await the throttled, idempotent Core mirror.
- QM course listing now awaits its Core course mirror.
- This closes the previous timing gap where Core had synced a Canvas course but the extension’s local anchor was only created after a later request.
- QM course anchors remain keyed by `coreCourseId`; AI Tutor anchors remain keyed by `coreOfferingId`.
- Core question-bank/default-bank creation already happens during Core Canvas course creation. QM question-bank operations are Core-backed, and AI Tutor reads Core testable questions for tutor context.

Primary files:

- `apps/extensions/ai-tutor/server/src/services/importTaughtCoursesService.js`
- `apps/extensions/ai-tutor/server/src/routes/authentication.js`
- `apps/extensions/ai-tutor/server/src/routes/courses.js`
- `apps/extensions/question-maker/app/backend/src/routes/course.js`
- `apps/extensions/question-maker/app/backend/src/services/questionBankService.js`
- `apps/extensions/ai-tutor/server/src/routes/activities.js`

## Live-account observation

Using the signed-in dev account in the in-app browser, Core currently showed:

- `SB.EduAI`
- `EduAI Sandbox Course`
- Core route: `/courses/cms6ixhx0013ux55v2dz90apk`
- Term: `2026W1`
- Status: Published / Active

The browser inspection was read-only. The Canvas “Fetch from Canvas” action was not executed during this handoff.

## Validation completed

- `node --check` passed for all modified backend JavaScript files.
- `git diff --check` passed; only existing line-ending warnings were reported.
- Direct Core TypeScript checking reported only pre-existing missing dependency/file-processing errors; no modified completion-file errors were reported.
- QM frontend TypeScript checking reported existing React/@types JSX incompatibilities; no issue specific to the modified provider-key files was identified.
- AI Tutor frontend TypeScript checking is blocked by missing generated route types, missing `driver.js`, and existing implicit-any errors.
- **2026-08-26 (follow-up):** Vitest does run in this environment (the earlier "denied config traversal" note does not reproduce here). Ran `apps/core`'s full `app/tests/unit` suite (205 files / 2367 tests). Result: 22 files fail to *load* on pre-existing, unrelated missing dependencies (`p-limit`, `happy-dom` not present in `node_modules`) — confirmed unrelated by checking the failures point at `node_modules` resolution, not at any file this task touched.
- **Regression found and fixed:** `runCompletion` now calls the real `getUserProviderSettings` (Prisma) whenever `request.userId` is set. Two existing unit test files mock a session with a user id but did not mock `~/lib/user-provider-settings.server`, so they began hitting a real (unavailable) database: [`completion.route.test.ts`](../../apps/core/app/tests/unit/completion.route.test.ts) and [`completion-late-stream-error.route.test.ts`](../../apps/core/app/tests/unit/completion-late-stream-error.route.test.ts). Fixed by adding `vi.mock("~/lib/user-provider-settings.server", ...)` returning `{}` in both files. All 20 completion-related tests (including `api-completion.route.test.ts`, which mocks `runCompletion` itself and was never affected) now pass.
- No other test files call the real `runCompletion`/`getUserProviderSettings` path, so no further regressions from this change were found in the Core unit suite.

## Next-agent checklist

1. ~~Review the working-tree diff and preserve unrelated existing changes.~~ Done 2026-08-26: reviewed the full diff for the sentinel/merge logic described above; no unrelated changes were touched.
2. ~~Run the app-specific test commands...~~ Done 2026-08-26 for Core's unit suite (see Validation above); QM/AI Tutor have no existing tests covering the new provider-settings proxy routes, so there was nothing to run there for this change specifically.
3. ~~Before committing, check that no `.env`, deployment secret, unrelated infrastructure, generated distribution, or user data files were modified.~~ Done 2026-08-26: the working tree also had **unrelated, unreviewed** uncommitted changes left over from the earlier fleet-router/ops work — `infra/cmps01/*`, `packages/types/dist/*` — plus stray untracked ops docs (`OPERATIONAL_HANDOFF_2026-08-24.md`, `docs/rag-ai/latency/eduai-summer-2026/*`) and a `.worktrees/` directory of other worktrees. **None of these were committed** — only the 34 files in the "Primary files" lists above (plus `TESTS.md` and this doc) went into `05501ec8d`. If those infra/dist changes are still needed, they must be reviewed and committed separately by whoever owns that work.
4. Manually verify with one test account:
   - Save Google key in Core; confirm QM and AI Tutor show “connected”.
   - Save OpenAI key in QM; confirm Core and AI Tutor show the same status.
   - Confirm raw keys never appear in GET responses or browser UI after save.
   - Delete the key in AI Tutor; confirm it disappears from Core and QM.
5. With the Canvas-access account, run one Core Canvas sync and verify the sandbox appears in Core chat, QM, and AI Tutor without a second refresh/request.
6. Verify the sandbox’s Core default question bank exists and that QM questions marked/testable are visible to AI Tutor’s Core question lookup.
7. Do not remove backend `EDUAI_API_KEY` support unless all unscoped/background Core calls are redesigned to use another authenticated mechanism.

## Deploy-for-testing status (2026-08-26, same session)

The user asked to deploy this temporarily to `s378.ok.ubc.ca` (dev host) for testing.

- **This agent has no working SSH credential to `s378`** — the host is reachable (banner responds) but `SyedS@s378` gets `Permission denied (publickey,password)`. Per the ops handoff's own rule, don't try to work around this; a new key must be added through an already-authenticated human session on that box.
- HTTPS to `https://dev.eduai.ok.ubc.ca` **is** reachable from this agent's sandbox (`/api/health` returns 200), but no valid login credential was available to actually sign in and verify pages as an authenticated user.
- **Runbook for a human to deploy commit `05501ec8d` to s378:**
  ```bash
  # push to the org remote first if s378's checkout doesn't already have your fork as a remote
  git push eduai codex/issue-1589-performance   # from a machine with org push access

  # on s378
  cd /srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore
  git fetch <remote-with-the-branch> codex/issue-1589-performance
  git checkout codex/issue-1589-performance && git pull
  cd apps/core && npm install && npm run build
  cd ../extensions/ai-tutor && npm install && npm run build
  cd ../question-maker && npm install && npm run build
  sudo systemctl restart eduai-core
  sleep 3 && curl -fsS http://127.0.0.1:3000/api/health
  ```
  Then run the manual-verification checklist above.

## Open issue reported by the user (unresolved, needs a human with dev access)

The user reported: **Settings and AI Management pages redirect back to Dashboard/Courses**, while Dashboard/Courses themselves load fine, on `dev.eduai.ok.ubc.ca` under their signed-in account (`saadtab01@gmail.com`).

- Root cause is almost certainly the server-side role gate in both routes — neither was touched by this task's diff, so it's unrelated to the provider-key/canvas-sync work:
  - [`apps/core/app/routes/admin.settings.tsx:79`](../../apps/core/app/routes/admin.settings.tsx) — `if (session.user.role !== 'ADMIN') redirect('/dashboard')`
  - [`apps/core/app/routes/admin.ai-models.tsx:27-28`](../../apps/core/app/routes/admin.ai-models.tsx) — same pattern
  - Both redirects are silent (no toast/error), which matches the user's description exactly.
- **Not yet confirmed**: whether the account's DB role is actually non-`ADMIN`, or whether the role is `ADMIN` in the DB but a stale session cookie (issued before a role change) is still carrying an old role. This agent could not check either — no local dev DB running (`127.0.0.1:54320` refused connections when tested), and no s378 SSH/dev-login credential available.
- **Next agent / human should run, on s378:**
  ```bash
  cd /srv/www/dev.eduai.ok.ubc.ca/EduAICore/EduAICore/apps/core
  npx prisma db execute --schema=prisma/schema.prisma --stdin <<'EOF'
  SELECT id, email, role, "isActive" FROM "User" WHERE email = 'saadtab01@gmail.com';
  EOF
  ```
  or simpler, in-browser while signed in: hit `https://dev.eduai.ok.ubc.ca/api/me` and read `role` from the JSON.
  - If `role` isn't `ADMIN`: `UPDATE "User" SET role = 'ADMIN' WHERE email = 'saadtab01@gmail.com';` then have the user re-sign-in.
  - If `role` already is `ADMIN`: have the user fully sign out and back in (stale cookie theory) before looking further at `getRequestSession` (`apps/core/app/lib/auth/request-session.server.ts`) for whether it caches role in the session token instead of re-reading current DB state per request.

## Important design constraints

- Core is the source of truth for course identity, enrollment visibility, provider-key storage, and question banks.
- Extensions may keep temporary legacy local fallbacks for migration/offline development, but new successful writes must go to Core.
- Do not reintroduce QM → Core course ownership or code-matching as the normal sync direction. The supported path is Core course sync followed by extension mirrors.
