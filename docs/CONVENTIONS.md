# EduAI Project Conventions

This file is the authoritative reference for all project conventions. Every AI agent (Claude, ChatGPT, Gemini, Codex, etc.) and every contributor should read this before creating issues, branches, or pull requests.

Source issues: [Making Pull Requests #67](https://github.com/EduAI-Lab/EduAI/issues/67) · [Making Issues #69](https://github.com/EduAI-Lab/EduAI/issues/69) · [Git Workflow #120](https://github.com/EduAI-Lab/EduAI/issues/120)

---

## 1. Making Issues

Issue conventions now live in [`docs/ISSUE-CONVENTIONS.md`](ISSUE-CONVENTIONS.md), and every issue is created with the **EduAI Task** form (`.github/ISSUE_TEMPLATE/task.yml`). In short:

- **Title** — a plain description of the work. No size or week prefix (the old `M: Week 1 - …` format is retired).
- **Size, Priority, Iteration** — set as fields on the **Edu AI Core** board (https://github.com/orgs/EduAI-Lab/projects/8), not in the title.
- **Epic** — an `EPIC: <link>` line in the body plus the matching `epic/*` label.
- **Hours** — one line per contributor per week: `Hours to complete (Week N): X hours [github-handle]` (bracketed GitHub handles only).
- **Assignees** — assign everyone working on the issue.

> Every task, no matter how small, must have an issue. No issue = no record of the work.

---

## 2. Git Workflow

Full workflow doc: [Git Workflow Google Doc](https://docs.google.com/document/d/1n0o6d3sM1boKVt9ool5KB1fBPQ30CBkbbIKWlsLXRqs/edit?usp=sharing)  
See also: [Git Workflow Issue #120](https://github.com/EduAI-Lab/EduAI/issues/120)

### Commit hygiene
- **Commit in logical groups** — each commit should represent one coherent unit of change. Do not `git add .` and lump unrelated changes into a single commit.
- **Write meaningful commit messages** — describe what changed and why, not just "fix" or "update". Use a prefix where appropriate (e.g. `feat:`, `fix:`, `docs:`, `test:`, `refactor:`).
- **Bad:** one commit with all your changes — `git add . && git commit -m "done"`
- **Good:** multiple focused commits — `feat: add enrollment endpoint`, then `test: add enrollment endpoint tests`, then `docs: update README with enrollment API`

---

## 3. Making Pull Requests

### Rules

- Every PR **must have one approving review** before it can be merged
- Every PR **must be linked to at least one issue** via `Closes #<number>` in the PR description (add one line per issue if the PR closes more than one), and each issue **must be linked to an epic** on the project board. A PR cannot be merged without this.
- Every issue must be **open** at the time of the PR — do not link a closed issue
- Every issue must have **assignees set** — assign everyone working on it, not just the PR author
- Every issue must be on the **Edu AI Core board** at https://github.com/orgs/EduAI-Lab/projects/8 with Size, Priority and Iteration set
- The branch must be **up to date with `development`** before opening a PR — rebase or merge from development if behind

### PR Checklist (complete in order)

1. **Implement the feature** — complete the feature or fix as scoped in the linked issue
2. **Tests** — write tests before implementing. **This is the most important step.** Consider all applicable levels: unit tests, integration tests, end-to-end tests (Playwright), and mutation tests. Before requesting review, run the full test suite across all applicable levels to confirm nothing is broken.
3. **PR title and description** — write a clear title and description explaining *what* you implemented and *why*, not just what files changed
4. **Meaningful code comments** — add comments only where the reasoning is non-obvious; do not comment every line
5. **Logical folder structure** — group new files with related files; do not dump files in the root or unrelated folders
6. **Sound SWE practices** — follow modularity, separation of concerns, and avoid redundancy
7. **Update the following files:**
   - `MEMORY.md` (repo root, git-tracked) — add anything non-obvious that helps AI agents work on the codebase
   - `TESTS.md` — if any tests were added or changed, add a row for each test file: the filename (linked to its path) and a plain-English description of what it tests
   - `README.md` — update for every implementation, including changes made after PR review
8. **Assign yourself (and all contributors) as PR assignees** — everyone working on the PR should be assigned to it
9. **Assign a reviewer** — one approval is required to merge

> `CHANGELOG.md` is deprecated and archived at [`docs/deprecated/CHANGELOG.md`](deprecated/CHANGELOG.md). Do not add entries — the PR and its linked issues are the record of the change.

### PR Description Template

Use [`.github/pull_request_template.md`](../.github/pull_request_template.md) — GitHub pre-fills it when you open a PR. Fill in every section and tick only the checklist items you have actually done.

### Common mistakes to avoid
- Linking a **closed** issue — the linked issue must be open
- Putting a **size or week in the issue title** — those are board fields
- Adding entries to the **deprecated CHANGELOG**
- Opening a PR when the **branch is behind `development`** — update first

---

## Using This File

### Claude Code
Run `/make-pr` on your feature branch. It reads this file and walks you through the full checklist interactively before creating the PR.

### ChatGPT, Gemini, Copilot, Codex, or any other AI
Paste this prompt into your AI session when you're ready to create a PR:

> Read `docs/CONVENTIONS.md` in this repo. Then check the current git state (`git status`, `git branch --show-current`, `git log --oneline -10`) and walk me through the PR checklist in that file item by item, following `docs/ISSUE-CONVENTIONS.md` for issue fields. For each item, check the relevant files, tell me what you find, help me fix anything missing, and wait for me to confirm before moving on. Once all items are done, draft a PR title and description using `.github/pull_request_template.md`, then create the PR with `gh pr create`.

### No AI at all
Work through the **PR Checklist** in section 3 manually before opening your PR on GitHub.

---

## For AI Agents

### Never do this
- **Do not add `Co-Authored-By` lines or "Generated with Claude Code" lines** to commit messages or PR descriptions. This applies to all AI agents — Claude, Copilot, Cursor, etc.

### When helping a contributor create a PR, always:

1. Read this file (`docs/CONVENTIONS.md`) first
2. Check `git status`, `git branch --show-current`, and `git log --oneline -5` to understand the current state
3. Walk through the PR checklist above item by item — check the actual file state for each item, report what you find, help fix anything missing, and wait for confirmation before moving on
4. Verify `TESTS.md`, `README.md`, and `MEMORY.md` have been updated where needed
5. Draft a PR title and description using `.github/pull_request_template.md`
6. Remind the contributor to assign a reviewer before requesting review
