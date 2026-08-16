# Question Maker — End-to-End User Workflows

> **How to edit this file:** pick a role section below and work it in stages — Claude finds the paths, Claude simulates them via Playwright *and turns that into a committed e2e test* (`tests/e2e/tests/question-maker/`), Claude reviews (its own and another Claude's) work, Claude sweeps once more for gaps, then a human walks the same paths (see the [README](./README.md) for the full methodology). Add/update a row per workflow, including a link to its e2e test — every workflow needs one, it's not optional. Prioritize AI-involving workflows (question generation, OCR extraction) and happy paths first. File bugs as GitHub issues and link them in the Bugs column — don't just describe them in prose. Prefix security findings with `SECURITY:`. Bump **Last updated** every time you edit.

**Last updated:** 2026-08-15

## Table of contents
- [Admin](#admin)
- [Unit Admin](#unit-admin)
- [Instructor](#instructor)
- [TA](#ta)
- [Student](#student)

---

## Admin

| Workflow | Tester(s) | Status | Makes sense? / UI clear? | Security | Bugs | E2E test |
|---|---|---|---|---|---|---|
| Dashboard, course discovery, authoring navigation, and bug-report triage | Codex + human follow-up | Passed manual browser pass | Dashboard/course navigation and triage filters are clear. | Admin can reach bug triage; Unit Admin direct navigation redirects to Courses. | — | `tests/e2e/tests/question-maker/all-roles-workflows.spec.ts` |

## Unit Admin

| Workflow | Tester(s) | Status | Makes sense? / UI clear? | Security | Bugs | E2E test |
|---|---|---|---|---|---|---|
| Unit-scoped course discovery and authoring entry | Codex + human follow-up | Passed manual browser pass | Course list clearly identifies the managed unit and authoring surfaces. | Direct `/admin/bug-reports` navigation redirected to Courses; no platform triage access leaked. | — | `tests/e2e/tests/question-maker/all-roles-workflows.spec.ts` |

## Instructor

| Workflow | Tester(s) | Status | Makes sense? / UI clear? | Security | Bugs | E2E test |
|---|---|---|---|---|---|---|
| AI-assisted and manual question authoring in an assigned course | Codex + human follow-up | Blocked | Composer is clear, but it exposes a course then rejects both Generate and Save with a course-access error. | Fail-closed: no unauthorized question was written. | #1532 | `tests/e2e/tests/question-maker/all-roles-workflows.spec.ts` |
| Assessment → section → select bank question → generate/approve AI variant → assemble → AI review | Codex + human follow-up | Passed manual browser pass | Wizard labels and progress stages are clear; one generated variant was approved and produced a 90/100 equivalence review. | Instructor operations stayed scoped to an assigned course. | — | `tests/e2e/tests/question-maker/assessment-blueprint-workflow.spec.ts` (blueprint UI regression; variant-wizard regression still to add) |
| Canvas test-mode connection and import/export entry | Codex + human follow-up | Blocked | Canvas tab gives a clear connection prerequisite, but its advertised safe test mode fails with an opaque HTTP 400. Core's live Canvas suite passed in [PR #1437](https://github.com/EduAI-Lab/EduAI/pull/1437), isolating this to QM setup rather than Canvas/Core connectivity. | No Canvas token was entered or exposed. | #1533 | Gap — regression spec to be added with the fix |

## TA

| Workflow | Tester(s) | Status | Makes sense? / UI clear? | Security | Bugs | E2E test |
|---|---|---|---|---|---|---|
| Attempt to open Question Maker with a TA course enrollment | Codex + human follow-up | Passed manual browser pass | The access-restricted page explicitly directs TAs to Core or AI Tutor. | TA stays outside Question Maker authoring despite course enrollment. | — | `tests/e2e/tests/question-maker/all-roles-workflows.spec.ts` |

## Student

| Workflow | Tester(s) | Status | Makes sense? / UI clear? | Security | Bugs | E2E test |
|---|---|---|---|---|---|---|
| Attempt to open Question Maker authoring | Codex + human follow-up | Passed manual browser pass | The access-restricted page explains that Question Maker is for instructors and administrators. | No Question Library or authoring navigation is exposed. | — | `tests/e2e/tests/question-maker/all-roles-workflows.spec.ts` |
