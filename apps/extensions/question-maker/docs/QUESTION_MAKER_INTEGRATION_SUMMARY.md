## Question Maker Codebase Summary

Full-stack assessment and question-authoring product with AI-assisted generation, OCR extraction, Canvas LMS import/export, and structured variant assembly workflows.

Question Maker can remain in a **separate repository** and **separate stack** (Express.js + React).  
Integration is expected to be **API-first** through EduAI Core's centralized contracts, not a forced monorepo or full route-level rewrite.

### High-Level Stats

- **Primary apps**: 2 (frontend + backend)
- **Backend route domains**: 8
- **Core data models**: 11
- **Test files**: 55+

### Architecture At A Glance

**Integration position:** Question Maker and EduAI Core can safely use different tech stacks (Docker/no-Docker, React app structure, ORM choice).  
For this project, the primary success factor is robust communication between repos: stable API contracts, consistent auth/roles, and strong cross-repo testing.


| **Layer**                 | **Current Implementation**                                 | **Notes**                                                     |
| ------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| **Frontend**              | React 19 + Vite + React Router 7                           | SPA with context-based state and Axios API layer              |
| **Backend**               | Node 18 + Express (ESM)                                    | Dedicated REST API with service-oriented modules              |
| **Data**                  | PostgreSQL + Sequelize                                     | Association-heavy schema for questions, variants, assessments |
| **Infra**                 | Docker Compose (dev/prod) + Apache/Nginx (deployment docs) | Container-first deployment path                               |
| **External Integrations** | EduAI API + Canvas LMS API                                 | EduAI for models/course data, Canvas for quiz import/export   |


### Business-Critical Product Flows


| **Flow**                               | **Primary Backend Surface**                              | **Primary Frontend Surface**                 |
| -------------------------------------- | -------------------------------------------------------- | -------------------------------------------- |
| **Auth and user bootstrap**            | `/api/auth`                                              | Login page + Auth context                    |
| **Course and topic management**        | `/api/course` + `/api/eduai/courses`*                    | Course selection + profile course dialogs    |
| **Question bank CRUD + AI generation** | `/api/questions` + `/api/eduai/generate-questions`       | Homepage question bank + detail views        |
| **OCR extraction and save**            | `/api/questions/extract` + `/api/questions/extract/save` | Upload dialog + review/approve workflow      |
| **Assessment and section builder**     | `/api/assessments`                                       | Assessment builder page + section components |
| **Variant workflows ( exam assembly)** | `/api/assessment-variant`                                | `AssessmentVariant` page + workflow panel    |
| **Canvas LMS integration**             | `/api/canvas`                                            | Canvas export/import dialogs                 |
| **Bug report triage**                  | `/api/bug-reports`                                       | Global bug-report modal + admin page         |


### Integration Fit: Question Maker vs Edu AI Core Learning


| **Dimension**        | **Question Maker (Current)**                     | **Edu AI Core Learning (Target)**               | **Integration Implication**                                             |
| -------------------- | ------------------------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------- |
| **Web framework**    | Client-rendered React app + separate Express API | React Router 7 full-stack routes                | Keep separate stacks; integrate via centralized API contracts           |
| **ORM and schema**   | Sequelize models/associations                    | Prisma schema and migrations                    | Prioritize owned-vs-hosted data boundaries over direct ORM unification  |
| **Auth model**       | JWT bearer token + `localStorage` token handling | Better Auth session model + role guards         | Refactor auth checks from middleware to session-first guards            |
| **Deployment model** | Docker Compose-centric docs and CI checks        | No-Docker expected runtime                      | Replace compose startup assumptions with native process/db scripts      |
| **API style**        | REST endpoints grouped by domain                 | Route-based API handlers under `app/routes/api` | Contract-first integration with stubs + versioned extension-facing APIs |


**Top integration risks**: contract drift between teams, auth/role semantic mismatch, and hidden runtime assumptions (Docker/env/startup behavior).

### Most Challenging Integration Areas

This section focuses on the highest-risk technical workstreams and what must be true for a safe **cross-repo** integration.

- **Auth model conversion (JWT to Better Auth sessions)**
  - Question Maker assumes bearer-token middleware and client token storage, while Edu AI is session/guard-oriented. Permission checks and identity propagation will need a careful rewrite.
    - **Why this is hard**: people will sign in through a different identity flow, and that change touches every protected feature.
    - **What can go wrong**: users appear logged in but lose access unexpectedly, or roles (Instructor/TA/Student) are interpreted differently between systems.
    - **What success looks like**: users sign in once, see the correct courses and permissions, and never notice that two repos are involved.
- **API contract discipline across repos**
  - **API contract discipline across repos**: With separate deployables, stability depends on strict contract-first development, stub parity, and versioning/deprecation policy.
    - **Why this is hard**: with separate repos, one team can change an endpoint and accidentally break another team’s app without seeing it locally.
    - **What can go wrong**: small response changes (field names, required inputs, error messages) cause integration breakage late in the sprint.
    - **What success looks like**: both teams build against the same documented contract, and updates are versioned and announced before rollout.
