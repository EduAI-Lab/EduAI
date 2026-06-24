# ADHD Assist — Pilot testing docs

| Document | Purpose |
|----------|---------|
| [adhd-pilot-facilitator-sheet.md](./adhd-pilot-facilitator-sheet.md) | Facilitator script, timings, COURSE-1–4 + NAV/AI tasks |
| [adhd-pilot-qualtrics-items.md](./adhd-pilot-qualtrics-items.md) | Qualtrics blocks and new Course UX (CU-*) items |

**Platform testing guide:** [Phase 3 User Testing Guide](../eduai-summer-2026/PHASE_3_USER_TESTING_GUIDE.md)

**Local dev login:** `student1@eduai.local` / `EduAI2026!` · Core at http://localhost:3000

## PR merge order (#708)

These branches stack chat UX on top of course UX work:

1. Merge [PR #751](https://github.com/EduAI-Lab/EduAI/pull/751) (`feat/ui-ux-participant-feedback`) into `development` first.
2. Rebase [PR #752](https://github.com/EduAI-Lab/EduAI/pull/752) onto `development` so the duplicate PR1 commit drops out of the diff.
3. Merge PR #752.

Until step 2, PR #752’s diff includes PR1 changes already in #751 — that is expected, not a duplicate implementation.
