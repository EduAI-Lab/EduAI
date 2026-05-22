You are helping the user create a pull request that follows the EduAI project conventions. Run in **checklist mode**: go through each item below one by one, check the current state of the repo, report what you find, then ask the user to confirm before moving to the next item. Do not skip ahead.

## Setup

First, read `eduai-summer-2026/CONVENTIONS.md` to load the full conventions reference.

Then run these commands to understand the current state:
- `git branch --show-current` — current branch name
- `git status --short` — any uncommitted changes
- `git log --oneline -10` — recent commits
- `git diff origin/development...HEAD --name-only 2>/dev/null || git diff origin/main...HEAD --name-only` — files changed on this branch
- `gh pr list --head $(git branch --show-current) --repo EduAI-Lab/EduAI 2>/dev/null` — check if a PR already exists for this branch

**Before starting the checklist, flag any of these blocking issues and ask the user to resolve them first:**
- **Uncommitted changes exist** — `git status` shows modified or untracked files that should be part of this PR. Ask the user to commit them first. Remind them to commit in **logical groups with meaningful messages** — do not `git add .` and dump everything into one commit. Each commit should represent one coherent change (e.g. "feat: add user auth endpoint" and "test: add auth endpoint tests" as separate commits, not combined). Confirm they are done before continuing.
- **No commits on branch** — if the branch is 0 commits ahead of the base, there is nothing to PR yet. Stop and tell the user.
- **PR already exists** — if `gh pr list` returns a result, show the existing PR URL and ask the user if they want to update it instead of creating a new one.
- **Branch behind base** — run `git log HEAD..origin/development --oneline 2>/dev/null | wc -l` to check. If the branch is behind, warn the user they should rebase or merge from development before creating the PR to avoid conflicts.

Report a brief summary (branch name, commits ahead, files changed, any blocking issues found) before starting the checklist.

## Checklist

Work through each item in order. For each item:
1. Check the current repo state relevant to that item (read files, run git commands)
2. Report what you found (e.g. "I see 3 test files were modified", "CHANGELOG.md has no entry for today's date")
3. If something is missing or wrong, help the user fix it before marking it done
4. Ask: "Ready to move on?" before proceeding to the next item

---

### Item 1 — Linked Issue
- Ask the user: what GitHub issue number(s) does this PR close? (A PR can close more than one issue — ask if there are multiple.)
- If they don't have one, draft the issue for them to create manually:
  - **Title** following the format `Size: Week N - Task` (determine size S/M/L and current week from the scope of changes)
  - **Body** with: a brief description of what was done and why, hours worked (ask the user how many people are working on it — if multiple, format is `Hours to complete (Week m): n hours [person name]` per person), and the epic link (ask the user)
  - Print the title and body clearly so the user can copy-paste it into https://github.com/EduAI-Lab/EduAI/issues/new
  - Remind them to assign all correct assignees on the issue (everyone working on it, not just themselves)
  - Remind them to add the issue to the project board at https://github.com/orgs/EduAI-Lab/projects/8
  - Wait for them to create the issue and give you the issue number(s) before continuing
- If they have one, confirm each issue exists using `gh issue view <number> --repo EduAI-Lab/EduAI` and check:
  - The issue is **open** (not closed — if it's closed, flag it and ask the user to confirm this is the right issue)
  - The issue body contains an `EPIC:` link (if missing, remind the user to add it)
  - The issue has assignees set (if none, remind the user to assign the people working on it)
- Remind the user: every issue must be on the project board at https://github.com/orgs/EduAI-Lab/projects/8 and linked to an epic

### Item 2 — Tests (most important)
- Look at the changed files and identify what logic was added or modified
- Check if corresponding test files exist for the changes
- Ask the user to confirm: "Have you run the full test suite (including Playwright if applicable) and all tests pass with no skipped tests that shouldn't be skipped?"
- If there are untested changes, flag them explicitly

### Item 3 — TESTS.md
- Read `TESTS.md`
- Check if any test files added or changed in this PR are documented in TESTS.md
- If TESTS.md is missing entries, identify exactly which rows need to be added (filename linked to path, plain-English description of what it tests)
- Help the user add the missing rows if needed

### Item 4 — CHANGELOG.md
- Read the top of `CHANGELOG.md`
- Determine the current week number and date range (Week 1 = May 4–8, 2026; add 7 days per week)
- Check if the current week's section (`## [Week N — ...]`) exists:
  - If the section **does not exist**, draft the full new week section and insert it at the top (below the file header), then add the entry inside it
  - If the section **exists**, check if there is already an entry for this PR; if not, draft one and add it under the correct `### Added / ### Changed / ### Removed / ### Fixed` heading
- The entry must include a PR link (use `#PR` as placeholder if the PR hasn't been created yet — remind the user to update it after)
- Draft the entry based on commits and changed files, ask the user to confirm before writing

### Item 5 — README.md
- Read `README.md`
- Check if any changes in this PR require README updates (new features, changed setup steps, new env vars, new commands, etc.)
- Report what you find and ask the user to confirm the README is up to date

### Item 6 — MEMORY.md
- Remind the user: MEMORY.md is not git-tracked — it lives in `.claude/memory/MEMORY.md`
- Ask: "Have you updated MEMORY.md with anything non-obvious about this implementation that would help AI agents in future sessions?"

### Item 7 — Code quality
- Ask the user to confirm:
  - Code comments are added only where the WHY is non-obvious (not every line)
  - New files are grouped with related files, not dumped in the root
  - The implementation follows modularity and separation of concerns

---

## Create the PR

Once all 7 items are confirmed, do the following:

1. **Draft PR** — ask the user: "Is this PR ready for review, or should it be created as a draft (work still in progress)?"

2. **Draft a PR title** — clear and descriptive, explaining what was implemented (not just what files changed). Show it to the user and ask for approval.

3. **Draft the PR description** using this template:
   ```
   ## Summary
   [What was implemented and why]

   ## Changes
   - [bullet per meaningful change]

   ## Testing
   [What tests were written and confirmation all tests pass]

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
   Show the draft to the user and ask for approval before creating.

4. **Confirm base branch** — ask the user if the PR should target `development` (default) or another branch.

5. **Verify issue linking before creating** — confirm the PR description contains a `Closes #<number>` line for every issue identified in Item 1. If any issue number is missing, ask the user for it before proceeding. Do not create the PR without at least one linked issue. As a last resort, if the user cannot provide one, remind them they must manually link the issue on GitHub after creation — a PR cannot be merged without a linked issue.

6. **Create the PR** using `gh pr create` with the approved title, body, and base branch. Add `--draft` if the user chose draft mode. Do not add a `Co-Authored-By` line anywhere in the commit message or PR body.

7. After creation, remind the user:
   - **Assign two reviewers** — one from the dev team, one from the project leads. They must be from different groups (two dev team members does not count). The PR cannot be merged until both approve.
   - **Update the CHANGELOG** `#PR` placeholder with the real PR number/URL if it was left as a placeholder.
