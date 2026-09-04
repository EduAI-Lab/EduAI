# Test plan — Question Maker

This document maps the test suite's layers, tooling, and layout to the codebase. It pairs with
[DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md). It intentionally does not enumerate every test file —
that list is large (150+ files) and drifts fast; use the directory layout and naming conventions
below plus `grep`/your editor to find the test for a given piece of code.

## 1. Goals

| Goal | Success criteria |
|------|------------------|
| Regression safety | Changes to RBAC, questions/variants, assessments, the variant workflow, Canvas, and EduAI are covered by tests that run in CI. |
| Handover | New owners can tell which *kind* of test to write for a given change, and where it lives. |
| Test pyramid | Prefer **unit** tests on pure logic, **integration** tests on HTTP + real Postgres for anything RBAC/DB-shaped; PICT tests for route/permission combinations too large to enumerate by hand. |

## 2. Tooling

| Area | Command | Config |
|------|---------|--------|
| Backend unit | `cd app/backend && npm run test:unit` (or `npm test` for unit+integration) | Vitest — [vitest.config.js](../app/backend/vitest.config.js). `tests/**/*.test.js`, excluding `*.integration.test.js`. |
| Backend integration | `cd app/backend && npm run test:integration` | [vitest.integration.config.js](../app/backend/vitest.integration.config.js) — only `*.integration.test.js`; `globalSetup` syncs the Prisma schema once up front so parallel files don't race table creation; needs `TEST_DATABASE_URL`. |
| Backend coverage | `npm run test:coverage` | [vitest.coverage.config.js](../app/backend/vitest.coverage.config.js) |
| Frontend unit | `cd app/frontend && npm run test:unit` | [vitest.unit.config.ts](../app/frontend/vitest.unit.config.ts) — `jsdom`; includes `src/tests/unit/**` **and** co-located `src/components/**/*.test.tsx` / `src/pages/**/*.test.tsx`. |
| Frontend integration | `cd app/frontend && npm run test:integration` | [vitest.integration.config.ts](../app/frontend/vitest.integration.config.ts) — `node` environment, targets `src/tests/integration/**`; currently empty (`passWithNoTests: true`) — this suite is scaffolded but unused today. |
| Frontend, both | `npm test` (runs unit then integration) | |
| Test env (backend) | `app/backend/tests/setup.js` | Loads the root `.env` if present; `TEST_DATABASE_URL` (if set) becomes `DATABASE_URL` for the run. Pino is silenced (`LOG_LEVEL=silent`) unless overridden. |

**PostgreSQL is required** for backend `test:integration`. Set, e.g.:

```
TEST_DATABASE_URL=postgresql://USER:PASS@localhost:5432/eduquery_test
```

