You are helping the user create a pull request that follows the EduAI project conventions. Run in **checklist mode**: go through each item below one by one, check the current state of the repo, report what you find, then ask the user to confirm before moving to the next item. Do not skip ahead.

## Setup

First, read these to load the current conventions:
- `docs/CONVENTIONS.md` — PR rules and checklist
- `docs/ISSUE-CONVENTIONS.md` — where issue facts live (title, board fields)
- `.github/pull_request_template.md` — the PR body to fill in

Then run these commands to understand the current state:
- `git branch --show-current` — current branch name
- `git status --short` — any uncommitted changes
- `git log --oneline -10` — recent commits
- `git fetch origin development && git diff origin/development...HEAD --name-only` — files changed on this branch
- `gh pr list --head $(git branch --show-current) --repo EduAI-Lab/EduAI` — check if a PR already exists for this branch

**Before starting the checklist, flag any of these blocking issues and ask the user to resolve them first:**
- **Uncommitted changes exist** — `git status` shows modified or untracked files that should be part of this PR. Ask the user to commit them first. Remind them to commit in **logical groups with meaningful messages** — do not `git add .` and dump everything into one commit. Each commit should represent one coherent change (e.g. "feat: add user auth endpoint" and "test: add auth endpoint tests" as separate commits, not combined). Confirm they are done before continuing.
- **No commits on branch** — if the branch is 0 commits ahead of the base, there is nothing to PR yet. Stop and tell the user.
- **PR already exists** — if `gh pr list` returns a result, show the existing PR URL and ask the user if they want to update it instead of creating a new one.
- **Branch behind base** — run `git log HEAD..origin/development --oneline | wc -l` to check. If the branch is behind, warn the user they should rebase or merge from development before creating the PR to avoid conflicts.

Report a brief summary (branch name, commits ahead, files changed, any blocking issues found) before starting the checklist.

## Checklist

Work through each item in order. For each item:
1. Check the current repo state relevant to that item (read files, run git commands)
2. Report what you found (e.g. "I see 3 test files were modified")
3. If something is missing or wrong, help the user fix it before marking it done
4. Ask: "Ready to move on?" before proceeding to the next item

---

### Item 1 — Linked Issue
- Ask the user: what GitHub issue number(s) does this PR close? (A PR can close more than one issue — ask if there are multiple.)
- If they don't have one, draft the issue for them using the **EduAI Task** issue form (`.github/ISSUE_TEMPLATE/task.yml`):
  - **Title** — a plain description of the work. Do **not** put a size or week in the title (no `M: Week 4 - …` prefix); see `docs/ISSUE-CONVENTIONS.md`
  - **Size** (S/M/L), **Week** and **Description**
  - Print the fields clearly so the user can paste them into https://github.com/EduAI-Lab/EduAI/issues/new/choose
  - Remind them to assign everyone working on it (do not leave unassigned), add it to the **Edu AI Core** board (https://github.com/orgs/EduAI-Lab/projects/8), and set its Size and Priority fields there
  - Wait for them to create the issue and give you the issue number(s) before continuing
- If they have one, confirm each issue exists using `gh issue view <number> --repo EduAI-Lab/EduAI` and check:
  - The issue is **open** (not closed — if it's closed, flag it and ask the user to confirm this is the right issue)
  - The issue has assignees set (if none, remind the user to assign everyone working on it)
- Remind the user: every issue must be on the Edu AI Core board with Size and Priority set

### Item 2 — Tests (most important)
- Look at the changed files and identify what logic was added or modified
- Determine whether the changes warrant unit tests, integration tests, end-to-end tests (Playwright), mutation tests, or none — and explain your reasoning
- Check if corresponding test files exist for each applicable test type
- Ask the user to confirm: "Have you run the full test suite (unit, integration, end-to-end, and mutation tests where applicable) and all tests pass with no skipped tests that shouldn't be skipped?"
- If there are untested changes across any test type, flag them explicitly

### Item 3 — TESTS.md
- Read `TESTS.md`
- Check if any test files added or changed in this PR are documented in TESTS.md
- If TESTS.md is missing entries, identify exactly which rows need to be added (filename linked to path, plain-English description of what it tests)
- Help the user add the missing rows if needed

### Item 4 — README.md
- Read `README.md`
- Check if any changes in this PR require README updates (new features, changed setup steps, new env vars, new commands, etc.)
- Report what you find and ask the user to confirm the README is up to date

### Item 5 — MEMORY.md
- `MEMORY.md` at the repo root is git-tracked working memory for AI agents
- Ask: "Is there anything non-obvious about this implementation that should be added to MEMORY.md to help AI agents in future sessions?" If so, help add it as part of this PR

### Item 6 — Code quality
- Ask the user to confirm:
  - Code comments are added only where the WHY is non-obvious (not every line)
  - New files are grouped with related files, not dumped in the root
  - The implementation follows modularity and separation of concerns

---

## Create the PR

Once all 6 items are confirmed, do the following:

1. **Draft PR** — ask the user: "Is this PR ready for review, or should it be created as a draft (work still in progress)?"

2. **Draft a PR title** — clear and descriptive, explaining what was implemented (not just what files changed). Show it to the user and ask for approval.

3. **Draft the PR description** by filling in `.github/pull_request_template.md` — Summary, Changes, Testing, Issue Linkage (`Closes #<number>`, one line per issue), Checklist (tick only what was actually confirmed above), Reviewer Notes, and Screenshots for UI changes (remove that section if not applicable). Show the draft to the user and ask for approval before creating.

4. **Confirm base branch** — ask the user if the PR should target `development` (default) or another branch.

5. **Verify issue linking before creating** — confirm the PR description contains a `Closes #<number>` line for every issue identified in Item 1. If any issue number is missing, ask the user for it before proceeding. Do not create the PR without at least one linked issue. As a last resort, if the user cannot provide one, remind them they must manually link the issue on GitHub after creation — a PR cannot be merged without a linked issue.

6. **Create the PR** using `gh pr create --repo EduAI-Lab/EduAI` with the approved title, body, and base branch (write the body to a file and pass `--body-file` so the Markdown survives). Add `--draft` if the user chose draft mode. Do not add a `Co-Authored-By` line or a "Generated with Claude Code" line anywhere in the commit messages or PR body.

7. After creation, remind the user:
   - **Assign yourself (and anyone else working on it) as the PR assignee** — everyone contributing to the PR should be assigned to it.
   - **Assign a reviewer** — one approving review is required before the PR can be merged.
