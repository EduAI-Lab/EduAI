# Question Maker all-role end-user testing (#1429, #1530)

## Role and workflow coverage

Question Maker has four platform roles in its browser app: Student, Instructor, Unit Admin, and Admin. A course TA is represented by a Core enrollment role on a platform Student account; the Question Maker app intentionally keeps that account outside the authoring app.

The persisted browser workflows are in [`tests/e2e/tests/question-maker/all-roles-workflows.spec.ts`](../tests/e2e/tests/question-maker/all-roles-workflows.spec.ts):

| Role | Workflow | Result |
|---|---|---|
| Student | Open Question Maker | Clear `Access restricted` boundary; no authoring navigation exposed. |
| TA enrollment | Open Question Maker | Same explicit boundary; the UI directs teaching assistants to Core or AI Tutor. |
| Instructor | Open course → New question → AI assist → review generated content | Browser controls are available, but the live assigned-course run is blocked by #1532: both Generate and Save return a course-access denial. Provider response is mocked only at the proxy boundary in automation. |
| Unit Admin | Open Question Maker | Courses and Question Library are available; Bug reports is hidden because triage is Admin-only. |
| Admin | Open Question Maker | Courses, Question Library, and Bug reports are available. |

## Five required findings

1. **Does it make sense?** Students and TAs are given a direct explanation of where to go instead of seeing an empty authoring shell. The Instructor assessment/variant flow is course-centric and logical; Instructor question authoring and Canvas flows cannot yet be signed off because #1532 and #1533 block them.
2. **Is the UI clear?** The exercised labels are clear: `Access restricted`, `Generate question`, `Save question`, `Mark as reviewed`, and the role-specific navigation are understandable. The Student/TA boundary names the alternative products explicitly.
3. **Bugs found/fixed.** #1532 blocks Instructor generation and question save despite visible assigned courses. #1533 blocks Canvas test-mode connection with HTTP 400. Both are filed; neither is fixed by this UAT PR. Existing automated API coverage protects the corresponding backend role gates; this PR adds browser-level checks.
4. **Security.** Student and TA accounts do not enter the QM authoring UI. Unit Admins cannot see or directly navigate to Admin-only bug triage. The #1532 failure is fail-closed: no unauthorized Instructor question write occurred.
5. **Documentation.** This file and `docs/end-to-end-user-workflows/qm-workflows.md` record the role matrix, findings, blockers, and remaining workflow gaps; the persisted tests are listed in `TESTS.md`.

## Review and human-pass status

Self-review identified the main UI role split plus the highest-risk AI happy path. The required independent review and final gap sweep are still pending. Remaining deeper workflows—OCR upload/extraction, the complete assessment assembly/variant workflow, Canvas import/export, and Admin bug-report triage—still need their own browser tests before the Question Maker parent can be closed.

Live browser passes covered Admin dashboard/course/bug triage, Unit Admin course access and bug-triage boundary, and Instructor assessment/AI-variant workflows. The Instructor question authoring and Canvas paths were attempted and blocked by #1532 and #1533. Student and TA access boundaries were manually checked. The automated browser tests are not a substitute for the remaining human sign-off after the blockers are fixed.

The dev deployment run confirmed the Student access-boundary UI, but its public configuration does not expose the E2E promotion endpoint (`/api/e2e/promote` returned 404) and rate-limited the disposable-account burst. Instructor, TA, Unit Admin, and Admin automation therefore needs the repository's seeded E2E environment with `E2E_SEED_SECRET`, rather than the shared dev deployment.