Create the database once; Prisma applies the schema via the integration suite's `globalSetup`
(`tests/globalSetup.js`) using the committed migrations, not `db push`. **Never** point
`TEST_DATABASE_URL` at production data — [`tests/helpers/testDb.js`](../app/backend/tests/helpers/testDb.js)
truncates every table between test files (`utils/truncateAllTables.js`, which spares
`_prisma_migrations` so Prisma doesn't lose its migration history).

## 3. Layout and conventions

### Backend (`app/backend/tests/`)

- **`unit/`** — no real DB; pure functions and mocked-collaborator service/route tests (extraction
  chunking/dedupe, MCQ correctness normalization, pagination parsing, RBAC rank helpers, Canvas
  question conversion, `401`-without-a-session-cookie route smoke tests, etc.).
- **`integration/`** — real Postgres via `TEST_DATABASE_URL`; route + service + Prisma round-trips
  (course/topic CRUD, question/variant lifecycle including the §16/§19 draft-lock and TA-own-only
  rules, assessment section/reorder, the assessment-variant assembly/readiness/AI-review endpoints,
  Canvas mapping guards, the internal cascade-delete route, seed-migration/practice-exam-upgrade
  behavior).
- **`*.pict.test.js` / `*.pict.integration.test.js`** — combinatorial/pairwise coverage generated
  from a small parameter model (`tests/helpers/pictModel.js`) rather than hand-enumerated cases, run
  through shared route-mocking/execution helpers (`tests/helpers/pictRouteMocks.js`,
  `tests/helpers/pictRouteRunner.js`). Used where the number of meaningful role × access-level ×
  request-shape combinations is too large to write out by hand (RBAC gates, cross-extension push
  gating).
- **`tests/helpers/`** — `testDb.js` (connect + truncate), `testEnv.js`, `prismaCli.js` (drives
  `prisma` CLI commands for the migration/baseline integration tests), `seedCoursesFixture.js`,
  `teachingInstructorFetch.js` (a fetch double for Core enrollment lookups), the PICT helpers above.
- **Express split**: `src/app.js` exports the Express app for `supertest` without binding a port;
  `src/index.js` only starts listening and connects the database. Route tests import `app.js`.

### Frontend (`app/frontend/src/`)

- **`tests/unit/`** — the majority of component/hook/page tests.
- **Co-located `*.test.tsx`** next to a handful of components/pages (both patterns are picked up by
  the same `test:unit` run — see the config `include` list above).
- **`tests/integration/`** — scaffolded (config + `passWithNoTests: true`) but currently empty.
- **`tests/vitest.setup.ts`** — shared setup (Testing Library matchers, etc.) for both configs.

## 4. Test layers

1. **Unit (no DB):** pure helpers (`extractionUtils`, `mcqCorrectness`, pagination parsing,
   `courseAccess` rank math, Canvas MCQ/answer conversion), and service/route logic exercised with
   mocked Prisma/Core/EduAI collaborators.
2. **Service + DB (integration):** real Prisma against `TEST_DATABASE_URL` — question/variant
   mutation-fence behavior, assessment-variant assembly transactions, Canvas mapping guards, course
   auto-import/anchor locking, reconciliation.
3. **HTTP (supertest):** authenticated and unauthenticated routes, RBAC gates per rbac-matrix.md
   section, validation `400`s, admission-control `429`/`504`s.
4. **PICT (combinatorial):** role × course-access-level × request-shape matrices for the routes where
   hand-written cases would either miss combinations or become unmaintainable.
5. **Frontend (Vitest + Testing Library):** component/hook/page unit tests; no browser E2E suite yet
   (Playwright/Cypress is tracked as future work, see [FUTURE_WORK.md](FUTURE_WORK.md)).

**Do not** call real EduAI or Canvas in automated suites; fixtures/mocks stand in for both in CI. The
one exception is the manual/local `npm run test:ocr` script
(`app/backend/scripts/testOcrExtraction.js`), which reads local, untracked PDF/text fixtures from
`app/backend/test/ocr_tests/` (or a path given as an argument) to sanity-check block detection on real
assignment files — see [features/ocr/OCR_EXTRACTION_INVESTIGATION.md](features/ocr/OCR_EXTRACTION_INVESTIGATION.md).

## 5. Where to add a test for a new route or service

1. **Unit** — if the new logic is a pure function (validation, formatting, scoring), give it its own
   unit test with mocked collaborators.
2. **Integration** — every new mutating route should get: a `401` (no session cookie) case, the RBAC
   boundary (`403` for a role/access-level that shouldn't reach it, success for one that should), a
   validation `400` for a malformed body, and one real happy-path round-trip against Postgres.
3. **PICT** — only reach for this when the route's authorization surface has more role × access
   combinations than are practical to hand-write (see the existing `*.pict.*` files for the pattern);
   don't default to it for a simple two-role gate.
4. Record the new coverage in this file only if it changes the *shape* of the suite (a new layer, a
   new fixture pattern) — day-to-day test additions don't need an entry here.

## 6. Handover checklist

- [x] **CI** runs the backend and frontend `npm test` on feature branches and PRs into `development`
      (see the workflow files under the monorepo's `.github/workflows/`, and
      [features/CI-CD.md](features/CI-CD.md) for this extension's pipeline notes).
- [ ] **Integration in CI** — confirm `TEST_DATABASE_URL` is set with a live Postgres service in
      whichever job is expected to run `cd app/backend && npm run test:integration`; without it the
      integration suite is skipped locally (`globalSetup` no-ops).
- [x] **No production secrets in the repo** — use the root `.env` (gitignored) or CI secrets;
      `tests/setup.js` tolerates a missing `.env`.
- [x] **Frontend tests are non-interactive** — `npm test` runs both Vitest suites in `run` mode; use
      `npm run test:watch` during development.
