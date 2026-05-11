# Changelog

All notable changes to this project are documented in this file. This format is shared across all EduAI Lab repositories (AI Tutor, Question Maker, EduAI Core, EduAI Website) so contributors see the same conventions everywhere.

---
### Sprint section template
When opening a new sprint, copy this block to the top of the changelog (just under the `# Changelog` header and intro):
---

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

---

## [Unreleased — Foundation Sprint, May 2026]

### Added
- docs: Add platform centralization architecture plan for Epic #58 covering current state of all three extensions, gap analysis, API contracts, migration plan, key decisions, and known challenges. (#PR, @ariqmuldi, 2026-05-10)
- docs: Add user management and roles architecture plan for Epic #60 covering role hierarchy, Unit concept, current permissions per role, gaps, naming decisions, and Canvas role reference. (#PR, @ariqmuldi, 2026-05-10)

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
- Short, imperative description in sentence case. (#PR, @author, YYYY-MM-DD)
```

- **Imperative voice:** "Add team page route" — not "Added team page route" or "Adds team page route". The category heading already supplies the tense.
- **PR number** is required. If the change was pushed without a PR (rare — emergency hotfix only), use the commit short SHA instead: `(commit a1b2c3d, @author, YYYY-MM-DD)`.
- **Author** is the GitHub handle of the person who wrote the code, not the reviewer.
- **Date** is the merge date in `YYYY-MM-DD` (ISO 8601).
- **Affected area** (optional but encouraged) — prefix with a scope tag when it helps readers scan. Each repo can define its own; common ones across our projects include `frontend:`, `api:`, `db:`, `auth:`, `infra:`, `docs:`, `model:`, `ui:`, `content:`.
- **Breaking changes** — prefix with `**BREAKING:**` and follow with an indented migration note:
  ```
  - **BREAKING:** Rename `/api/users/me` to `/api/auth/session`. (#123, @ayyhab, 2026-05-07)
    - Migration: update all client calls; old route returns 410 Gone for one sprint, then is removed.
  ```


