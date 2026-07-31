# EduAI developer guide

This is the starting point for future developers working in the EduAI
monorepo. It summarizes the system boundary, stack, conventions, common
workflows, and the deeper documentation to read before changing a subsystem.

It is a map, not a replacement for the subsystem documents. For current
behavior, prefer executable code and tests over planning documents.

## System at a glance

EduAI is an npm-workspaces/Turborepo monorepo with three products:

```text
apps/core/                                  Core SSR app and central API
apps/extensions/ai-tutor/                   AI Tutor React Router frontend
apps/extensions/ai-tutor/server/            AI Tutor Express/Prisma API
apps/extensions/question-maker/app/frontend Question Maker Vite SPA
apps/extensions/question-maker/app/backend  Question Maker Express/Prisma API
packages/ui/                                Shared @eduai/ui components
packages/types/                             Shared roles and enrollment types
tests/e2e/                                  Full-platform Playwright tests
docs/                                       Cross-platform documentation
```

Core owns identity and is the authority for users, platform roles, courses, and
course enrollments. Extensions validate the Core session cookie and keep only
the local data needed for their product workflows.

## Technology stack

| Area | Core | AI Tutor | Question Maker |
| --- | --- | --- | --- |
| Frontend | React 19, React Router 7 SSR, TypeScript, Vite | React 19, React Router 7, TypeScript, Vite | React 19, React Router 7 SPA, TypeScript, Vite |
| Backend | React Router server routes on Node | Express 5 on Node | Express 4 on Node |
| Data access | Prisma 6 | Prisma 6 | Prisma 6 |
| Database | PostgreSQL with pgvector for RAG | PostgreSQL | PostgreSQL |
| Validation | Zod | Zod | Joi plus route/service validation |
| UI | Tailwind CSS 4, Radix primitives, `@eduai/ui` | Tailwind CSS 4, Radix, `@eduai/ui` | Tailwind CSS 4, Radix, `@eduai/ui` |
| AI | Vercel AI SDK, hosted/local providers, RAG | Core-backed tutor/supervisor loop | Core-backed generation/review plus configured providers |
| Tests | Vitest, Testing Library, integration suites | Vitest, Testing Library, Supertest | Vitest, Testing Library, Supertest |
| Delivery | Docker Compose, Apache reverse proxy, systemd/Node services | Same platform topology | Same platform topology |

The repository pins npm through `packageManager` and currently expects npm
workspaces rather than pnpm or Yarn. Check the root and app `package.json` files
before assuming every workspace uses the same major version of React Router,
Vite, or Express.

## Request and trust boundaries

### Authentication

Core is the only identity provider.

1. The browser signs in through Core.
2. Core sets the shared Better Auth session cookie.
3. An extension forwards the raw incoming `Cookie` header to
   `POST /api/sessions/validate`.
4. Core returns the user identity and platform role.
5. The extension resolves product and course permissions.

Do not add local login, registration, password, or token issuance to an
extension. Do not parse and rebuild the cookie before forwarding it.

For user-scoped calls from an extension to Core, forward the user's cookie. For
background or infrastructure calls, use `Authorization: Bearer
<EDUAI_API_KEY>`. The same `EDUAI_API_KEY` must be configured in Core, AI Tutor,
and Question Maker.

Read [Extension onboarding](EXTENSION_ONBOARDING.md) before adding or changing an
extension.

### Roles and course access

Platform roles are `STUDENT`, `INSTRUCTOR`, `UNIT_ADMIN`, and `ADMIN`. TA is a
course enrollment role, so a TA can still have platform role `STUDENT`.

Never authorize only from:

- a visible or hidden frontend control;
- a platform role when the operation is course-scoped;
- a client-supplied `courseId`, `role`, owner, department, or `proxyUser`;
- a local extension record without confirming its Core relationship where the
  operation depends on Core authority.

Apply authorization in the backend route/service and reuse the app's existing
course-access resolver. Frontend permission helpers are for consistent UX, not
the security boundary.

The repository's actor use cases are valuable implementation and adversarial
test inputs:

- [Core actor scenarios](use-cases/core/)
- [AI Tutor actor scenarios](use-cases/ai-tutor/)
- [Question Maker actor scenarios](use-cases/qm/)
- [Scenario format and contribution rules](use-cases/README.md)

They cover happy paths, recovery, malformed use, and adversarial behavior. The
Question Maker scenarios also identify authorization gaps. Treat every scenario
marked `[BUG]` as a defect to fix and regression-test, not as a contract to
preserve.

## Local development

From the repository root:

```bash
npm install
npm run dev
```

