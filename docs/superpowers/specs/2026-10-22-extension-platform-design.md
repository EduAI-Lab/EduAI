# Extension platform: template and integration plan (#2000)

**Date:** 2026-10-22 · **Status:** revised proposal; planning only.

**Verified baseline:** `8741d6d70` (`origin/development`); `origin/main` was `b5de3921d`. Both include #2040.

**Issue:** [#2000](https://github.com/EduAI-Lab/EduAI/issues/2000), epic #1731. [Review decisions and evidence](../../implementations/extension-platform-review.md).

## Recommendation

Provide a working target for already-built honours projects: a shared React shell, a small server SDK, and a language-neutral HTTP contract. Core owns shared services/data; extensions retain their domain logic and databases. A validated registry drives discovery and tooling; independently managed scoped credentials control authorization.

Recommend porting inside EduAI with early, small PRs. Keep all three options below for the professor. Ship one complete integration path before expanding the template. This document proposes architecture and delivery order; it does not authorize implementation or deployment.

## What exists, and what changes

| Current code | Required change |
|---|---|
| Core provides identity, courses, topics, enrollments, questions/banks and AI APIs. Extensions already use HTTP and `@eduai/ui`. | Publish a precise supported API contract and runnable UI/server template. |
| Launcher types, bug sources, callbacks, CI, Docker and operational scripts name existing apps. | Register extensions once and drive the supported integration profile from that record. |
| `example-extension` is a minimal Express auth demo. Existing clients differ in auth/persistence behavior. | Build a thin SDK around agreed contracts; it is not simply identical code extracted from existing apps. |
| #2040 provides personal `x-api-key` grants; non-admin grants reach completion only. Extensions use a separate shared Bearer key. | Introduce extension identities without turning student accounts into service accounts. |
| Deletion callbacks are best-effort; existing extensions have reconciliation jobs. | New extensions need reliable delivery and idempotent handling. |

There is no useful verified fixed count of files every project must edit. The acceptance test below replaces the earlier “35 files” claim.

## A. Shared architecture

### A1. Integration registry, separate operator permissions

Add `config/extensions.json`, validated by a tooling schema, with a typed **public projection** consumed through `@eduai/types`. Each entry describes:

- Identity/UI: stable ID, name, description, icon/theme tokens, visible roles and public URL configuration.
- Build profile: source path, workspaces, build/test commands, artifacts and development ports.
- Lifecycle/operations: callback and health configuration, deployment profile, database/backup configuration references and responsible team.

Only UI fields reach browser bundles. Secrets, private URLs and host topology do not. Operator-owned server configuration separately grants keys, scopes, expiry, model access and budgets; editing a registry entry cannot grant access.

| Required consumer | Behavior |
|---|---|
| Launcher and all three app adapters | Derive app IDs/links; preserve `coreCourseId`, role visibility and existing env names. Visibility never grants API access. |
| Bug reports | Generalize extension identity in storage, validation and admin filters; preserve historical reports and bind source to authenticated extension. |
| Lifecycle | Discover configured callback targets and separate outbound credentials. |
| Local setup, workspaces, Docker and PR CI | Discover the standard layout/tasks; run changed-extension checks plus contracts, expanding for shared changes. Preserve legacy layouts through adapters. |
| Deployment and backup | Generate/reuse reviewed host templates; validate ports, health, permissions, env references and backup inclusion. Provisioning remains an operator action. |

Do not derive Core navigation permissions from app IDs or blindly replace Core's `db:seed` with `seed`. Marketing pages and unrelated app-specific features stay outside the registry.

**Acceptance:** generate a disposable fourth extension and prove install, build, dev DB, PR checks, launcher, bug report, lifecycle, deployment preflight and backup discovery work without handwritten shared-consumer edits. This guarantee applies to the tested layout/deployment profile. A new language or hosting profile needs an explicit adapter.

### A2. Scoped extension identity

For v1 use operator-managed high-entropy keys, identified by `extensionId` and `keyId`, with expiry, enabled status and permissions. Core holds hashes where practical; extensions hold their own raw secret. Removal/rotation requires a documented Core reload/restart. Persistent key administration and immediate revocation can follow when needed.

Preserve personal `x-api-key` behavior. Retain legacy `EDUAI_API_KEY` for existing apps/internal callers during an explicit migration; never issue it to a new project. Each new extension's Core-bound key and Core-to-extension callback secret are different credentials.

Resolve credentials once at the request boundary into an **extension caller** and, where present, a **user actor**. Update root middleware, session validation and route authorization together:

- Every extension-key request, including reads and cookie-bearing calls, checks a default-deny method/path policy. Invalid, expired or under-scoped credentials cannot fall back to cookie access.
- Key plus cookie requires **both** extension permission and existing user course/role permission. Bearer presence must not select unrestricted service behavior.
- Only an authorized API operation may use the server-call CSRF bypass. Account/auth/admin routes are outside the extension contract.
- Completion gets per-extension request/token budgets, concurrency limits and approved models. Reuse admission/accounting primitives where appropriate; do not inherit personal-grant limits accidentally.
- Record extension/key ID, optional actor ID, route template, outcome, latency and AI usage. Redact cookies, keys and bodies. Existing `api_request_logs` requires human `userId`; use dedicated extension usage records. Aggregate successful session checks and retain denial/error signals.

This is a new authorization path, not an env-only migration for AI Tutor/QM.

### A3. Initial API contract

These are **proposed extension permissions**, not claims that every existing route already implements them. The API reference must map exact methods/paths, schemas, pagination/errors, user requirements and course checks.

| Capability | Initial contract |
|---|---|
| `sessions:validate` | `POST /api/sessions/validate`; key plus user cookie; return Core identity/authorized units. |
| `courses:read`, `topics:read`, `enrollments:read` | Existing course/list/topic/roster GET routes; cookie plus existing course permissions and response filtering. No anonymous roster access. |
| `models:read`, `completion` | `GET /api/models`, `POST /api/completion`; approved model projection and extension budgets. Completion without a user is allowed for approved project jobs. Support actual streaming/cancellation contracts. |
| `policies:read` | `GET /api/policies`; explicitly projected public feature values, not arbitrary operator settings. |
| `bug-reports:write` | `POST /api/bug-reports`; key plus cookie in the template; reporter from session, source from extension identity. |
| `questions:read/write`, `banks:read/write` | Existing question/bank routes mapped by method; opt-in scopes, cookie and existing course/role/answer-visibility rules. |
| Course RAG/chat, materials, background roster sync | Unavailable through v1 extension keys. Add for a concrete project with permissions and tests. |

Unknown methods/routes deny access. Discovery uses `/api/models`, not admin `/api/ai-models`. Personal completion grants do not currently grant discovery or full extension integration.

### A4. Small SDK and reliable lifecycle

Add `packages/extension-sdk` with built JavaScript/types for the template's Express server: explicit delegated/service requests, session validation, deadlines, cancellation, pagination helpers, error mapping, redacted logging and an injectable callback handler. Contract-test against real Core routes. Build artifacts through workspace/Docker dependencies; no requirement to commit generated output.

Avoid domain synchronization, automatic local users and an exhaustive API wrapper. Preserve `401`, `403`, `429` and Core-unavailable distinctions; outages must not become login loops. Existing apps may adopt the SDK later.

For new extensions, persist course-deletion deliveries in a small Core outbox in the same transaction as soft deletion. A scheduled worker retries with backoff, bounded concurrency and separate callback secrets; receivers acknowledge duplicates safely. Alert after 24 hours pending, retain unacknowledged deliveries until resolved or explicitly cancelled at decommission, and remove acknowledged records after 30 days.

Include event ID and a monotonically increasing Core lifecycle version, updated transactionally on deletion and restore. Authorized live course reads return that version; pointer reactivation persists it atomically. Callback processing compares versions under the same per-course lock/transaction, so a delayed older deletion cannot archive a reactivated pointer. Test that race explicitly; also check for superseding restores before retrying delivery.

The template archives linked data reversibly; permanent purge follows declared retention. Authorized live re-access after a Core restore reactivates the pointer. Existing AI Tutor/QM reconciliation remains intact during migration. Never infer deletion from user-scoped `403`/`404`, timeout or outage.

### A5. Ownership and promotion

Core owns identity, roles, courses, enrollments, topics, shared materials/RAG, models/completion, questions/banks, Canvas and platform policy/audit. Extensions retain domain behavior/data referencing Core IDs.

At intake classify each feature/model:

1. Core already owns it: use its API; retain necessary pointers or documented bounded caches.
2. Shared course/learner functionality has a concrete second consumer: propose promotion to Core.
3. Otherwise keep it local and revisit when another consumer appears.

Promotion recipe: agree ownership/API → Core schema/migration and domain service → authorized API/contracts → types/client support → maintainer-run restartable migration with validation/rollback → pointer/API cutover → retire duplicate writes. Students may author promotion PRs; maintainers review Core changes and run migration tools with temporary credentials. Extension runtime never receives Core DB/encryption secrets.

Promotions run alongside the port. Agreed fixtures unblock UI/domain work; affected features cannot go live before the real API/migration passes. CI prohibits imports from `apps/core`; semantic ownership remains reviewed intake documentation. Model-name matching cannot reliably detect copied data. Existing mirrors are recorded debt, not a forced rewrite.

## B. What project owners receive

The Node template uses `web/` and `server/`: React Router SPA, Vite, Tailwind and `@eduai/ui`; Express with its own Prisma/Postgres database. Demonstrate one complete flow:

1. Core login → shared shell/launcher → authorized course selection.
2. One domain record and course-authorized operation; an instructor-only state demonstrates role checks.
3. Model discovery/completion, streaming, cancellation, denied access and inference-unavailable states.
4. Standard theme, bug reporting, loading/error/empty states and recoverable deletion handling.

Provide a component reference and porting table: replace own login with Core, copied shared data with pointers/APIs, direct AI calls with Core, and adapt screens to the shared shell while retaining domain logic. Avoid six speculative demo pages.

Ship `dev:ext <id>`, repeatable setup/seed commands, supported build/test tasks, a secret-free env example, HTTP reference and first-day guide. Local Core supplies identity/persistence; inference requires separately authorized connectivity. Clearly marked fixtures support offline UI work. Verify one real authorized campus-model completion before acceptance.

Non-Node backends may retain their language/ORM when they pass the same HTTP/auth/data/lifecycle checks. Publish that contract now; build a reference adapter/CI profile when an actual intake requires it. The proposed frontend requirement remains React plus `@eduai/ui` under every option.

## C. Professor's choice: where teams port

| | 1. Inside EduAI — recommended | 2. Own repo, released packages | 3. Own repo, contract/design docs |
|---|---|---|---|
| Student benefit | Actual Core/packages; early feedback; no later repo move. | Smaller repo, independent history/cadence, shared packages. | Least initial disruption; retain backend/domain code. |
| Student cost | Learn setup/review rules and update upstream. | Track supported package/Core versions; set up integration environment. | Maintain adapters and assemble shared frontend; later integration discoveries. |
| Maintainer benefit | No publishing pipeline; small upstream PRs expose issues early. | Clear package boundaries, independent iteration. | Least initial tooling; common Core foundation still applies. |
| Maintainer cost | Onboarding, review and repo-access decisions. | Package releases, standalone template and compatibility checks. | More stack variation/manual integration review. |
| Extra work | Protected review, authorized branches or forks, working local/PR profile. | Release UI/types/SDK; pinned real Core environment with seeds/migrations; optional UI fixtures. | HTTP examples, design/component guidance and explicit packaging/CI adapter at integration. |

Option 1 means early draft PRs and incremental merges, not a final term-end PR. Branches require authorized access; forks remain valid. CODEOWNERS routes review and needs enforced protected-branch approval. It does not prevent edits or authorize deployment. Record original repo/commit and preserve attribution/grading evidence.

Option 2 does not inherently require a later repo move; the professor decides whether final code must join EduAI or may remain independently versioned. Option 3 does not promise arbitrary frontend compatibility: adopting the required shell early avoids rework. No option eliminates drift or guarantees CI on every push.

## D. Intake and deployment

Assign a student lead, Core reviewer and operations owner. Record option, original repo, models/screens/APIs, data handling/retention, required permissions, promotion dependencies and agreed review dates in `docs/extensions/<id>/intake.md`. Schedule a working auth/course/completion demonstration early.

Before a new extension handles real users/data:

- Deploy a reviewed, reproducible release under maintainer-controlled deployment. Shared-domain cookies expose Core sessions to extension servers; scopes cannot contain a malicious server replaying a cookie without its key. Independently controlled/untrusted deployments require host-only Core sessions and audience-bound delegation first, as a separate design.
- Use its own Unix identity/group, DB role and restricted filesystem permissions. Verify it cannot read Core/other-extension env files or access their DBs; changing only `User=` is insufficient. No Core DB/encryption secrets in its env. Separate development session configuration from production.
- Verify redaction, key expiry/rotation, course authorization, backup/restore, deletion recovery, health and rollback. Validate every enabled callback URL.
- Record approved data use/storage, learner-data deletion and decommission procedures. Use normal institutional approval processes; the template does not grant research/data authorization.

Repository templates share service users/groups and include Core secrets in QM configuration. These are **repository findings, not a live-server audit**. New deployments must pass isolation checks; existing-app remediation is separate. Missing `QM_BACKEND_URL` in the Core env example proves a template gap, not a production callback failure.

## E. Delivery order and acceptance

Each row is a bounded review milestone; split migrations/tooling into smaller PRs as needed. Sizes are relative, not delivery promises.

| Order | Deliverable | Dependency and acceptance |
|---|---|---|
| 1 · S | Ownership/intake rules and exact HTTP permission matrix | Agree actor, method/path, data/error contracts; preserve professor options. |
| 2 · L | Extension principal, enforcement, budgets/usage and isolated deployment profile | After 1. Test invalid/expired keys, insufficient scope with valid cookie, cross-course denial, personal/legacy compatibility, cancellation/limits and effective isolation. |
| 3 · M–L | Registry, launcher, bug identities and deletion outbox | After identity contract in 1–2. Test fourth app, historical reports/source spoofing, callback failure/restart/duplicates/restore and stalled delivery. |
| 4 · M | Thin SDK and one complete template | After 2–3. Real-Core contracts and browser login/course/domain/AI flow, including outage/denial. Retain old demo until replacement passes. |
| 5 · M–L | Repeatable scaffold/dev/CI/build/ops profile and pilot port | After 4. Pass generated-fourth-extension test, backup restore and real model call; retain existing app checks. Option 2/3 tooling only if selected. |

Work may overlap after contracts agree. No live template deployment precedes authorization/isolation. Extension-only PRs run the extension plus contracts; shared changes expand to affected existing apps.

**Deferred:** full domain SDK, existing-app SDK/key migration, automatic arbitrary-schema promotion, full mock Core, publishing before option 2 is selected, universal non-Node scaffolding. Federation is a prerequisite for deployments that cannot be trusted with Core cookies.

## Decisions still needed

1. Professor chooses option 1, 2 or 3, including whether final code joins the monorepo.
2. Name the pilot and backend stack; this determines whether a non-Node adapter belongs in the first delivery.
3. Confirm maintainer-controlled trusted deployment for the pilot; otherwise federation becomes a prerequisite.
