# Canvas LMS Import Guide

> This document used to be a pre-implementation feasibility analysis ("Import functionality is highly
> feasible..."). Canvas import is now fully implemented — two separate flows, both one-way
> (Canvas → Question Maker) and both proxied through EduAI Core (#1084), same as export. This document
> describes what's actually there.

## Two import flows

Question Maker has two distinct Canvas-import surfaces, each backed by its own dialog and route:

| Flow | UI | Route | Backend service |
|---|---|---|---|
| Import a **quiz** as a new assessment | `components/canvas/CanvasImportDialog.tsx` | `POST /api/canvas/import/:canvasCourseId/quizzes/:quizId` | `importQuizFromCanvas` in `services/canvasService.js` |
| Sync a Classic **question bank** | `components/canvas/CanvasBankSyncDialog.tsx` | `POST /api/canvas/import/:canvasCourseId/banks/:canvasBankId` | `importQuestionBankFromCanvas` in `services/canvasService.js` |

Both require: the caller to be INSTRUCTOR/UNIT_ADMIN/ADMIN with instructor-level access to the local
course (`middleware/courseAccess.js`), a working Canvas connection (proxied through Core), and the
local course to already be linked to a specific Canvas course
(`GET /api/canvas/mapping/:courseId` — there is no course picker in either dialog; both import *into*
the course you opened them from, *from* whatever Canvas course that course is mapped to). If there's
no mapping yet, both dialogs tell you to sync the course from Canvas first and stop.

## Flow 1 — Import a quiz

1. Open a course, go to its **Canvas** tab (only shown once the course is linked to Canvas), and
   click **"Import from Canvas"** — or trigger it from the Assessments tab / the assessment-variant
   workflow's "OCR upload / Import from Canvas" step.
2. Pick a quiz from the list (`GET /api/canvas/courses/:canvasCourseId/quizzes`, filtered to
   `quiz_type === "assignment"` or `"graded_survey"`).
3. Pick a **primary topic** — required; every imported question gets this one topic (there's no
   per-question topic mapping on import).
4. Confirm/edit the assessment name (prefilled from the quiz title) and type.
5. Click **"Import from Canvas"**.

What happens on the backend (`importQuizFromCanvas`):

- Verifies the local course's Canvas mapping matches the requested `canvasCourseId`.
- Fetches the quiz and its question list, then re-fetches each question **individually by id** (the
  list endpoint often returns `answers: null`) — a permission-denied response on that per-question
  fetch falls back to the list item rather than aborting the whole import.
- Creates one new `Assessments` row, one `AssessmentSections` row ("Imported Questions"), and one
  `QuestionMetadata` + `Variants` row per convertible question, linked into that section.
- Converts each Canvas question type: `multiple_choice_question`/`true_false_question` → MCQ (choices
  + correct letter reconstructed from Canvas's `answers` array, or parsed from `question_text` as a
  fallback when Canvas returns no structured answers), `essay_question` → LA, `short_answer_question`/
  `fill_in_multiple_blanks_question` → SA. Any other Canvas question type is **skipped**, not
  imported — the response reports `questionsSkipped` and a `skippedQuestions` array with each one's
  position/name/type/reason.
- **If any question fails to persist partway through**, the entire import (assessment, section,
  every question/variant already created) is rolled back and deleted — you never end up with a
  half-imported assessment.
- Records/updates the course's `CanvasCourseMapping` (first import establishes it if the course
  arrived unmapped through some other path).

## Flow 2 — Sync a Classic Canvas question bank

1. Open a course and choose **"Sync question bank"** (from the Banks tab, or the Course Detail
   "Sync from Canvas" action).
2. Pick a Canvas Assessment Question Bank (`GET /api/canvas/courses/:canvasCourseId/banks`).
3. Pick a **primary topic** and either an existing local bank or "Create bank from Canvas name".
4. Click **"Sync bank"**.

What happens on the backend (`importQuestionBankFromCanvas`):

- One Canvas bank maps to at most one local course per instructor
  (`CanvasBankMapping @@unique([userId, canvasBankId])`) — re-syncing the same bank into a different
  course is rejected.
- Lists every question in the bank (paginated, capped at 50 pages — a bank larger than that is
  reported as `truncated: true` rather than silently dropping the tail).
- For each Canvas assessment question: if it was synced before
  (`CanvasBankQuestionMapping`, keyed by `(userId, canvasAssessmentQuestionId, localCourseId)`),
  **updates** the existing local question/variant in place; otherwise **creates** a new one and
  records the mapping. This is what makes a re-sync idempotent instead of duplicating questions.
- Adds every synced question to the target local bank (`questionBankService.addQuestionsToBank`).
- A question whose type can't be converted, or that errors while persisting, is counted in `skipped`
  and logged — it does not fail the whole sync.
- Response: `{ bankId, created, updated, skipped, truncated, lastSyncedAt }`.

## What does **not** round-trip

- **Section structure** is not preserved on quiz import — every imported question lands in one
  "Imported Questions" section.
- **Topics beyond the one primary topic** you pick, difficulty, and reasoning level are not read from
  Canvas — they default (`difficulty: "medium"`) or are left for you to set afterward.
- **Reference/variant relationships** and **blueprint config** have no Canvas equivalent.
- Editing a question in Canvas after import/sync does not flow back automatically — a bank sync is
  the one path that *can* pick up Canvas-side edits, by re-syncing; quiz import is one-shot.

## Troubleshooting

- **"This course is not linked to a Canvas course"** — sync/link the course from Canvas first; neither
  dialog lets you pick a Canvas course ad hoc.
- **Questions skipped** — check `skippedQuestions` (quiz import) or the `skipped` count (bank sync);
  the reason is almost always an unsupported Canvas question type (matching, numerical, and most
  `fill_in_multiple_blanks_question` variants aren't converted).
- **"This Canvas question bank is already synced to another local course"** — a bank→course mapping
  is per-instructor and permanent; sync into the original course, or ask an instructor who owns that
  mapping.
- **Import failed partway through** — for a quiz import this is safe to retry: the partial rows are
  cleaned up automatically. If cleanup itself failed, the error explicitly says so and names what was
  left behind.