- **Test strategy alignment**
  - **Test strategy alignment**: Question Maker has meaningful backend integration tests and frontend tests, but cross-repo integration needs shared API contract tests plus end-to-end regression suites.
    - **Why this is hard**: each repo may have good internal tests, but integration issues happen in the gaps between systems.
    - **What can go wrong**: both repos are “green” independently, yet end-to-end flows fail in real usage.
    - **What success looks like**: there are shared cross-repo tests for critical journeys (login, course sync, generation, assessment workflows), and they run continuously.

### Shared Data Ownership Decisions


| **Area**                                                  | **Decision**                      | **Owner / Source of Truth**                     | **Notes**                                                                          |
| --------------------------------------------------------- | --------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| **1. User identity and roles**                            | Core-owned                        | EduAI Core                                      | Question Maker consumes identity/role via centralized auth/API.                    |
| **2. Courses, enrollment, membership**                    | Core-owned                        | EduAI Core                                      | Course shells, ownership, enrollment, and role mapping come from Core.             |
| **3. Question bank data**                                 | Question Maker-owned              | Question Maker                                  | Core may read through API, but write authority stays in Question Maker.            |
| **4. Assessment artifacts (sections/variants/workflows)** | Question Maker-owned              | Question Maker                                  | Includes assembly metadata and variant workflow state.                             |
| **5. Canvas integration ownership**                       | TBD (likely Question Maker-owned) | TBD                                             | Working assumption: Question Maker-owned unless Core team requires centralization. |
| **6. Model/generation orchestration policy**              | Core policy, extension as client  | EduAI Core policy + Question Maker client calls | Question Maker should call Core-managed model selection/generation APIs.           |
| **8. Conflict resolution**                                | Core wins for shared entities     | EduAI Core                                      | Target state should avoid dual-writes to minimize conflict occurrence.             |
| **9. Core API outage behavior**                           | Already implemented               | Question Maker                                  | Existing degraded/fallback behavior remains valid.                                 |
| **10. Existing Question Maker data migration**            | DB can be reset                   | Greenfield cutover recommended                  | No legacy user data constraints.                                                   |


### Entity-Level Write Boundaries


| **Entity Domain**                                 | **Question Maker Write Access**   | **Core Write Access**     | **Recommended Policy**                                                    |
| ------------------------------------------------- | --------------------------------- | ------------------------- | ------------------------------------------------------------------------- |
| **Users / roles / auth state**                    | No                                | Yes                       | Question Maker never writes these; read via Core API/session context.     |
| **Courses / enrollment / course ownership**       | No (except local cache if needed) | Yes                       | Treat Core as authoritative; Question Maker refreshes from Core.          |
| **Questions / variants / assessment sections**    | Yes                               | No direct writes to QM DB | Question Maker remains owner of authoring and assessment generation data. |
| **Shared metadata references (courseId, userId)** | Reference-only                    | Yes                       | Use immutable IDs from Core; no remapping in Question Maker.              |
| **Canvas credential + sync state**                | TBD                               | TBD                       | Decide once with Core team; current likely direction is QM-owned.         |


### About wiping Question Maker database

Because there are no production users yet, the lowest-risk path is a **greenfield integration cutover**:

1. Freeze API contracts first (auth, course/enrollment, model/generation, shared references).
2. Wipe Question Maker DB and reseed with schema aligned to finalized ownership boundaries.
3. Remove legacy auth assumptions (token-local first behavior) and bind to Core identity flow.
4. Reconnect Question Maker workflows using Core IDs (`userId`, `courseId`) from day one.
5. Validate end-to-end with contract tests and a pilot rehearsal dataset.

This avoids costly backfill/migration scripts and reduces hidden compatibility debt before pilot onboarding.

### Suggested Integration Phases (Separate Repos)


| **Phase**                    | **Goal**                                                                | **Deliverable**                                            |
| ---------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------- |
| **1. Contract freeze**       | Define centralized extension-facing API contracts and role semantics    | Contract spec + executable contract tests                  |
| **2. Auth bridge**           | Replace extension-local auth assumptions with centralized identity flow | Session/CWL adapter + permission matrix tests              |
| **3. Shared data wiring**    | Route shared entities through core-owned APIs with explicit ownership   | Owned-vs-hosted matrix + integrated course/question flows  |
| **4. Extension hardening**   | Keep Express extension stable while switching to real core APIs         | Typed API client, retry/error standards, fallback behavior |
| **5. Operational alignment** | Coordinate separate deployments and release safety                      | Versioning policy, CI gates, and no-Docker runbooks        |


### Team Message

The repository is already modular by domain and has a strong functional split (`auth`, `questions`, `assessments`, `variants`, `canvas`, `bug-reports`). That modularity is favorable for incremental **API-first integration** with Edu AI Core Learning while keeping separate deployable repos.