`npm install` runs `scripts/setup-env.js`, which copies example env files only
when the destination does not already exist. `npm run dev` starts the
development databases and runs workspace dev tasks through Turborepo.

On the first run, Core and AI Tutor seed development data. To seed all products
explicitly:

```bash
npm run dbseed
```

Common commands:

```bash
npm run build
npm run lint
npm run test
npm run test:coverage
npm run test:e2e
npm run docker:dev:db:logs
npm run docker:dev:db:down
```

Use workspace-specific commands while iterating:

```bash
npm run typecheck -w edu-ai
npm run test:unit -w edu-ai
npm run test:integration -w ai-tutor-server
npm run test -w question-maker-backend
```

Exact commands and coverage expectations live in [README.md](../README.md) and
[TESTS.md](../TESTS.md).

### Environment configuration

Start with [Environment variables](ENVIRONMENT.md). Do not commit `.env` files
or real credentials.

Important cross-service values include:

- `EDUAI_API_KEY` — identical shared service key across all three products.
- `CORE_URL` / `EDUAI_API_URL` — Core endpoint used by extensions.
- `QM_BACKEND_URL` and `AI_TUTOR_SERVER_URL` — Core callbacks for best-effort
  cascade deletion.
- database URLs — separate product databases in development.
- Better Auth secrets and trusted origins — owned by Core.
- provider and embedding credentials — configure only for the providers being
  exercised.

Vite `VITE_*` variables are build-time values. Restart the dev server after
changing them and rebuild for deployment.

## Codebase conventions

### Make the smallest correctly placed change

- Cross-product UI belongs in `packages/ui`; app-specific behavior stays in its
  application.
- Shared role/enrollment types belong in `packages/types`.
- Core-wide architecture and operations docs belong in `docs/`; app-specific
  design notes belong beside the app.
- Route handlers should delegate substantial database/business logic to the
  existing `lib`, `service`, or model layer.
- Use each app's established Prisma schema, client, and migration workflow.

### UI and navigation

- Reuse `@eduai/ui` and the established `AppShell`, sidebar, page-tab,
  command-palette, feedback, and form components before creating a local copy.
- Keep navigation and visibility derived from the existing RBAC helpers.
- A frontend permission gate must have a matching server-side authorization
  check.
- Preserve keyboard navigation, focus states, labels, responsive behavior, and
  assistive-mode hooks.
- Put user-facing actions where the other products put the equivalent action
  unless the workflow needs a product-specific exception.

### Validation and API behavior

- Validate at the request boundary using the library already used by the app.
- Return `401` for a missing or invalid identity and `403` for an authenticated
  user without permission.
- **Known gap:** AI Tutor and Question Maker currently also return `401` when
  Core cannot be reached for session validation because their auth middleware
  collapses fetch failures into the same response. Clients can consequently
  redirect to login during a Core outage. Preserve this behavior in
  documentation and tests until the middleware is intentionally changed to a
  distinct `503` contract.
- Verify identifiers against the authenticated actor's resolved course access.
- Prefer explicit response shapes and shared mapping functions at
  frontend/backend seams.
- Keep service-key operations narrowly scoped. Possession of the shared key is
  not proof of an end user's role.

### Data and migrations

- Commit schema changes and their migration together.
- Make seed changes idempotent; normal restarts should not duplicate data.
- Update fixtures and integration tests when a schema or default changes.
- Preserve Core IDs as cross-product anchors and follow the live read-through
  rules described in [Architecture](ARCHITECTURE.md).
- Treat cascade deletes as best-effort distributed operations: make handlers
  authenticated, idempotent, and safe to retry.

### Logging and privacy

Use the existing structured logging and audit helpers. Do not log session
cookies, passwords, provider keys, bearer tokens, full student submissions, or
chat contents unless a documented, reviewed workflow explicitly requires the
content. Read [Logging](LOGGING.md) before changing audit/security events or
retention.

### Style and formatting

- Follow the formatting already used in the file you edit.
- Core and shared TypeScript use their existing TypeScript/Vitest setup.
- AI Tutor exposes `oxlint` and `oxfmt` scripts.
- Question Maker uses ESLint in both frontend and backend.
- Keep imports, aliases, quote style, and semicolon style consistent with the
  owning workspace; the repository is not fully uniform across products.
- Use Conventional Commit-style subjects where practical, for example
  `feat(core): ...`, `fix(qm): ...`, or `docs: ...`.

Do not run a repo-wide formatter for a localized change.

## Testing expectations

Choose tests according to the changed boundary:

