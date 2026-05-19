# TESTS.md

## Table of Contents

1. [Purpose](#purpose)
2. [Policy](#policy)
3. [Structure](#structure)
4. [How to Run Tests](#how-to-run-tests)
5. [Populating TESTS.md](#populating-testsmd)
6. [EduAI Full Platform End-to-End Tests](#eduai-full-platform-end-to-end-tests)
7. [EduAI Unit Tests](#eduai-unit-tests)
8. [EduAI Integration Tests](#eduai-integration-tests)
9. [AI Tutor Unit Tests](#ai-tutor-unit-tests)
10. [AI Tutor Integration Tests](#ai-tutor-integration-tests)
11. [Question Maker Unit Tests](#question-maker-unit-tests)
12. [Question Maker Integration Tests](#question-maker-integration-tests)
13. [Extending This Document](#extending-this-document)

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

## EduAI Unit Tests

**Path:** `apps/core/app/tests/unit/`

| Test file | What it tests |
|-----------|---------------|
| `form-utils.test.ts` | Tests form validation errors surface per field, merge into one message, and correctly flag fields as valid or invalid. |


---

## EduAI Integration Tests

**Path:** `apps/core/app/tests/integration/`

> _To be populated._

---

## AI Tutor Unit Tests

**Path:** `apps/extensions/ai-tutor/app/tests/unit/`

| Test file | What it tests |
|-----------|---------------|
| `useLocalUser.test.ts` | Auth context exposes the current user, allows login and logout, and throws when accessed outside its provider |
| `api.test.ts` | API calls reach the correct endpoints, return parsed responses, redirect to login on 401, and throw on server errors |
| `BugReportProvider.test.tsx` | Bug report context tracks the current page location and forwards screenshot and log capture helpers to consumers |
| `BugReportDialog.test.tsx`| Bug report form validates minimum description length, captures a screenshot on open, and submits the full diagnostic payload including context and anonymous flag |
| `BugReportsTab.test.tsx`| Admins can view, update status, and copy bug reports; anonymous submissions hide reporter identity in the copied output |
| `Nav.test.tsx` | The Report Bug button is visible to students and professors but hidden from admins |
| > _Keep adding from here._ | |

---

## AI Tutor Integration Tests

**Path:** `apps/extensions/ai-tutor/app/tests/integration/`

> _To be populated._

---

## AI Tutor Server Unit Tests

**Path:** `apps/extensions/ai-tutor/server/tests/integration/`

| Test file | What it tests |
|-----------|---------------|
| `activityAnalytics.test.js` | An activity's difficulty is calculated correctly from how often students ask for help, answer incorrectly, and rate it poorly, and the result is labeled LOW, MEDIUM, or HIGH based on defined thresholds |
| `activityEvaluation.test.js` | Student answers are marked correct or incorrect for multiple-choice and short-answer questions, and missing questions or answers return a null result rather than crashing |
| `aiGuidance.test.js` | Tutor prompts include the right question, options, and student answer for each question type; topic and knowledge-level placeholders are replaced correctly; and supervisor verdicts normalize missing or malformed fields to safe defaults |
| `aiModelPolicy.test.js` | Only models that are actually available can be selected, defaults fall back gracefully when the preferred model is missing, and the number of supervisor loop iterations is kept within a safe range |
| `mappers.test.js` | Sensitive fields like passwords are stripped before data leaves the server, IDs resolve correctly whether stored flat or nested, and missing optional fields default to safe values |
| > _Keep adding from here._ | |


> _To be populated._

---

## AI Tutor Server Integration Tests

**Path:** `apps/extensions/ai-tutor/server/tests/integration/`

| Test file | What it tests |
|-----------|---------------|
| `activities.test.js` | Students see completion status on activities while professors do not, answers are graded correctly, feedback requires a prior submission, and non-members and unenrolled users are blocked |
| `admin.test.js` | Admins can list users and courses, enroll and unenroll students, and view enrollment status; all admin endpoints reject non-admin users |
| `auth.test.js` | The current user is returned without their password, and admins are blocked from non-admin endpoints while retaining access to their own profile |
| `bugReport.test.js` | Students and professors can submit bug reports with or without page context, reports are rejected when the user has no access to the referenced course, anonymous reports hide the reporter's identity in admin responses, and admins can update report status |
| `courseCloning.test.js` | Cloning a course copies all modules, lessons, and activities in order, maps topics by name to the target course creating them when missing, and reuses existing topics on name collision |
| `courses.test.js` | Professors and students see the correct courses for their role, courses can be created and edited, and unpublishing a course cascades to its modules and lessons |
| `lessons.test.js` | Professors see all lessons including drafts while students only see published ones, lessons can be created and published, and publishing is blocked when the parent module is unpublished |
| `modules.test.js` | Professors see all modules including drafts while students only see published ones, modules can be created and published, and unpublishing cascades to lessons |
| `progressCalculation.test.js` | A student's progress at course, module, and lesson level counts only correct answers against published content, and the latest attempt takes precedence over earlier ones |
| `smoke.test.js` | The server is reachable and the health endpoint returns a healthy response |
| `topics.test.js` | Topics can be listed and created for authorized members, duplicate names and empty values are rejected, students cannot create topics, and activities can be remapped from one topic to another |
| > _Keep adding from here._ | |


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
