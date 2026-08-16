# Question Maker all-role end-user testing (#1429, #1530)

## Role and workflow coverage

Question Maker has four platform roles in its browser app: Student, Instructor, Unit Admin, and Admin. A course TA is represented by a Core enrollment role on a platform Student account; the Question Maker app intentionally keeps that account outside the authoring app.

The persisted browser workflows are in [`tests/e2e/tests/question-maker/all-roles-workflows.spec.ts`](../tests/e2e/tests/question-maker/all-roles-workflows.spec.ts):

| Role | Workflow | Result |
|---|---|---|
| Student | Open Question Maker | Clear `Access restricted` boundary; no authoring navigation exposed. |
| TA enrollment | Open Question Maker | Same explicit boundary; the UI directs teaching assistants to Core or AI Tutor. |
| Instructor | Open course → New question → AI assist → review generated content | Prompt, generated stem, choices, review checkbox, and save action are available; provider response is mocked only at the proxy boundary in automation. |
| Unit Admin | Open Question Maker | Courses and Question Library are available; Bug reports is hidden because triage is Admin-only. |
| Admin | Open Question Maker | Courses, Question Library, and Bug reports are available. |

## Five required findings

1. **Does it make sense?** Yes. Students and TAs are given a direct explanation of where to go instead of seeing an empty authoring shell. Instructors and administrators can follow the course-centric authoring flow and use AI to draft a question before reviewing and saving it.
2. **Is the UI clear?** The exercised labels are clear: `Access restricted`, `Generate question`, `Save question`, `Mark as reviewed`, and the role-specific navigation are understandable. The Student/TA boundary names the alternative products explicitly.
3. **Bugs found/fixed.** No new defect was reproduced in this pass. Existing automated API coverage already protects the corresponding backend role gates; this adds the missing browser-level checks.
4. **Security.** Student and TA accounts do not enter the QM authoring UI. Unit Admins cannot see the Admin-only Bug reports navigation. Instructor AI generation is course-scoped and the test does not grant Instructor access to the Admin-only surface.
5. **Documentation.** This file records the role matrix and findings, and the test is listed in `TESTS.md`.

## Review and human-pass status

Self-review and gap sweep identified the main UI role split plus the highest-risk AI happy path. Remaining deeper workflows—OCR upload/extraction, assessment assembly and variants, Canvas import/export, and Admin bug-report triage—still need their own browser tests before the Question Maker parent can be closed.

The live Admin session was manually walked through Dashboard → Courses → COSC 101 → New question. The course workspace showed question/assessment/topic counts and clear `Add question`, `New assessment`, and `Import from Canvas` actions. The AI composer exposed question type, prompt, model, metadata, review, and save controls. The Student, TA, Instructor, and Unit Admin role-specific paths still require human sign-off with matching live accounts; the automated browser tests are not a substitute for that pass.

The dev deployment run confirmed the Student access-boundary UI, but its public configuration does not expose the E2E promotion endpoint (`/api/e2e/promote` returned 404) and rate-limited the disposable-account burst. Instructor, TA, Unit Admin, and Admin automation therefore needs the repository's seeded E2E environment with `E2E_SEED_SECRET`, rather than the shared dev deployment.