| Change | Minimum useful verification |
| --- | --- |
| Pure function or component | Unit test in the owning workspace |
| API route, auth, RBAC, or database behavior | Integration test plus focused unit tests |
| Shared UI/type package | Package tests and affected consumer checks |
| Cross-app auth, navigation, or course workflow | Full-platform E2E test |
| Schema/migration | Migration against a clean DB plus affected integration tests |
| Documentation only | Link/path/command review; no application test required unless docs generation is involved |

Run the narrowest relevant suite while iterating, then the broader affected
workspace suite. Security and RBAC fixes should include a negative test proving
the unauthorized path is rejected.

When adding or moving tests, update [TESTS.md](../TESTS.md), which is the
canonical test inventory and policy document.

## Where to make common changes

| Task | Start here |
| --- | --- |
| Core route/page | `apps/core/app/routes/` |
| Core auth/RBAC | `apps/core/app/lib/auth/`, `apps/core/app/lib/rbac/` |
| Core course logic | `apps/core/app/lib/courses/` |
| Core chat/RAG | `apps/core/app/routes/api/chat.ts`, `apps/core/app/lib/ai/`, `docs/rag-ai/` |
| Core database | `apps/core/prisma/` |
| AI Tutor routes/UI | `apps/extensions/ai-tutor/app/routes/`, `app/components/` |
| AI Tutor API | `apps/extensions/ai-tutor/server/src/` |
| AI Tutor database | `apps/extensions/ai-tutor/server/prisma/` |
| Question Maker UI | `apps/extensions/question-maker/app/frontend/src/` |
| Question Maker API | `apps/extensions/question-maker/app/backend/src/` |
| Question Maker database | `apps/extensions/question-maker/app/backend/prisma/`, `apps/extensions/question-maker/app/backend/scripts/` |
| Shared UI | `packages/ui/` |
| Shared roles | `packages/types/` |
| Full-platform E2E | `tests/e2e/` |
| Deployment/operations | `docs/DEPLOYMENT.md`, `infra/` |

## Documentation map

Read the documents relevant to the subsystem before implementation:

| Document | Use it for |
| --- | --- |
| [User guide](USER_GUIDE.md) | Product vocabulary and supported user workflows |
| [Actor use cases](use-cases/README.md) | Technically traced expected, failure, misuse, and security scenarios by product and role |
| [Architecture](ARCHITECTURE.md) | System topology, RAG flow, codebase walkthrough, RBAC, and extension data flow |
| [Environment variables](ENVIRONMENT.md) | Complete env-file and variable reference |
| [Extension onboarding](EXTENSION_ONBOARDING.md) | Core session validation, role enforcement, API calls, and app registration |
| [Deployment](DEPLOYMENT.md) | Development/production topology, reverse proxy, TLS, cookies, and CORS |
| [Logging](LOGGING.md) | Audit/security/system logs, privacy, access, and retention |
| [Cron jobs](CRON_JOBS.md) | Job registry, schedules, manual triggering, and operations |
| [Canvas](CANVAS.md) | Local Canvas setup and integration prerequisites |
| [RAG/AI index](rag-ai/README.md) | Chat, embeddings, model routing, latency, and local inference |
| [AI Tutor architecture](../apps/extensions/ai-tutor/docs/ARCHITECTURE.md) | Tutor/supervisor loop, auth, data model, and coupling seams |
| [Question Maker developer guide](../apps/extensions/question-maker/docs/DEVELOPER_GUIDE.md) | QM architecture and product flow code pointers |
| [Question Maker architecture](../apps/extensions/question-maker/docs/ARCHITECTURE.md) | QM runtime, containers, networking, and deployment |
| [Test inventory](../TESTS.md) | Test policy, commands, and file-by-file inventory |
| [Changelog](../CHANGELOG.md) | Shipped changes across all products |

Planning and implementation notes under `docs/implementations/` can explain why
a design exists, but verify their status against the current code before using
them as a contract.

## Change checklist

Before opening a pull request:

1. Trace the real request/data path and identify the owning product.
2. Confirm the auth and course-access boundary.
3. Reuse shared types and UI where appropriate.
4. Add validation and negative authorization cases.
5. Add or update focused tests and run the affected suites.
6. Update `TESTS.md` when the test inventory changes.
7. Update `CHANGELOG.md` for a user-visible or operationally significant change.
8. Update `README.md`, env examples, and subsystem docs when setup, behavior, or
   configuration changes.
9. Verify every path, function name, route, and command cited in documentation.
10. Review logs, errors, screenshots, fixtures, and commits for secrets or
    personal data.
