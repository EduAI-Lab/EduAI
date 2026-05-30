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
11. [AI Tutor Server Unit Tests](#ai-tutor-server-unit-tests)
12. [AI Tutor Server Integration Tests](#ai-tutor-server-integration-tests)
13. [Question Maker Unit Tests](#question-maker-unit-tests)
14. [Question Maker Integration Tests](#question-maker-integration-tests)
15. [Extending This Document](#extending-this-document)

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

- There may be some differences because of how some apps are structured, look at the path information to see where tests are stored

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
| `ai-schemas.test.ts`| AI provider and model schemas reject missing required fields, invalid URLs, negative pricing, and unknown enum values, and apply the correct defaults when optional fields are omitted |
| `auth-schemas.test.ts`| Tests that auth schemas validate credentials, enforce password matching, and restrict role values across sign-in, sign-up, reset, and user management flows. |
| `chat-api-keys.schema.test.ts` | Validates `clientApiKeysBodySchema` and `toUserProviderSettings` coercion defaults for chat `apiKeys` body parsing. |
| `chat-rag.test.ts` | Tests `buildCappedRagContextText` and `capRagHitsForTool` chunk/char caps for hybrid and tool RAG paths. |
| `courses-schemas.test.ts`| Tests that course schemas require non-empty fields, reject fractional years, and enforce that topic deletion specifies at least one identifier. |
| `embedding.test.ts` | Tests that chunk generation returns no chunks for empty input, keeps short content as one chunk, never produces chunks that exceed the size limit, applies word overlap between adjacent chunks, and handles punctuation-free input without throwing. |
| `file-processing.test.ts` | Tests that text sanitization removes invalid characters and normalises whitespace, checksums are stable and unique, file validation enforces allowed types and the 50 MB limit, semantic chunking splits content at logical boundaries without producing empty or oversized chunks, and file extraction strips the extension and computes the checksum from sanitized content. |
| `form-utils.test.ts` | Form validation errors are reported per field, combined into one message when multiple fields fail, and fields signal valid/invalid correctly |
| `LoginForm.test.tsx`| The login form renders all inputs and buttons correctly, shows field-level error messages with error styling, and disables all inputs and updates the button label while signing in |
| `RegisterForm.test.tsx`| The register form renders all four fields and buttons correctly, shows field-level error messages with error styling on each input, and disables all inputs and updates the button label while creating an account |
| `use-api-keys.test.ts` | Tests that the useApiKeys hook hydrates from localStorage, persists and removes provider settings, and correctly identifies which providers are fully configured. |
| `use-mobile.test.ts` | Tests that useIsMobile returns the correct breakpoint state on mount, updates when the viewport changes, and removes its listener on unmount. |
| `utils.test.ts` | Tests that the cn() utility merges conflicting Tailwind classes, drops falsy values, and handles conditional objects and nested arrays. |

---

## EduAI Integration Tests

**Path:** `apps/core/app/tests/integration/`

> _To be populated._

---

## AI Tutor Unit Tests

**Path:** `apps/extensions/ai-tutor/app/tests/unit/`

| Test file | What it tests |
|-----------|---------------|
| `api.test.ts` | Unauthorized requests redirect to the login page, server errors surface as exceptions, and successful requests return parsed data |
| `BugReportDialog.test.tsx` | The bug report form rejects descriptions that are too short, takes a screenshot on open, and submits diagnostic data including the reporter's anonymous preference |
| `BugReportProvider.test.tsx` | Page location and diagnostic capture tools are available to any component that needs to file a bug report |
| `BugReportsTab.test.tsx` | Admins can view, update status, and copy bug reports; anonymous submissions hide reporter identity in the copied output |
| `Nav.test.tsx` | The Report Bug button is visible to students and professors but hidden from admins |
| `useLocalUser.test.tsx` | Users can log in, log out, and have their session available across the app; accessing the session outside its provider throws an error |

---

## AI Tutor Integration Tests

**Path:** `apps/extensions/ai-tutor/app/tests/integration/`

> _To be populated._

---

## AI Tutor Server Unit Tests

**Path:** `apps/extensions/ai-tutor/server/tests/unit/`

| Test file | What it tests |
|-----------|---------------|
| `activityAnalytics.test.js` | An activity's difficulty is calculated correctly from how often students ask for help, answer incorrectly, and rate it poorly, and the result is labeled LOW, MEDIUM, or HIGH based on defined thresholds |
| `activityEvaluation.test.js` | Student answers are marked correct or incorrect for multiple-choice and short-answer questions, and missing questions or answers return a null result rather than crashing |
| `aiGuidance.test.js` | Tutor prompts include the right question, options, and student answer for each question type; topic and knowledge-level placeholders are replaced correctly; and supervisor verdicts normalize missing or malformed fields to safe defaults |
| `aiModelPolicy.test.js` | Only models that are actually available can be selected, defaults fall back gracefully when the preferred model is missing, and the number of supervisor loop iterations is kept within a safe range |
| `mappers.test.js` | Sensitive fields like passwords are stripped before data leaves the server, IDs resolve correctly whether stored flat or nested, and missing optional fields default to safe values |

---

## AI Tutor Server Integration Tests

**Path:** `apps/extensions/ai-tutor/server/tests/integration/`

| Test file | What it tests |
|-----------|---------------|
| `activities.test.js` | Students see completion status on activities while professors do not, answers are graded correctly, feedback requires a prior submission, and non-members and unenrolled users are blocked |
| `admin.test.js` | Admins can list users and courses, enroll and unenroll students, and view enrollment status; all admin endpoints reject non-admin users |
| `auth.test.js` | The current user is returned without their password, and admins are blocked from non-admin endpoints while retaining access to their own profile |
| `bugReports.test.js` | Students and professors can submit bug reports with or without page context, reports are rejected when the user has no access to the referenced course, anonymous reports hide the reporter's identity in admin responses, and admins can update report status |
| `courseCloning.test.js` | Cloning a course copies all modules, lessons, and activities in order, maps topics by name to the target course creating them when missing, and reuses existing topics on name collision |
| `courses.test.js` | Professors and students see the correct courses for their role, courses can be created and edited, and unpublishing a course cascades to its modules and lessons |
| `lessons.test.js` | Professors see all lessons including drafts while students only see published ones, lessons can be created and published, and publishing is blocked when the parent module is unpublished |
| `modules.test.js` | Professors see all modules including drafts while students only see published ones, modules can be created and published, and unpublishing cascades to lessons |
| `progressCalculation.test.js` | A student's progress at course, module, and lesson level counts only correct answers against published content, and the latest attempt takes precedence over earlier ones |
| `smoke.test.js` | The server is reachable and the health endpoint returns a healthy response |
| `topics.test.js` | Topics can be listed and created for authorized members, duplicate names and empty values are rejected, students cannot create topics, and activities can be remapped from one topic to another |

---

## Question Maker Unit Tests

**Path:** `apps/extensions/question-maker/app/backend/tests/unit`

| Test file | What it tests |
|-----------|---------------|
| `aiExtract.test.js` | The AI extraction service returns an empty result immediately when the input text is blank or whitespace, without calling any external service |
| `aiExtractEduaiMocked.test.js` | Questions are extracted and structured correctly from text when the AI service and database are replaced with fakes |
| `assessmentVariantMetadataScoring.test.js` | Questions are scored for how well their metadata matches a slot's requirements, with each matching attribute contributing the correct weight |
| `authService.test.js` | Valid tokens grant access, expired tokens are rejected, and tampered tokens are detected |
| `canvasExport.test.js` | MCQ answer choices are parsed correctly from text, and question payloads are built in the format Canvas expects |
| `canvasExportMocked.test.js` | Assessments are exported to Canvas correctly when the Canvas API, database, and integration lookup are replaced with fakes |
| `encryption.test.js` | Encrypted values round-trip back to the original string, and edge cases like empty input are handled without errors |
| `extraction.test.js` | Question text is split into individual blocks at numbered boundaries and chunked so multipart questions are never split across chunks |

---

## Question Maker Integration Tests

**Path:** `apps/extensions/question-maker/app/backend/tests/integration/`

| Test file | What it tests |
|-----------|---------------|
| `assessmentVariantAuth.test.js` | All assessment variant routes reject unauthenticated requests |
| `assessmentsAuth.test.js` | All assessment routes reject unauthenticated requests |
| `assessmentVariantHttp.integration.test.js` | Assessment variant routes reject requests with missing or invalid required fields |
| `auth.integration.test.js` | Users can register, log in, and retrieve their profile; duplicate emails and wrong passwords are rejected |
| `bugReports.integration.test.js` | Authenticated users can submit bug reports, only admins can list and update them, and unauthenticated requests are blocked |
| `canvasAuth.test.js` | All Canvas integration routes reject unauthenticated requests |
| `courseAuth.test.js` | All course and topic routes reject unauthenticated requests |
| `eduaiAuth.test.js` | All EduAI proxy routes reject unauthenticated requests |
| `eduaiHttpValidation.integration.test.js` | EduAI chat and question-generation routes reject requests with missing required fields |
| `health.test.js` | The health and root endpoints respond correctly when the server is running |
| `planCoverage.integration.test.js` | Users cannot access another user's courses, saved questions persist correctly, and variant assembly rotates picks fairly across runs without repeating the baseline |
| `questionAssessments.integration.test.js` | Questions and assessments can be created and retrieved, invalid inputs are rejected, and variants can be added to questions |
| `questionsAuth.test.js` | All question and extraction routes reject unauthenticated requests |
| `questionsExtractValidation.integration.test.js` | The question extraction and save endpoints reject requests with missing or invalid text, courseId, or question list |

---

## Question Maker Frontend Unit Tests

**Path:** `apps/extensions/question-maker/app/frontend/src/tests/unit/`

| Test file | What it tests |
|-----------|---------------|
| `LoginPage.test.tsx` | The login page submits credentials, shows errors, switches to registration, renders loading state, and redirects authenticated users |

---

## Question Maker Frontend Integration Tests

**Path:** `apps/extensions/question-maker/app/frontend/src/tests/integration/`

| Test file | What it tests |
|-----------|---------------|
| `api.test.ts` | The axios client sends Authorization headers, clears auth on `401`, and redirects to `/login` without looping |

---

## Extending This Document

If a new extension is added to the platform or a new category of tests is introduced, update this file to match:

1. **Update the Structure section** — add the new directory to the folder tree and the summary table so the layout stays accurate.
2. **Add a new entry to the Table of Contents** — follow the same naming convention used for existing entries (e.g. `<Extension Name> Unit Tests`, `<Extension Name> Integration Tests`).
3. **Add the corresponding section** — place it after the existing test sections, include the **Path** line, and start with `> _To be populated._` until tests are written.

Keep naming, formatting, and ordering consistent with what is already here.
