# Test plan — Question Maker (EduQuery)

This document maps product features to automated tests, defines layers and priorities, and points maintainers to the right files. It pairs with [DEVELOPER_GUIDE.md](./DEVELOPER_GUIDE.md).

## 1. Goals

| Goal | Success criteria |
|------|------------------|
| Regression safety | Changes to auth, questions, assessments, Canvas, EduAI, and the assessment variant workflow are covered by tests that run in CI. |
| Handover | New owners can see *which* feature maps to *which* tests and where to add cases. |
| Test pyramid | Prefer **unit** tests on pure logic, **integration** tests on HTTP + DB for critical paths; **E2E** only if Playwright/Cypress is added later. |
| **Plan closure** | Every feature ID in §5 has a **Status** and at least one linked test file; optional DB integration is clearly labeled. |

## 2. Tooling

| Area | Command | Config |
|------|---------|--------|
| Backend | `cd app/backend && npm test` | Jest, ESM (`--experimental-vm-modules`) — [jest.config.js](../app/backend/jest.config.js) |
| Backend coverage | `npm run test:coverage` | Same |
| Frontend | `cd app/frontend && npm test` | `vitest run` — [package.json](../app/frontend/package.json); local watch: `npm run test:watch`. [vite.config.ts](../app/frontend/vite.config.ts) uses `jsdom` + [vitest.setup.ts](../app/frontend/src/test/vitest.setup.ts); [api.test.ts](../app/frontend/src/services/api.test.ts) uses `@vitest-environment node` for a local HTTP stub. |
| Test env | `app/backend/test/setup.js` | Loads root `.env` (optional); if `TEST_DATABASE_URL` is set, it becomes `DATABASE_URL`. If still unset (e.g. GitHub Actions with no file), a **local stub** `postgres://jest@127.0.0.1:5432/jest_unit_stub` is set so imports succeed — unit tests do not need a real server. You can also set `DATABASE_URL` in the workflow env. `JWT_SECRET` / `ENCRYPTION_KEY` get defaults if missing. |
| DB integration | `cd app/backend && npm run test:integration` | [jest.integration.config.js](../app/backend/jest.integration.config.js) — only `*.integration.test.js`, `maxWorkers: 1` to avoid clobbering a shared test DB. |
| Full backend | `npm run test:all` | Unit suite then integration suite. |

**PostgreSQL is required** for `test:integration`. In project root `.env` add, for example:

`TEST_DATABASE_URL=postgresql://USER:PASS@localhost:5432/eduquery_test`

Create the empty database once (`CREATE DATABASE eduquery_test;`). The app will `sync` the schema on connect. **Never** point `TEST_DATABASE_URL` at production data — each run uses `TRUNCATE users ... CASCADE` between cases.

## 3. Current baseline (inventory)

### Backend — unit (Jest, no real DB)

- [extraction.test.js](../app/backend/test/extraction.test.js) — `extractionUtils` (question blocks, chunking, dedupe).
- [health.test.js](../app/backend/test/health.test.js) — public HTTP surface (`/`, `/healthz`, 404).
- [encryption.test.js](../app/backend/test/encryption.test.js) — Canvas API key encrypt/decrypt.
- [authService.test.js](../app/backend/test/authService.test.js) — JWT `verifyToken` (A1).
- [assessmentVariantMetadataScoring.test.js](../app/backend/test/assessmentVariantMetadataScoring.test.js) — `scoreMetadataMatch`.
- [assessmentVariantAuth.test.js](../app/backend/test/assessmentVariantAuth.test.js) — `401` on `/api/assessment-variant` without a token.
- [eduaiAuth.test.js](../app/backend/test/eduaiAuth.test.js) — EduAI routes `401` without a token.
- [canvasExport.test.js](../app/backend/test/canvasExport.test.js) — `convertVariantToCanvasQuestion` / `parseMCQOptions`.
- [canvasExportMocked.test.js](../app/backend/test/canvasExportMocked.test.js) — `exportAssessmentToCanvas` with mocked axios/DB.
- [aiExtract.test.js](../app/backend/test/aiExtract.test.js) — `extractQuestionsFromText` empty input.
- [aiExtractEduaiMocked.test.js](../app/backend/test/aiExtractEduaiMocked.test.js) — `extractQuestionsFromText` with mocked EduAI + `Course`/`Topics`.
- [questionsAuth.test.js](../app/backend/test/questionsAuth.test.js) — `401` on core `/api/questions` and extract routes.
- [assessmentsAuth.test.js](../app/backend/test/assessmentsAuth.test.js) — `401` on `/api/assessments`.
- [courseAuth.test.js](../app/backend/test/courseAuth.test.js) — `401` on `/api/course`.
- [canvasAuth.test.js](../app/backend/test/canvasAuth.test.js) — `401` on Canvas routes.

