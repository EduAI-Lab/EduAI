# TESTS.md

## Table of Contents

1. [Purpose](#purpose)
2. [Policy](#policy)
3. [Structure](#structure)
4. [How to Run Tests](#how-to-run-tests)
5. [Populating TESTS.md](#populating-testsmd)
6. [EduAI Full Platform End-to-End Tests](#eduai-full-platform-end-to-end-tests)
7. [Monorepo Automation Tests](#monorepo-automation-tests)
8. [EduAI Unit Tests](#eduai-unit-tests)
9. [EduAI Integration Tests](#eduai-integration-tests)
10. [AI Tutor Unit Tests](#ai-tutor-unit-tests)
11. [AI Tutor Integration Tests](#ai-tutor-integration-tests)
12. [Question Maker Unit Tests](#question-maker-unit-tests)
13. [Question Maker Integration Tests](#question-maker-integration-tests)
14. [Extending This Document](#extending-this-document)

---

## Purpose

This file is the canonical test inventory for the EduAI monorepo. It tracks every test suite across all apps and packages — what exists, what it covers, and what is still missing.

It serves two purposes:

1. **For the team** — a single place to understand the current test coverage picture without having to read every test file individually.
2. **For AI-assisted development** — before writing new tests, reference this file to avoid duplication and to understand coverage gaps. After writing new tests, update this file to keep the inventory current.

## Policy

- Tests are written **before** implementation (test-first approach).
- Every new feature or significant change must have corresponding tests recorded here.
- After any test-related work, update this file to reflect what the tests actually test.

## Structure

Tests are organized into three locations across the monorepo:

```
EduAI/
├── tests/
│   └── e2e/                          # End-to-end tests spanning EduAI and all extensions
├── apps/
│   └── core/
│       └── app/
│           └── tests/
│               ├── unit/             # Unit tests for EduAI
│               └── integration/      # Integration tests for EduAI
└── apps/
    └── extensions/
        └── <extension-name>/
            └── app/
                └── tests/
                    ├── unit/         # Unit tests for the extension
                    └── integration/  # Integration tests for the extension
```

---

## How to Run Tests

> _To be populated._

---

## Populating TESTS.md

Each section below corresponds to a test directory. When you add, change, or remove tests in that directory, update the matching section here.

### What to add per test file

For each test file in a directory, add a row to that section's table. The table should capture:

- **Test file** — the file name (e.g. `auth.test.ts`), linked to its path in the repo
- **What it tests** — a plain-English description of the behaviour being tested

### Table format

Each section should use this format:

```markdown
| Test file | What it tests |
|-----------|---------------|
| `example.test.ts` | Description of what is being tested |
```

### Rules

- One row per test file, not per individual test case.
- The "What it tests" column should describe the **behaviour**, not the implementation — write it so someone unfamiliar with the code understands what would break if this test failed.
- If a test file is added as part of a feature branch, add the row here in the same PR.

### Example

| Test file | What it tests |
|-----------|---------------|
| `auth.test.ts` | JWT token validation and expiry handling |
| `chat-retrieval.test.ts` | RAG pipeline returns course-relevant context for a given query |

---

## EduAI Full Platform End-to-End Tests

**Path:** `tests/e2e/`

> _To be populated._

---

## Monorepo Automation Tests

**Path:** `eduai-summer-2026/tests/`

| Test file | What it tests |
|-----------|---------------|
| [`team-time-report.test.js`](eduai-summer-2026/tests/team-time-report.test.js) | Verifies weekly time-report parsing rules, base-time duplicate handling, issue/PR reference extraction, PR analytics metric extraction, and the rule that PR process time is reported separately from total tracked hours. |

---

## EduAI Unit Tests

**Path:** `apps/core/app/tests/unit/`

| Test file | What it tests |
|-----------|---------------|
| `form-utils.test.ts` | Tests form validation errors surface per field, merge into one message, and correctly flag fields as valid or invalid. |
| `guards.server.test.ts` | `requireServiceKey`: 401 on missing header, 401 on non-Bearer scheme, 403 on wrong token, 403 on unconfigured env var, null on correct token, 403 on prefix/suffix length-variant tokens. |
| `courses.server.test.ts` | `getCourse`, `getCourseTopics`, `getCourseTopic`, and `deleteCourseTopic` — verifies `deletedAt: null` queries and soft-delete updates. |
| `courses.id.test.ts` | `courses.id` loader: 400/401/403, service-key and session auth, 404 `COURSE_NOT_FOUND`, 200 flat course. |
| `courses.topics.test.ts` | Topics `loader` and `action` unit tests: GET list/by-id and POST/DELETE auth, status codes, and error bodies (mocked server + auth). |


---

## EduAI Integration Tests

**Path:** `apps/core/app/tests/integration/`

| Test file | What it tests |
|-----------|---------------|
| `courses.integration.test.ts` | `GET /api/courses` against the test DB: returns 200 with a courses array, includes the seeded course, and allows unauthenticated access. |
| `courses.id.integration.test.ts` | `GET /api/courses/:id` on the test DB: 401 without auth, 200 via session or service key, `COURSE_NOT_FOUND` for missing and soft-deleted courses. |
| `courses-topic.integration.test.ts` | Topics list/get-by-id/create/delete on the test DB (session + service key): status codes, `TOPIC_ALREADY_EXISTS`, soft-delete filtering, and soft-delete on DELETE. |
| `service-key.integration.test.ts` | Verifies that `requireServiceKey` correctly rejects (403) wrong-key Bearer requests and never calls downstream DB logic, accepts (200) correct-key requests and calls `getCourseTopics`, and that requests with no Authorization header fall through to session auth (401 Unauthorized) — all tested through the real `GET /api/courses/:id/topics` loader with DB and session layers mocked. |

---

## AI Tutor Unit Tests

**Path:** `apps/extensions/ai-tutor/app/tests/unit/`

> _To be populated._

---

## AI Tutor Integration Tests

**Path:** `apps/extensions/ai-tutor/app/tests/integration/`

> _To be populated._

---

## Question Maker Unit Tests

**Path:** `apps/extensions/question-maker/app/tests/unit/`

> _To be populated._

---

## Question Maker Integration Tests

**Path:** `apps/extensions/question-maker/app/tests/integration/`

> _To be populated._

---

## Extending This Document

If a new extension is added to the platform or a new category of tests is introduced, update this file to match:

1. **Update the Structure section** — add the new directory to the folder tree and the summary table so the layout stays accurate.
2. **Add a new entry to the Table of Contents** — follow the same naming convention used for existing entries (e.g. `<Extension Name> Unit Tests`, `<Extension Name> Integration Tests`).
3. **Add the corresponding section** — place it after the existing test sections, include the **Path** line, and start with `> _To be populated._` until tests are written.

Keep naming, formatting, and ordering consistent with what is already here.
