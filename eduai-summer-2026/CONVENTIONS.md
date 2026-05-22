# EduAI Project Conventions

This file is the authoritative reference for all project conventions. Every AI agent (Claude, ChatGPT, Gemini, Codex, etc.) and every contributor should read this before creating issues, branches, or pull requests.

Source issues: [Making Pull Requests #67](https://github.com/EduAI-Lab/EduAI/issues/67) · [Making Issues #69](https://github.com/EduAI-Lab/EduAI/issues/69) · [Git Workflow #120](https://github.com/EduAI-Lab/EduAI/issues/120)

---

## 1. Making Issues

### Assignees and Labels

When creating issues, **assign everyone working on the issue** (one or more people; do not leave unassigned). Also, **you must add the week label matching the week in the title** (e.g. `Week 4`, `Week 5`). An issue can also have more than one week label.

### Title Format

```
Size: Week N - Task
```

- **Size** — estimated effort:
  - `S` — 0 to 4 hours
  - `M` — 4 to 8 hours
  - `L` — 8 to 16 hours
  - If the task exceeds 16 hours, split it into smaller issues
- **Week N** — the week you plan to work on it (Week 1 = May 4–8, 2026)
- **Task** — short description of what you are doing

**Example title:** `M: Week 1 - Implement CWL/SSO login endpoint`

### Issue Body

1. A brief description of what needs to be done and why
2. Hours worked:
   - One person: `Hours to complete (Week m): n hours`
   - Multiple people: `Hours to complete (Week m): n hours [person name]` (one line per person)
3. Link to the parent epic:
   ```
   EPIC: <link-to-epic>
   ```

> Every task, no matter how small, must have an issue. No issue = no record of the work. Every issue must have at least one assignee and a week label.

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

- Every PR **must have two reviewers** assigned before it can be merged:
  - One reviewer from the **dev team**
  - One reviewer from the **project leads**
  - The two reviewers must be from **different groups** — two dev team members does not satisfy this requirement
- Every PR **must be linked to at least one issue** via `Closes #<number>` in the PR description (add one line per issue if the PR closes more than one), and each issue **must be linked to an epic** on the project board. A PR cannot be merged without this.
- Every issue must be **open** at the time of the PR — do not link a closed issue
- Every issue must have **assignees set** — assign everyone working on it, not just the PR author
- Every issue must be on the **project board** at https://github.com/orgs/EduAI-Lab/projects/8
- The branch must be **up to date with `development`** before opening a PR — rebase or merge from development if behind

### PR Checklist (complete in order)

1. **Implement the feature** — complete the feature or fix as scoped in the linked issue
2. **Tests** — write tests before implementing. **This is the most important step.** Consider all three levels: unit tests, integration tests, and end-to-end tests (Playwright). Before requesting review, run the full test suite across all applicable levels to confirm nothing is broken.
3. **PR title and description** — write a clear title and description explaining *what* you implemented and *why*, not just what files changed
4. **Meaningful code comments** — add comments only where the reasoning is non-obvious; do not comment every line
5. **Logical folder structure** — group new files with related files; do not dump files in the root or unrelated folders
6. **Sound SWE practices** — follow modularity, separation of concerns, and avoid redundancy
7. **Update the following files:**
   - `MEMORY.md` — update so AI agents can perform better on the codebase (not git-tracked)
   - `TESTS.md` — if any tests were added or changed, add a row for each test file: the filename (linked to its path) and a plain-English description of what it tests
   - `CHANGELOG.md` — add an entry with today's date (the date the PR is opened, not merged), the PR link, and bullet points describing what was implemented
   - `README.md` — update for every implementation, including changes made after PR review
8. **Assign two reviewers** — one from dev team, one from project leads

### CHANGELOG.md Entry Format

The most recent entry goes at the top. Use this format:

```
## 2026.05.04

- PR Link: https://github.com/EduAI-Lab/EduAICore/pull/66
- Add CWL/SSO login flow — users now authenticate via UBC identity provider; local auth removed
- Implement role system (Admin, Instructor, TA, Student, Dept Admin) with permissions matrix
- Add course ownership enforcement — instructors see only their courses, students see enrolled courses only
```

Alternatively, the repo uses a categorized format with `### Added`, `### Changed`, `### Removed`, `### Fixed` sections. Either format is acceptable — match the format already in use in `CHANGELOG.md`.

### PR Description Template

```markdown
## Summary
[What was implemented and why — not just what files changed]

## Changes
- [bullet point per meaningful change]

## Testing
[What tests were written, what was tested, confirmation that all tests pass]

## Checklist
- [ ] Linked to issue (issue linked to epic on project board)
- [ ] Tests written and all tests pass
- [ ] TESTS.md updated
- [ ] CHANGELOG.md updated
- [ ] README.md updated
- [ ] MEMORY.md updated
- [ ] 2 reviewers assigned (1 dev team + 1 project lead)

Closes #[issue-number]
Closes #[issue-number-2] (add one line per issue, remove if only one)
```

### Common mistakes to avoid
- Linking a **closed** issue — the linked issue must be open
- Assigning **two reviewers from the same group** (e.g. both from dev team)
- Leaving the **CHANGELOG `#PR` placeholder** unfilled after the PR is created
- Opening a PR when the **branch is behind `development`** — update first

---

## Using This File

### Claude Code
Run `/project:eduai-summer-2026:make-pr` on your feature branch. It reads this file and walks you through the full checklist interactively before creating the PR.

### ChatGPT, Gemini, Copilot, Codex, or any other AI
Paste this prompt into your AI session when you're ready to create a PR:

> Read `eduai-summer-2026/CONVENTIONS.md` in this repo. Then check the current git state (`git status`, `git branch --show-current`, `git log --oneline -10`) and walk me through the PR checklist in that file item by item. For each item, check the relevant files, tell me what you find, help me fix anything missing, and wait for me to confirm before moving on. Once all items are done, draft a PR title and description using the template in the file, then create the PR with `gh pr create`.

### No AI at all
Work through the **PR Checklist** in section 3 manually before opening your PR on GitHub.

---

## For AI Agents

### Never do this
- **Do not add `Co-Authored-By` lines** to commit messages or PR descriptions. This applies to all AI agents — Claude, Copilot, Cursor, etc.

### When helping a contributor create a PR, always:

1. Read this file (`eduai-summer-2026/CONVENTIONS.md`) first
2. Check `git status`, `git branch --show-current`, and `git log --oneline -5` to understand the current state
3. Walk through the PR checklist above item by item — check the actual file state for each item, report what you find, help fix anything missing, and wait for confirmation before moving on
4. Verify `CHANGELOG.md`, `TESTS.md`, and `README.md` have been updated
5. Draft a PR title and description using the template above
6. Remind the contributor to assign two reviewers before requesting review
