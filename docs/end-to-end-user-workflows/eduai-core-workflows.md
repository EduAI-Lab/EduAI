# EduAI Core — End-to-End User Workflows

> **How to edit this file:** pick a role section below and work it in stages — Claude finds the paths, Claude simulates them via Playwright *and turns that into a committed e2e test* (`tests/e2e/tests/core/`), Claude reviews (its own and another Claude's) work, Claude sweeps once more for gaps, then a human walks the same paths (see the [README](./README.md) for the full methodology). Add/update a row per workflow, including a link to its e2e test — every workflow needs one, it's not optional. Prioritize AI-involving workflows and happy paths first. File bugs as GitHub issues and link them in the Bugs column — don't just describe them in prose. Prefix security findings with `SECURITY:`. Bump **Last updated** every time you edit.

**Last updated:** 2026-08-18

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
| Read a course's off-by-default course-scope guardrail setting | Automated | Automated; human pass pending | API response is explicit and stable | ADMIN may read staff settings | None found | [`course-scope-guardrail.spec.ts`](../../tests/e2e/tests/core/course-scope-guardrail.spec.ts) |
| Enable a course-scope guardrail and verify the persisted read-back | Automated | Automated; human pass pending | Save/read-back path is clear | ADMIN may update staff settings | None found | [`course-scope-guardrail.spec.ts`](../../tests/e2e/tests/core/course-scope-guardrail.spec.ts) |

## Unit Admin

| Workflow | Tester(s) | Status | Makes sense? / UI clear? | Security | Bugs | E2E test |
|---|---|---|---|---|---|---|
| | | Not started | | | | |

## Instructor

| Workflow | Tester(s) | Status | Makes sense? / UI clear? | Security | Bugs | E2E test |
|---|---|---|---|---|---|---|
| Read the course-scope guardrail with its default disabled | Automated | Automated; human pass pending | Default is explicit as `false` | Instructor-or-above access is required | None found | [`course-scope-guardrail.spec.ts`](../../tests/e2e/tests/core/course-scope-guardrail.spec.ts) |
| Enable the course-scope guardrail and read it back | Automated | Automated; human pass pending | Toggle persistence is clear | Course ownership is enforced | None found | [`course-scope-guardrail.spec.ts`](../../tests/e2e/tests/core/course-scope-guardrail.spec.ts) |
| Disable an enabled course-scope guardrail | Automated | Automated; human pass pending | On/off transition is reversible | Course ownership is enforced | None found | [`course-scope-guardrail.spec.ts`](../../tests/e2e/tests/core/course-scope-guardrail.spec.ts) |
| Change RAG top-k while preserving an enabled guardrail | Automated | Automated; human pass pending | Independent settings remain independent | No cross-course write observed | None found | [`course-scope-guardrail.spec.ts`](../../tests/e2e/tests/core/course-scope-guardrail.spec.ts) |
| Change RAG relevance threshold while preserving an enabled guardrail | Automated | Automated; human pass pending | Independent settings remain independent | No cross-course write observed | None found | [`course-scope-guardrail.spec.ts`](../../tests/e2e/tests/core/course-scope-guardrail.spec.ts) |
| Save the guardrail and both RAG values together | Automated | Automated; human pass pending | Combined save returns all persisted values | Course ownership is enforced | None found | [`course-scope-guardrail.spec.ts`](../../tests/e2e/tests/core/course-scope-guardrail.spec.ts) |
| Clear RAG overrides while keeping the guardrail enabled | Automated | Automated; human pass pending | `null` restores global RAG defaults | Course ownership is enforced | None found | [`course-scope-guardrail.spec.ts`](../../tests/e2e/tests/core/course-scope-guardrail.spec.ts) |

## TA

| Workflow | Tester(s) | Status | Makes sense? / UI clear? | Security | Bugs | E2E test |
|---|---|---|---|---|---|---|
| Attempt to open staff-only course-scope settings as a TA | Automated | Automated; human pass pending | Settings should not be offered | TA receives 403 for staff settings | None found | [`course-scope-guardrail.spec.ts`](../../tests/e2e/tests/core/course-scope-guardrail.spec.ts) |

## Student

| Workflow | Tester(s) | Status | Makes sense? / UI clear? | Security | Bugs | E2E test |
|---|---|---|---|---|---|---|
| See a published enrolled course while staff settings remain unavailable | Automated | Automated; human pass pending | Course visibility and staff settings are separate | Student receives 403 for staff settings | None found | [`course-scope-guardrail.spec.ts`](../../tests/e2e/tests/core/course-scope-guardrail.spec.ts) |
