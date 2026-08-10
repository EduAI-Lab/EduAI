# Canvas live integration testing

The live Canvas suite is an explicit, opt-in check against the approved UBC Canvas sandbox:

- Host: `https://canvas.ubc.ca`
- Course: `204888` (`SB.EduAI`)
- Operations: authenticated profile, teacher-course discovery, course/term details, student and TA rosters, files, modules/items, and one approved file download
- Core: idempotent course sync and roster staging for the designated instructor identity

It is not included by `npm test`, ordinary unit or integration commands, pull-request workflows, or CI. The command selects a separate Vitest config:

```powershell
$env:CANVAS_LIVE_TESTS = "1"
$env:CANVAS_BASE_URL = "https://canvas.ubc.ca"
$env:CANVAS_TEST_COURSE_ID = "204888"
$env:CANVAS_LIVE_DATABASE_URL = "<designated dev database URL>"
$env:CANVAS_LIVE_CORE_USER_ID = "<existing dev instructor user id>"
$env:CANVAS_LIVE_APPROVED_FILE_ID = "<approved small sandbox file id>"
$env:CANVAS_TOKEN = "<personal Canvas token>"
$env:ENCRYPTION_KEY = "<dev server encryption key>"
npm run test:canvas-live
```

Instead of `CANVAS_TOKEN`, provide `CANVAS_TOKEN_FILE` pointing to a runtime-only file. On POSIX hosts it must be mode `600` or stricter. The token is never printed, persisted in source, included in test output, or sent through browser state. Do not put it in `.env`, shell history, or a committed file.

The suite fails closed unless the base URL is exactly the allowlisted HTTPS origin and the course id is exactly `204888`. `CANVAS_LIVE_DATABASE_URL` is required and must point to the designated development database containing the existing instructor identified by `CANVAS_LIVE_CORE_USER_ID`; the suite never falls back to `.env.test`'s disposable `eduai_test` database. That identity is the only Core identity used by the test. Canvas operations are GET-only. The Core sync is restricted to the designated course and uses existing upsert/staging behavior; it does not delete or unsync shared dev data.

Failures are labelled by capability (for example, `teacher course list` or `approved file download`) and are bounded by the Canvas client timeout. A `401`/`403` is reported as an authentication failure; a token that authenticates but cannot see course `204888` produces a teacher-access/precondition failure from the course assertion; missing approved files never fall back to another file.

The optional browser flow is intentionally separate from this API suite. If it is added, tag it with `@canvas-live-browser`, use Playwright against the dev application, and supply normal browser credentials through the existing protected E2E mechanism. Never retrieve a Canvas token from browser storage.
