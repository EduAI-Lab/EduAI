## Question Maker Codebase Summary

Full-stack assessment and question-authoring product with AI-assisted generation, OCR extraction,
Canvas LMS import/export, and structured variant-assembly workflows.

> **This document used to be a forward-looking integration plan** (JWT → Better Auth, Sequelize →
> Prisma, separate repo → monorepo). That migration is **done**. Question Maker now lives inside the
> `EduAI-Lab/EduAI` monorepo, builds from the root workspace, and authenticates every request against
> Core's session cookie — there is no local login, no JWT, and no Sequelize model anywhere in this
> codebase. What follows describes the **current** integration, not a target state.

### High-Level Stats

- **Primary apps**: 2 (`app/frontend`, `app/backend`)
- **Backend route domains**: 10 (`course`, `topics`, `questions`, `variants`, `assessments`,
  `assessmentVariant`, `eduai`, `canvas`, `auth`, `bug-reports`) plus an internal service-key domain
- **Prisma data models**: 13 (`prisma/schema.prisma`)
- **Test files**: 150+ across `app/backend/tests/` and `app/frontend/src/tests/` (unit, integration,
  and PICT combinatorial suites — see [TEST_PLAN.md](TEST_PLAN.md))

### Architecture At A Glance

| **Layer** | **Current Implementation** | **Notes** |
| --- | --- | --- |
| **Frontend** | React 19 + Vite + React Router 7 | Course-centric routing (`/courses/:courseId/...`), `@eduai/ui` shared design system, Axios API layer |
| **Backend** | Node 18+ + Express (ESM) | Dedicated REST API, one service module per domain |
| **Data** | PostgreSQL + **Prisma** | `Course` is a bare `{userId, coreCourseId}` anchor — name/code/term/year are Core-owned and read through on every response |
| **Auth** | **No local accounts.** Core session cookie, validated per-request via `POST {CORE_URL}/api/sessions/validate` | `middleware/auth.js`; a thin local `User` row exists only for FK integrity |
| **Infra** | Docker Compose (dev/prod) + Apache reverse proxy | Builds from the monorepo root so npm workspaces resolve; see [deployment/README.md](deployment/README.md) |
| **External Integrations** | EduAI Core (auth, courses/enrollment, AI models/generation, Canvas credentials) + Canvas LMS (via Core's proxy — QM never calls Canvas directly) | |

### Business-Critical Product Flows

| **Flow** | **Primary Backend Surface** | **Primary Frontend Surface** |
| --- | --- | --- |
| **Session bootstrap** | `GET /api/auth/me` | `AuthContext` + `QmAppGate` |
| **Course anchor + onboarding** | `/api/course` (+ auto-import on `/auth/me`) | `CourseSelectionPage` + `CourseDetailPage` |
| **Question bank CRUD + AI generation** | `/api/questions` + `/api/eduai/generate-questions` | `QuestionComposerPage`, `QuestionBankPage` (`/library`) |
| **OCR extraction and save** | `/api/questions/extract` + `/api/questions/extract/save` | `QuestionUploadDialog` (background extraction + OCR history) |
| **Assessment and section builder** | `/api/assessments` | `AssessmentBuilderPage` + `components/assessments/*` |
| **Variant workflow (parallel exams + AI judge)** | `/api/assessment-variant` | `AssessmentVariantPage` (4-step wizard) |
| **Canvas LMS integration** | `/api/canvas` (proxies Core) | `CanvasExportDialog` / `CanvasImportDialog` / `CanvasBankSyncDialog` |
| **Bug report triage** | `/api` (`bug-reports.js`, proxies Core) | `BugReportContext` + `BugReportsAdminPage` (ADMIN role only) |

### Shared Data Ownership (as implemented)

| **Area** | **Owner** | **Notes** |
| --- | --- | --- |
| User identity, platform role, enrollment | **Core** | QM reads it per-request via the session cookie / `getCourseEnrollmentsFromCore`; never writes it. |
| Course shell (name/code/term/year/department) | **Core** | QM's `Course` row is only `{userId, coreCourseId}`; every read projects Core's fields on top (`courseListService.js`). |
| Question bank / variants / assessment artifacts | **Question Maker** | Core can read a *published* (approved + shared) question back via `coreQuestionId`, but authoring stays in QM. |
| AI provider keys | **Core**, with a QM-local encrypted `localStorage` fallback | `apiKeyStorage.ts`; falls back only when Core is unreachable. |
| Canvas credentials | **Core** (#1084) | QM has no `CanvasIntegration` table; every Canvas HTTP call is proxied through Core. |
| AI model catalog / routing policy | **Core** | QM calls Core's `/api/ai-models` and `/api/completion`; see [EduAI-API.md](EduAI-API.md). |
| Core→QM cascade delete | Core initiates, QM applies | `DELETE /api/internal/courses/:coreCourseId`, service-key authenticated (`routes/internal.js`); also self-healed daily by `jobs/reconcile.js`. |

### RBAC (per-course, resolved from Core enrollment)

Access ranks `admin(4) > unit(3) > instructor(2) > ta(1) > student(0)`, resolved fresh from Core
enrollment/unit data on (or near) every request — never from local `Course.userId` ownership alone
(#1114). See `middleware/courseAccess.js` and `app/frontend/src/lib/rbac/` for the mirrored
client-side gates used for UI affordances (the server remains authoritative).

### Where a published Core `Question` comes from

An approved (`isDraft: false`) variant with `shareWithExtensions: true` is pushed to Core as a
`Question` (`services/coreWiringService.js` → `services/variant-publish.js`), so other EduAI
extensions (e.g. AI Tutor) can use it. Un-reviewing a shared variant withdraws it from Core
(`testable: false`) rather than deleting the row, so the link can be re-asserted on the next approval.

### Team Message

The repository is modular by domain (`auth`, `course`, `questions`, `variants`, `assessments`,
`assessmentVariant`, `canvas`, `bug-reports`) with Prisma as the single ORM and Core as the single
identity/enrollment/Canvas-credential authority. New contributors should treat
`prisma/schema.prisma`, `middleware/courseAccess.js`, and `services/coreApiService.js` as the three
files that best explain "how this app actually talks to the rest of the platform."
