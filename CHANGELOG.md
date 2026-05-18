# Changelog

All notable changes across the EduAICore monorepo (AI Tutor, Question Maker, EduAI Core) are documented in this file.

> See [How to use this changelog](#how-to-use-this-changelog) at the bottom for entry format, categories, and the sprint template.

---
## [Week 3 — May 18–22, 2026]

### Added
- [monorepo] docs: Added rbac-matrix doc defining role based access control patterns. (#198, #@abdullahmoh21, 2026-05-10)

### Changed

### Removed




## [Week 2 — May 11–15, 2026]

### Added
- [monorepo] infra: Add root `package.json` with unified test runner. `npm test` at the root directory runs all unit tests across every app. (#119, @yta3216, 2026-05-12)
- [core] infra: Set up Vitest test infrastructure: add `vitest.config.ts`, `app/__tests__/setup.ts`, and `test`/`test:watch` scripts to `package.json`. No tests written yet; scaffolding only. (#119, @yta3216, 2026-05-12)
- [core] docs: Add `TESTS.md` with planned test cases for lib utilities, AI providers, file processing, Zod schemas, and form components. (#119, @yta3216, 2026-05-12)
- [monorepo] docs: Add root `TESTS.md` as the canonical test inventory — defines structure, policy, and per-section table format for tracking all test files across the monorepo. (#140, @ariqmuldi, 2026-05-13)

### Changed
- [monorepo] docs: Add Testing section to root README covering install prerequisites, all root-level test commands, integration test database requirements, and a per-app runner reference table. (#119, @yta3216, 2026-05-12)
- docs: Merge monorepo report information into platform centralization document. Changed section 12 to be a description of the monorepo architecture. (#107, @evanbones, 2026-05-11)
- [monorepo] docs: Mark user management and roles plan as on hold pending Canvas integration — current roles frozen, Canvas identified as source of truth for course structure, enrollments, and role assignments; rest of document preserved as original draft. (#115, @ariqmuldi, 2026-05-11)

### Removed

- docs: Removed old monorepo report since the information is now included in the centralization docs. (#107, @evanbones, 2026-05-11)

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

| Category        | Use for                                                              |
| --------------- | -------------------------------------------------------------------- |
| **Added**       | New features, endpoints, components, pages, scripts, or env vars.    |
| **Changed**     | Updates to existing behavior, refactors with observable effects, dependency upgrades that affect runtime. |
| **Deprecated**  | Features still present but scheduled for removal. Note the removal target. |
| **Removed**     | Features, files, branches, endpoints, or env vars that have been deleted. |
| **Fixed**       | Bug fixes.                                                           |
| **Security**    | Vulnerability fixes, auth/permissions changes, secret-handling fixes. |

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
