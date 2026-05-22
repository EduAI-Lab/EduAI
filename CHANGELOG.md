# Changelog

All notable changes across the EduAI monorepo (AI Tutor, Question Maker, EduAI) are documented in this file.

> See [How to use this changelog](#how-to-use-this-changelog) at the bottom for entry format, categories, and the sprint template.

---

## [Week 3 — May 18–22, 2026]

### Added
- [core] feat: Add user-facing ADHD Assist toggle on `/chat` (Phase 1 plumbing only). New `Chat.adhdAssist Boolean @default(false)` column + migration `adhd_assist_toggle`; toggle persists per chat and restores on reload via `/api/chats/:chatId`. `adhdAssist` is parsed and stored by `POST /api/chat` but does not alter prompt, model, RAG, or tools — Phase 1 is the IV control before Phase 2 introduces the policy prepend. (#151, @Ayyhab, 2026-05-20)

---
- [monorepo] docs: Add `auth-pipeline-centralization-plan.md` — detailed plan for centralizing all extension auth through Core's OAuth/OIDC provider; covers current state audit (AI Tutor centralized, Question Maker standalone JWT), gap analysis, phased migration plan, auth contract, and AI Tutor as the reference implementation for QM. (#250, @evanbones, 2026-05-20)
- [monorepo] docs/tooling: Add `eduai-summer-2026/CONVENTIONS.md` — consolidated reference for issue format, git workflow, and PR checklist readable by any AI agent; add `.claude/commands/eduai-summer-2026/make-pr.md` — Claude Code `/project:eduai-summer-2026:make-pr` slash command that walks contributors through the PR checklist interactively; un-ignore `.claude/` in `.gitignore` so commands are team-shared. (#289, @ariqmuldi, 2026-05-21)
- [core] tests: Finished implementing all the tests inside of the `planned-core-tests.md`
- [monorepo] docs: Added docs/implementations/rbac-matrix.md (#198, @abdullahmoh21, 2026-05-21)
- [monorepo] docs: Add [`docs/rag-ai/`](docs/rag-ai/README.md) — index and team docs for EduAI chat/RAG ([`CHAT_RAG_PIPELINE.md`](docs/rag-ai/CHAT_RAG_PIPELINE.md)), shared dev server ([`HOW_TO_USE_DEV_SERVER.md`](docs/rag-ai/HOW_TO_USE_DEV_SERVER.md)), HelpMe gap analysis, **latency** sprint guides and measurement ledger ([#203](https://github.com/EduAI-Lab/EduAI/issues/203)), and **routing** Phase 0–1 guides ([#197](https://github.com/EduAI-Lab/EduAICore/issues/197)).
- [monorepo] docs: Populated `TESTS.md` with all integration and unit tests (#199, @GlowyBlack, 2026-05-18)
- [monorepo] infra: Add GitHub Actions CI workflow (`.github/workflows/pr-tests.yml`) — triggers on pull requests targeting `development` or `main`; spins up a PostgreSQL 16 service on port 54321; runs `npm run test` (Turborepo) to build and test all packages across the monorepo; `aitutor_test` database is created automatically by the existing `globalSetup.js`; `TEST_DATABASE_URL` is set at job level so question-maker backend integration tests run as part of the single test command. (#236, @evanbones, 2026-05-20)
- [question-maker] infra: Make `npm run test` run the full test suite — chain `vitest run --config vitest.integration.config.js` after the unit run so integration tests are no longer opt-in; `test:all` is kept as an alias. (#236, @evanbones, 2026-05-20)
- [monorepo] docs: Add [`docs/rag-ai/EMBEDDINGS.md`](docs/rag-ai/EMBEDDINGS.md) — embeddings and pgvector storage, server vs chat API keys, index/retrieval lifecycle, hosting, failures, and env vars (@superbolt08, 2026-05-21)

### Changed
- [monorepo] docs/tooling: Update `eduai-summer-2026/CONVENTIONS.md` and `.claude/commands/eduai-summer-2026/make-pr.md` — add assignee and week-label requirements to issue conventions; expand test conventions to cover unit, integration, and end-to-end tests; update make-pr skill to verify week labels on linked issues and determine applicable test types. (#PR, @ariqmuldi, 2026-05-22)
- [monorepo] docs: Move RAG-AI team docs from `docs/implementations/RAG-AI/` to [`docs/rag-ai/`](docs/rag-ai/README.md); normalize folder name and filenames (`CHAT_RAG_PIPELINE.md`, `HOW_TO_USE_DEV_SERVER.md`, summer-2026 subfolders); update root README, [`ARCHITECTURE.md`](docs/ARCHITECTURE.md), and cross-links.
- [monorepo] docs: Add chat/RAG pipeline section to [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) linking to [`CHAT_RAG_PIPELINE.md`](docs/rag-ai/CHAT_RAG_PIPELINE.md).
- [monorepo] docs: Extend root README Docs table with links to `docs/rag-ai/` and `implementations/schema-design.md`.
- [ai-tutor] infra: Renamed the `test/` `__test__` to `tests/` and added the tests within the `app/tests/` to the `TESTS.md` file and created a `.env.test.example` file. Added `.env.test` to gitignore (#199, @glowyblack, 2026-05-18)
- [monorepo] docs: Update [`docs/rag-ai/README.md`](docs/rag-ai/README.md) index and folder layout for `EMBEDDINGS.md`; cross-link [`CHAT_RAG_PIPELINE.md`](docs/rag-ai/CHAT_RAG_PIPELINE.md) and [`ARCHITECTURE.md`](docs/ARCHITECTURE.md) to the embeddings guide; extend root README Docs table (@superbolt08, 2026-05-21)

### Removed
- [monorepo] infra: Remove nested `package-lock.json` files from npm workspace packages (`ai-tutor`, `ai-tutor/server`, `question-maker/app/backend`) - holdovers from before the monorepo workspace setup that were not read by npm or Turborepo on root installs; add `apps/**/package-lock.json` to `.gitignore` to prevent accidental regeneration. (#268, @yta3216, 2026-05-20)

### Fixed
- [monorepo] docs: Remove stale `professorId` references from `docs/implementations/rbac-matrix.md` — the field no longer exists in the schema; rephrase the §1 instructor-linkage note and the §20 gap entries to refer to `Enrollment.role=INSTRUCTOR` instead. (@abdullahmoh21, 2026-05-22)
- [monorepo] infra: Fix `npm run dev` failing on restart — Docker orphaned containers from previous service renames (`eduai-core-db`, `eduai-tutor-db`, `eduai-qm-db`) held ports 54320–55432 and were not removed by `docker compose down`; overhaul `scripts/dev-db.sh` to force-remove any container bound to those ports and delete the stale `eduai-dev` network before starting fresh; add `--remove-orphans` to `docker:dev:db:down`. (#236, @evanbones, 2026-05-19)
- [question-maker] infra: Fix `vitest.integration.config.js` using wrong `test/` path instead of `tests/` — integration tests were never discovered and `test:all` always exited with code 1 (@ariqmuldi, 2026-05-20)
- [monorepo] docs: Corrected README paths, CHANGELOG structure, and removed redundant TESTS.md placeholder. (#329, @evanbones, 2026-05-22)

## [Week 2 — May 11–15, 2026]

### Added
- [monorepo] automation: Add GitHub-native weekly team time tracking and PR analytics reporting workflows, including issue-hours parsing, committed base-time fallback, editable weekly base-time issue override, Project timestamp filtering, Project item/PR linking, CSV/Markdown report generation, implementation documentation, and focused Node tests for the reporting scripts. (#176, @Whiteknight07, 2026-05-16)
- [monorepo] docs: Add `schema-design.md` in `docs/implementations/` — unified schema design (#177, @abdullahmoh21, 2026-05-16)
- [monorepo] docs: Added DEPLOYMENT.md in docs based on team decision (#157, @abdullahmoh21, 2026-05-15)
- [core] infra: Add unit tests for all functions in `lib/form-utils.ts` (`getFieldErrors`, `getFieldError`, `getFormErrorMessage`, `validateField`); set `pool: vmThreads` in `vitest.config.ts` to fix worker startup timeout on Windows. (#134, @glowyblack, 2026-05-13)
- [core] docs: Add `TEST.md` cataloguing all planned test cases for `lib/utils`, `lib/ai/providers`, `lib/ai/file-processing`, `lib/ai/embedding`, `lib/courses/schemas`, `lib/ai/schemas`, and form components (`LoginForm`, `RegisterForm`); assign test files across three contributors. (#134, @glowyblack, 2026-05-13)
- [monorepo] infra: Set up Turborepo to orchestrate build, dev, test, and lint across all workspace apps; add `apps/extensions/ai-tutor/server` to npm workspaces; configure distinct dev-server ports (core: 3000, ai-tutor: 3001, qm-frontend: 5173, qm-backend: 8000, ai-tutor server: 4000); add `predev` hook that auto-starts Docker Compose databases before Turborepo; add `postinstall` hook that copies each app's `.env.example` to `.env` on a clean clone; add `.npmrc` (`legacy-peer-deps=true`) to resolve cross-package peer dependency conflicts; change core-db default host port from 5432 to 54320 to avoid collision with locally installed Postgres. (#133, @evanbones, 2026-05-13)
- [monorepo] docs: Add `docs/DEPLOYMENT.md` with production topology and a Development Deployment guide for `dev.eduai.ok.ubc.ca` (SSH, tmux, branch switching, when to use the dev server vs local dev, Ollama). (#110, @superbolt08, 2026-05-12)
- [core] infra: Add `rhel-openssl-1.1.x` to Prisma `binaryTargets` so the query engine works on RHEL 8 hosts (e.g. `dev.eduai.ok.ubc.ca`). (#110, @superbolt08, 2026-05-12)
- [core] infra: Configure Vite for monorepo hoisting, Apache reverse proxy (`allowedHosts`, `fs.allow`), optional HMR over HTTPS (`DEV_SERVER_HMR_*`), and `better-auth` dedupe on the dev host. (#110, @superbolt08, 2026-05-12)
- [monorepo] docs: Add root `TESTS.md` as the canonical test inventory — defines structure, policy, and per-section table format for tracking all test files across the monorepo. (#140, @ariqmuldi, 2026-05-13)
- [monorepo] infra: Add root `package.json` with unified test runner. `npm test` at the root directory runs all unit tests across every app. (#119, @yta3216, 2026-05-12)
- [core] infra: Set up Vitest test infrastructure: add `vitest.config.ts`, `app/__tests__/setup.ts`, and `test`/`test:watch` scripts to `package.json`. No tests written yet; scaffolding only. (#119, @yta3216, 2026-05-12)- [core] docs: Add `TESTS.md` with planned test cases for lib utilities, AI providers, file processing, Zod schemas, and form components. (#119, @yta3216, 2026-05-12)

### Changed
- [monorepo] automation: Move summer 2026 team time reporting scripts, tests, base-time CSVs, generated reports, and documentation under `eduai-summer-2026/`; keep workflow entrypoints as prefixed files in `.github/workflows/` for GitHub Actions autodiscovery. (#176, @Whiteknight07, 2026-05-18)
- [core] docs: Renamed the planned test file for core from `TEST.md` to `planned-core-tests.md` and moved to docs to reflect the `README.md` and fix the conflict with the new `TEST.md` file that describes structure for all new tests. (#134, @glowyblack, 2026-05-14)
- [monorepo] docs: Move `TEST.md` from `apps/core/` to the monorepo root so it is visible alongside `CHANGELOG.md` and other top-level docs. (#134, @glowyblack, 2026-05-13)
- [core] infra: Rename test folder from `app/__tests__/` to `app/tests/` and reorganise test files into `app/tests/unit/`; update `vitest.config.ts` `include` and `setupFiles` paths accordingly. (#134, @glowyblack, 2026-05-13)
- [qm] infra: Complete migration of question-maker-backend and question-maker-frontend test suites from Jest to Vitest — update `package.json` test scripts to invoke `vitest run` using the existing `vitest.config.js` / `vitest.integration.config.js` configs; fix `@testing-library/jest-dom` setup to use explicit `expect.extend(matchers)` instead of the broken `/vitest` entry point; add `resolve.dedupe` to `vite.config.ts` to guard against future React version drift. (#137, @evanbones @abdullahmoh21, 2026-05-15)
- [monorepo] infra: Rename workspace packages — `edu-ai-core-learning` → `edu-ai`, `aitutor` → `ai-tutor`, `server` → `ai-tutor-server` — so Turborepo labels output as `edu-ai:dev`, `ai-tutor:dev`, `ai-tutor-server:dev`. (commit 93d9b46, @ariqmuldi, 2026-05-14)
- [monorepo] infra: Standardize Docker Compose project name, service names, volume names, and npm scripts — set project name to `eduai` so volumes are prefixed `eduai_`; rename services `core-db` → `eduai-db`, `tutor-db` → `ai-tutor-db`, `qm-db` → `question-maker-db`; rename volumes to `db_data`, `ai_tutor_db_data`, `question_maker_db_data`; rename scripts `docker:dev:db:core/tutor/qm` → `docker:dev:db:eduai/ai-tutor/question-maker`. (commit 523c7e2, @ariqmuldi, 2026-05-14)
- [monorepo] infra: Broaden Turbo test task `inputs` to cover `app/**`, `server/**`, `shared/**`, `test/**`, `vitest.config.*`, `jest.config.*`, `jest.integration.config.*`, `package.json`, `prisma/**`, and `tsconfig*.json` — previously narrow inputs caused stale cache hits after real test-affecting changes. (#133, @evanbones, 2026-05-14)
- [monorepo] docs: Update root README `npx turbo run` filter examples to use correct package names (`aitutor --filter=server`, quoted `'question-maker-*'` for zsh compatibility) and `npx turbo run test` syntax in the testing table. (#133, @evanbones, 2026-05-14)
- [monorepo] docs: Add Testing section to root README covering install prerequisites, all root-level test commands, integration test database requirements, and a per-app runner reference table. (#119, @yta3216, 2026-05-12)
- [ai-tutor] chore: Migrate package manager from Bun to npm — updated all scripts, dependencies, hooks, deploy tooling, and documentation to use npm throughout. (#118, @abdullahmoh21, 2026-05-12)

### Fixed
- [ai-tutor] fix: Replace ts-node with tsx in the server seed script — ts-node does not support ESM TypeScript (`"type": "module"`) without extra flags; tsx runs `.ts` files natively under Node ESM. Added TypeScript types to previously untyped seed helper functions. (#118, @abdullahmoh21, 2026-05-12)
- docs: Merge monorepo report information into platform centralization document. Changed section 12 to be a description of the monorepo architecture. (#107, @evanbones, 2026-05-11)
- [monorepo] infra: Rename Docker container names — `eduai-core-db` → `eduai-db`, `eduai-tutor-db` → `eduai-ai-tutor-db`, `eduai-qm-db` → `eduai-question-maker-db`; rename Postgres database names — `aitutor` → `ai-tutor`, `eduquery` → `question-maker`; update all `.env`, `.env.example`, and `.env.test` files accordingly. (#133, @evanbones, 2026-05-14)
- [monorepo] docs: Rename "EduAI Core" to "EduAI" across root README, CHANGELOG, apps/core README, and all docs — platform-centralization-architecture-plan.md, user-management-and-roles-architecture-plan.md, QUESTION_MAKER_INTEGRATION_SUMMARY.md. (#133, @evanbones, 2026-05-14)
- [monorepo] docs: Add database inspection section to root README — `docker exec` + psql workflow (`\c`, `\dt`, `SELECT * FROM`) and step-by-step DBeaver/pgAdmin connection guide for all three databases. (#133, @evanbones, 2026-05-14)
- [monorepo] infra: Rename root npm workspace package from `eduaicore-monorepo` to `eduai-monorepo`. (#133, @evanbones, 2026-05-14)
- [monorepo] docs: Mark user management and roles plan as on hold pending Canvas integration — current roles frozen, Canvas identified as source of truth for course structure, enrollments, and role assignments; rest of document preserved as original draft. (#115, @ariqmuldi, 2026-05-11)

### Removed
- [monorepo] infra: Remove duplicate Turbo task delegation from `apps/extensions/question-maker/package.json` — the parent workspace package was re-invoking turbo for `question-maker-frontend` and `question-maker-backend`, causing build and test tasks to run twice. (#133, @evanbones, 2026-05-14)
- docs: Removed old monorepo report since the information is now included in the centralization docs. (#107, @evanbones, 2026-05-11)

### Fixed
- [monorepo] infra: Run `prisma migrate deploy` automatically on dev start for `edu-ai` and `ai-tutor-server` — databases had no tables on a fresh clone because migrations were never applied before the dev server started. (commit 83bb75c + 1be5058, @ariqmuldi, 2026-05-14)
- [core] auth: Remove `apiKey` plugin from `app/lib/auth/server.ts` — not exported by `better-auth@1.2.8`, causing a runtime crash on every page load. (commit e797e15, @ariqmuldi, 2026-05-14)
- [question-maker] backend: Fix `DATABASE_URL` in `.env.example` — was pointing to non-existent database `question-maker` but Docker Compose created it as `eduquery`; corrected to match the compose config. (commit 523c7e2, @ariqmuldi, 2026-05-14)
- [question-maker] frontend: Fix `question-maker-frontend#build` — add missing `tsconfig.json` and `tsconfig.node.json`; resolve all TypeScript errors from the React 19 / `moduleResolution: "bundler"` type mismatch (`React.ElementRef` → `React.ComponentRef` across all shadcn UI components, bump `@types/react` and `@types/react-dom` to v19, fix pdfjs-dist v4 import path, correct `isDraft` access path on `QuestionVariant`, and exclude stale archive and mock data files from compilation). (#133, @evanbones, 2026-05-14)
- [question-maker] backend: Fix `question-maker-backend#test` — replace hardcoded `node_modules/jest/bin/jest.js` path with a `scripts/run-jest.cjs` helper that resolves Jest via `require.resolve`, compatible with npm workspace hoisting. (#133, @evanbones, 2026-05-14)
- [ai-tutor] server: Fix `server#test` Prisma binary resolution in `test/globalSetup.js` — walk up the directory tree to find the hoisted `prisma` binary, run `prisma generate` before `prisma migrate deploy`, and handle Windows by resolving the `.cmd` wrapper and invoking via `cmd.exe /c`. (#133, @evanbones, 2026-05-14)
- [core] auth: Fix `edu-ai-core-learning#build` — remove `apiKeyClient` import from `app/lib/auth/client.ts`; not exported by `better-auth@1.2.8/client/plugins`. (#133, @evanbones, 2026-05-14)
- [ai-tutor] frontend: Fix `aitutor#test` — replace invalid `resolve.tsconfigPaths: true` with `tsconfigPaths()` plugin in `vitest.config.ts` so the `~/*` path alias resolves correctly; all 6 test files (29 tests) now pass. (#133, @evanbones, 2026-05-14)
- [monorepo] infra: Fix duplicate React installation that broke question-maker-frontend tests — loosen exact React pin in `ai-tutor` (`19.2.1` → `^19.2.1`) and bump React constraint in `edu-ai` (`^19.2.1` → `^19.2.3`) so npm deduplicates to a single React 19.2.6 at the workspace root; eliminates the two-React-instance problem that caused hook failures in jsdom tests. (#137, @evanbones @abdullahmoh21, 2026-05-15)
- [core] infra: Add `passWithNoTests: true` to `apps/core/vitest.config.ts` so `edu-ai#test` exits cleanly when no test files exist yet rather than failing the root `npm run test`. (#137, @evanbones, 2026-05-15)
- [question-maker] frontend: Remove invalid `vitest: true` ESLint env from `.eslintrc.cjs` — `vitest` is not a recognised built-in ESLint environment and caused a hard error on `npm run lint`; test files import `vi` explicitly from `vitest` so no globals env is needed. (#137, @ariqmuldi, 2026-05-15)

## [Week 1 — May 4–8, 2026]

### Added

- [monorepo] docs: Add platform centralization architecture plan for Epic #58 covering current state of all three extensions, gap analysis, API contracts, migration plan, key decisions, and known challenges. (#96, @ariqmuldi, 2026-05-10)
- [monorepo] docs: Add user management and roles architecture plan for Epic #60 covering role hierarchy, Unit concept, current permissions per role, gaps, naming decisions, and Canvas role reference. (#96, @ariqmuldi, 2026-05-10)

### Changed

- [monorepo] docs: Update platform centralization plan to reflect open PRs — EC-3 enrollment endpoint now in progress on `feature/enrollment-api`; EC-10 OAuth/OIDC sister-app auth covered by PRs #48, #49, #51, #50; Phase 1 and Week 2 checklist updated accordingly. (#96, @ariqmuldi, 2026-05-10)
- [monorepo] docs: Update user management and roles plan to reflect enrollment endpoint progress on `feature/enrollment-api`. (#96, @ariqmuldi, 2026-05-10)
- [monorepo] docs: Expand platform centralization plan with additional gaps, decisions, and corrections — corrected QM AI Chat status (question generation still calls providers directly; OCR extraction and variant generation already centralized), added gaps QM-7/QM-8/AT-3/EC-12, added within-extension cleanup section, added Decisions 5–7 (bug reporting consolidation, subdomain/cookie strategy, QM ORM), added open question on shared question bank visibility control, added out-of-scope items for unified dashboard and user navigation flow, and updated Week 2 checklist. (@abdullahmoh21, 2026-05-10)

---

## How to use this changelog

**Every PR that changes user-visible behavior, public APIs, the database schema, the build, or developer workflow must add an entry here before it is merged.** Trivial changes (typo fixes, internal refactors with no observable effect, comment-only edits) may be skipped — when in doubt, add an entry.

1. Find the section for the **current sprint / milestone** at the top under `## [Unreleased]`. If there is no open sprint section, create one (see template below).
2. Add your entry under the correct **category** (see "Categories" below).
3. Use the entry format:
   ```
   - Short, imperative description. (#PR-number, @github-handle, YYYY-MM-DD)
   ```
4. If the change is **breaking**, prefix the description with `**BREAKING:**` and add a short migration note on the next line.
5. Commit the changelog update **as part of the same PR** — do not open a separate "update changelog" PR.

When a sprint / milestone closes, the maintainer renames the section header from `[Unreleased – Sprint N]` to the final sprint name and date range, and opens a new `[Unreleased]` block at the top.

### Sprint section template

When opening a new sprint, copy this block just below the intro section:

```markdown
## [Unreleased — Sprint N]

### Added

-

### Changed

-

### Deprecated

-

### Removed

-

### Fixed

-

### Security

-
```

### Categories

Use these category headings (from Keep a Changelog) — keep them in this order, and omit any that have no entries for the sprint:

| Category       | Use for                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------- |
| **Added**      | New features, endpoints, components, pages, scripts, or env vars.                                         |
| **Changed**    | Updates to existing behavior, refactors with observable effects, dependency upgrades that affect runtime. |
| **Deprecated** | Features still present but scheduled for removal. Note the removal target.                                |
| **Removed**    | Features, files, branches, endpoints, or env vars that have been deleted.                                 |
| **Fixed**      | Bug fixes.                                                                                                |
| **Security**   | Vulnerability fixes, auth/permissions changes, secret-handling fixes.                                     |

### Entry format

```
- [app] scope: Short, imperative description in sentence case. (#PR, @author, YYYY-MM-DD)
```

- **App tag** is required. Use one of: `[core]`, `[ai-tutor]`, `[question-maker]`, `[monorepo]` (for root-level changes that affect the repo as a whole).
- **Scope** (optional but encouraged) — prefix after the app tag to help readers scan. Common ones: `frontend:`, `api:`, `db:`, `auth:`, `infra:`, `docs:`, `model:`, `ui:`, `content:`.
- **Imperative voice:** "Add team page route" — not "Added team page route" or "Adds team page route". The category heading already supplies the tense.
- **PR number** is required. If the change was pushed without a PR (rare — emergency hotfix only), use the commit short SHA instead: `(commit a1b2c3d, @author, YYYY-MM-DD)`.
- **Author** is the GitHub handle of the person who wrote the code, not the reviewer.
- **Date** is the merge date in `YYYY-MM-DD` (ISO 8601).
- **Breaking changes** — prefix with `**BREAKING:**` after the app tag and follow with an indented migration note:
  ```
  - [core] **BREAKING:** Rename `/api/users/me` to `/api/auth/session`. (#123, @ayyhab, 2026-05-07)
    - Migration: update all client calls; old route returns 410 Gone for one sprint, then is removed.
  ```