**Express split:** [app.js](../app/backend/src/app.js) exports the app for supertest; [index.js](../app/backend/src/index.js) only listens and connects the DB.

### Backend — integration (Jest, `TEST_DATABASE_URL` required)

Skipped when unset (exit 0). [testDb.js](../app/backend/test/helpers/testDb.js) — connect + `TRUNCATE`.

- [auth.integration.test.js](../app/backend/test/auth.integration.test.js) — register validation, register/login/GET /me, duplicate email, wrong password, **unknown user login** (A2–A4).
- [questionAssessments.integration.test.js](../app/backend/test/questionAssessments.integration.test.js) — create/list questions, create/fetch assessment, `POST /api/course`, validation errors, add/list variants, empty variant `400` (C1, C2, F2 in part).
- [questionsExtractValidation.integration.test.js](../app/backend/test/questionsExtractValidation.integration.test.js) — extract and extract/save `400` validation (D4).
- [eduaiHttpValidation.integration.test.js](../app/backend/test/eduaiHttpValidation.integration.test.js) — EduAI `400` for missing `messages` / `courseCode` / `prompt` (E1).
- [assessmentVariantHttp.integration.test.js](../app/backend/test/assessmentVariantHttp.integration.test.js) — assessment-variant `400` bodies (H2).
- [planCoverage.integration.test.js](../app/backend/test/planCoverage.integration.test.js) — **cross-user** `GET /api/course/:id` → `404` (B1); **POST extract/save** success (D3); **POST assemble-variants** for Practice Exam with one label (H3).

### Frontend (Vitest)

- [api.test.ts](../app/frontend/src/services/api.test.ts) — axios `Authorization` + `401` handling (J1).
- [LoginPage.test.tsx](../app/frontend/src/pages/LoginPage.test.tsx) — login/register, errors, loading, redirect (J2).

## 4. Test layers

1. **Unit (no DB):** `extractionUtils`, `encryption`, `assessmentVariantMetadataScoring`, Canvas MCQ helpers, `extractQuestionsFromText` with mocks, `exportAssessmentToCanvas` with mocks.
2. **Service + DB:** Exercised via integration tests (`saveExtractedQuestions`, `assembleEquivalentExamVariants` paths, seeded courses/assessments).
3. **HTTP (supertest):** Authed and unauthed routes; no real EduAI/Canvas in CI (mocks for unit; validation routes hit code before upstream).
4. **Frontend (Vitest + Testing Library):** [api.test.ts](../app/frontend/src/services/api.test.ts), [LoginPage.test.tsx](../app/frontend/src/pages/LoginPage.test.tsx).

**Do not** call real EduAI or Canvas in automated suites except local/manual runs; use fixtures and mocks for CI.

## 5. Feature coverage matrix (IDs → status)

