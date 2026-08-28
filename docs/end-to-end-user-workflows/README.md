# End-to-End User Workflows Testing

Working docs for **[Epic #1429 — End User Testing](https://github.com/EduAI-Lab/EduAI/issues/1429)**.

**Dates:** Aug 17 – 23, 2026 · **Assigned:** Everyone

This folder is where findings get written down. The GitHub issue tree (epic → parent issue per category → sub-issues) is where work gets *assigned and tracked*; the three markdowns here are where the actual walk-through notes, UI/UX judgments, and bug lists live so they're merged and discoverable instead of scattered across DMs.

## What we're testing

Every workflow, in every one of the three extensions, for every role:

| File | Extension |
|---|---|
| [eduai-core-workflows.md](./eduai-core-workflows.md) | EduAI Core |
| [qm-workflows.md](./qm-workflows.md) | Question Maker |
| [ai-tutor-workflows.md](./ai-tutor-workflows.md) | AI Tutor |

The five roles (same set in every file): **Admin, Unit Admin, Instructor, TA, Student.**

Not every role necessarily has a workflow in every extension — if a role shouldn't be able to do something in a given extension, that's still worth recording under that role's section (see "Security" below): the finding is "correctly blocked," not "not applicable."

These markdowns are a **starting point, not a checklist.** Add workflows as you find them — don't limit testing to whatever rows already exist in a table.

## Prioritization

We don't have time to test every path with equal depth, so within each extension × role slice:

1. **AI-involving workflows first** — chatbots, AI Tutor conversations, Question Maker's AI-assisted generation, anything that calls an LLM. Newest, least battle-tested, highest blast radius.
2. **Happy paths first** — the paths that role will actually use most often, before edge cases and rare branches.

## Methodology: Claude finds & tests, Claude reviews, then a human pass

For each extension × role slice:

1. **Find the paths.** Ask Claude to enumerate every path for that role in that extension — the full set, not just what's already written down in that role's table.
2. **Simulate — and persist it as a test.** Have Claude drive the app through an actual browser with Playwright, clicking through the UI like a real user, across every path found in step 1, not just the happy path. This isn't throwaway: it must produce a committed Playwright e2e test under `tests/e2e/tests/<core|ai-tutor|question-maker>/` for that workflow. **Every workflow needs its own e2e test — that's a deliverable, not optional coverage.**
3. **Review the work.** Use Claude to review it two ways: another Claude instance reviewing the first Claude's path list, findings, and test (peer review), and Claude reviewing its own output (self-review). Catch missed paths, wrong bug calls, findings that don't hold up, or a test that doesn't actually exercise the path it claims to — treat this like a real code review, not a rubber stamp.
4. **Sweep for gaps.** Once review is done, ask Claude once more, over the whole slice, whether there are additional paths that still haven't been covered — and therefore still need their own e2e test. Loop steps 1–4 until this sweep comes back empty.
5. **Human pass.** Only after that does a human manually walk the same paths themselves. This step is mandatory no matter how thorough steps 1–4 were — a workflow only counts as tested once a human has actually walked it, and an e2e test doesn't substitute for that walk any more than the Claude simulation does.

Log which stage found or confirmed each row — note in "Tester(s)" whether it was Claude (path-finding), Claude (review), Claude (gap-sweep), a human, or a combination. Link the committed e2e test in the row's **E2E test** column once it exists.

## How to work the markdowns

Each of the three files has:
- A **Last updated** line — bump it (date + your name) whenever you edit.
- A **table of contents** linking to each of the five role sections.
- Per role, a **table of workflows** — one row per workflow tested. Add rows as you go; don't wait for someone else to seed them.

For each workflow you test, fill in the row with the epic's five questions in mind:
1. Does it make sense for the user?
2. Is the UI clear?
3. Any bugs — and did you fix the ones in reach?
4. Any security issue — can this role see or do something it shouldn't?
5. Is it documented here?

**Bugs:** file a GitHub issue (as a sub-issue under your category's parent issue), then link it in the row (`[#1234](https://github.com/EduAI-Lab/EduAI/issues/1234)`). Don't describe bugs only in prose here — the issue is the source of truth for tracking; this doc just points at it.

**Security findings:** flag these clearly (e.g. prefix the row's finding with `SECURITY:`) so they're easy to grep for when triaging against the epic's "no unresolved role/permission leaks" requirement.

**E2E tests:** every row needs a committed Playwright spec, not just a Claude simulation. Put it under `tests/e2e/tests/<core|ai-tutor|question-maker>/`, link it in the row's **E2E test** column, and add it to `TESTS.md` in the PR that introduces it — same as any other test, per the normal [PR conventions](../../eduai-summer-2026/CONVENTIONS.md).

Full instructions are repeated briefly at the top of each markdown, since people will usually land there directly rather than here.
