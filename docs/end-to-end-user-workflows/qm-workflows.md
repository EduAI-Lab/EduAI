# Question Maker — End-to-End User Workflows

> **How to edit this file:** pick a role section below and work it in stages — Claude finds the paths, Claude simulates them via Playwright *and turns that into a committed e2e test* (`tests/e2e/tests/question-maker/`), Claude reviews (its own and another Claude's) work, Claude sweeps once more for gaps, then a human walks the same paths (see the [README](./README.md) for the full methodology). Add/update a row per workflow, including a link to its e2e test — every workflow needs one, it's not optional. Prioritize AI-involving workflows (question generation, OCR extraction) and happy paths first. File bugs as GitHub issues and link them in the Bugs column — don't just describe them in prose. Prefix security findings with `SECURITY:`. Bump **Last updated** every time you edit.

**Last updated:** _not yet started_

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
| | | Not started | | | | |

## Unit Admin

| Workflow | Tester(s) | Status | Makes sense? / UI clear? | Security | Bugs | E2E test |
|---|---|---|---|---|---|---|
| | | Not started | | | | |

## Instructor

| Workflow | Tester(s) | Status | Makes sense? / UI clear? | Security | Bugs | E2E test |
|---|---|---|---|---|---|---|
| _e.g. Generate a question set from uploaded course material via AI_ | | Not started | | | | _e.g. `tests/e2e/tests/question-maker/instructor-ai-question-generation.spec.ts`_ |

## TA

| Workflow | Tester(s) | Status | Makes sense? / UI clear? | Security | Bugs | E2E test |
|---|---|---|---|---|---|---|
| | | Not started | | | | |

## Student

| Workflow | Tester(s) | Status | Makes sense? / UI clear? | Security | Bugs | E2E test |
|---|---|---|---|---|---|---|
| _e.g. Confirm students cannot access the Question Maker answer-key / assessment-authoring views_ | | Not started | | | | _e.g. `tests/e2e/tests/question-maker/student-rbac-answer-key.spec.ts`_ |