| ID | Area | Status | Where covered |
|----|------|--------|---------------|
| A1 | Auth unit (`verifyToken`) | Done | [authService.test.js](../app/backend/test/authService.test.js) |
| A2 | Register / validation / duplicate | Done | [auth.integration.test.js](../app/backend/test/auth.integration.test.js) |
| A3 | Login success / **wrong** password / **unknown** user | Done | [auth.integration.test.js](../app/backend/test/auth.integration.test.js) |
| A4 | GET /me 200 vs 401 | Done | [auth.integration.test.js](../app/backend/test/auth.integration.test.js) |
| B1 | Course scoped to `userId` (other user → not found) | Done | [planCoverage.integration.test.js](../app/backend/test/planCoverage.integration.test.js) |
| B2 | Course `401` without token | Done | [courseAuth.test.js](../app/backend/test/courseAuth.test.js) |
| C1 | Question create + list | Done | [questionAssessments.integration.test.js](../app/backend/test/questionAssessments.integration.test.js) |
| C2 | Question `401`; variants + list | Done | [questionsAuth.test.js](../app/backend/test/questionsAuth.test.js), [questionAssessments.integration.test.js](../app/backend/test/questionAssessments.integration.test.js) |
| D1 | Extraction utils | Done | [extraction.test.js](../app/backend/test/extraction.test.js) |
| D2 | `extractQuestionsFromText` | Done | [aiExtract.test.js](../app/backend/test/aiExtract.test.js), [aiExtractEduaiMocked.test.js](../app/backend/test/aiExtractEduaiMocked.test.js) |
| D3 | `saveExtractedQuestions` via HTTP | Done | [planCoverage.integration.test.js](../app/backend/test/planCoverage.integration.test.js) |
| D4 | Extract / extract/save `400` | Done | [questionsExtractValidation.integration.test.js](../app/backend/test/questionsExtractValidation.integration.test.js) |
| E1 | EduAI `401` + `400` validation | Done | [eduaiAuth.test.js](../app/backend/test/eduaiAuth.test.js), [eduaiHttpValidation.integration.test.js](../app/backend/test/eduaiHttpValidation.integration.test.js) |
| F1 | Assessment DB shape (sections, links) | Partial | `assemble-variants` + [questionAssessments.integration.test.js](../app/backend/test/questionAssessments.integration.test.js) (no dedicated **reorder** test) |
| F2 | Create assessment, attach variant to seeded Practice Exam | Done | [questionAssessments.integration.test.js](../app/backend/test/questionAssessments.integration.test.js), [planCoverage.integration.test.js](../app/backend/test/planCoverage.integration.test.js) |
| F3 | Assessments `401` | Done | [assessmentsAuth.test.js](../app/backend/test/assessmentsAuth.test.js) |
| G1 | Encryption | Done | [encryption.test.js](../app/backend/test/encryption.test.js) |
| G2 | Canvas question payload helpers | Done | [canvasExport.test.js](../app/backend/test/canvasExport.test.js) |
| G3 | Export flow mocked | Done | [canvasExportMocked.test.js](../app/backend/test/canvasExportMocked.test.js) |
| G4 | Canvas `401` | Done | [canvasAuth.test.js](../app/backend/test/canvasAuth.test.js) |
| H1 | `scoreMetadataMatch` | Done | [assessmentVariantMetadataScoring.test.js](../app/backend/test/assessmentVariantMetadataScoring.test.js) |
| H2 | Assessment-variant `400` | Done | [assessmentVariantHttp.integration.test.js](../app/backend/test/assessmentVariantHttp.integration.test.js) |
| H3 | `assembleEquivalentExamVariants` (single exam label) | Done | [planCoverage.integration.test.js](../app/backend/test/planCoverage.integration.test.js) |
| I1 | Health / root | Done | [health.test.js](../app/backend/test/health.test.js) |
| I2 | 404 JSON | Done | [health.test.js](../app/backend/test/health.test.js) |
| J1 | Frontend `api` client | Done | [api.test.ts](../app/frontend/src/services/api.test.ts) |
| J2 | `LoginPage` | Done | [LoginPage.test.tsx](../app/frontend/src/pages/LoginPage.test.tsx) |

**Intentional gaps (future work):** F1 “reorder” endpoints; E2E (Playwright/Cypress); full EduAI/Canvas E2E against sandboxes. Add new rows here when you add tests.

## 6. Suggested order for *new* tests

1. F1 — section reorder or blueprint edge cases (integration).  
2. E2E — critical smoke on staging.  
3. Any new route — mirror with `401` + validation `400` + one happy path.

## 7. Handover checklist

- [x] **CI** ([feature-ci.yml](../.github/workflows/feature-ci.yml)) runs `npm test` in `app/backend` and `app/frontend` on feature branches and PRs to `dev`.  
- [ ] **Integration in CI** — set `TEST_DATABASE_URL` and run `cd app/backend && npm run test:integration` in a job with Postgres (e.g. `services: postgres`) when you want DB tests on every PR. Local: `TEST_DATABASE_URL=... npm run test:all`.  
- [x] **No production secrets in repo** — use root `.env` (gitignored) or CI secrets; [test setup](../app/backend/test/setup.js) uses stubs when env is missing.  
- [x] **Frontend tests are non-interactive** — `npm test` runs `vitest run` (one shot); use `npm run test:watch` during development.  

---

*Last updated: feature coverage matrix completed; [feature-ci.yml](../.github/workflows/feature-ci.yml) and Vitest `run` mode reflected.*
