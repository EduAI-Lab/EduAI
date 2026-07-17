# Design: Question bank membership → Core `Question` FK

**Date:** 2026-07-17  
**PR:** #1069 (`feat/845-question-banks-canvas-sync`, closes #845)  
**Status:** Approved (Approach 1)

## Problem

PR #1069 added Core `QuestionBank` / `QuestionBankMembership`, but membership keyed off QM’s local `Question_Metadata.id` via `externalQuestionId` + `source`. That bypasses Core’s canonical `Question` table and the existing push-on-approval pipeline (`Variants.coreQuestionId` ← `POST /api/questions`).

Banks could reference unpublished drafts, and Core had no FK into its own `questions` table.

## Goals

- Membership is a real M2M between `QuestionBank` and Core `Question` (FK + cascade).
- Only approved/pushed questions (`Question.id`) can be bank members (enforced in Core).
- Canvas Classic bank sync still creates QM shells for review; membership requires a Core question.
- Hybrid Canvas UX: first import shows **pending** in the bank UI without membership; re-sync to an existing mapped bank auto-pushes then memberships.

## Non-goals

- Moving question content solely into Core (QM keeps authoring; push on approval unchanged in spirit).
- Changing AI Tutor.
- Changing approval workflow for normally authored questions (no silent auto-push on “add to bank”).

## Decisions

| Topic | Choice |
|-------|--------|
| Architecture | Approach 1: Core FK membership + QM pending overlay |
| Canvas first import | Create/link Core bank + shells; no membership; show pending in bank UI |
| Canvas re-sync (existing mapping / target bank) | Auto-push to Core then create membership |
| Pending visibility | Overlay via `CanvasBankQuestionMapping` rows for that Core bank lacking `Variants.coreQuestionId` |
| Course resolution | Prefer `Course.coreCourseId`; code-match fallback only if still required |

## Data model (Core)

Rewrite migration `apps/core/prisma/migrations/20260716120000_add_question_banks/migration.sql` (no production data under old shape).

```prisma
model QuestionBankMembership {
  id             String       @id @default(cuid())
  questionBankId String
  questionId     String
  createdAt      DateTime     @default(now())
  questionBank   QuestionBank @relation(fields: [questionBankId], references: [id], onDelete: Cascade)
  question       Question     @relation(fields: [questionId], references: [id], onDelete: Cascade)

  @@unique([questionBankId, questionId])
  @@index([questionId])
  @@map("question_bank_memberships")
}
```

On `Question`:

- `bankMemberships QuestionBankMembership[]`
- `source String? @default("question-maker")`
- `externalId String?`
- `externalSource String?`
- indexes on `[source]` and `[externalSource, externalId]`

Semantics:

- **`source`**: EduAI app that pushed (`question-maker`, later `ai-tutor` / `core`).
- **`externalId` / `externalSource`**: LMS origin only (e.g. `CANVAS` + Canvas assessment question id). Independent of `source`.

## Core API

- `POST .../banks/:bankId/questions` body: `{ questionId: string }`. Validate question exists, `courseId` matches, `deletedAt` is null.
- `DELETE .../banks/:bankId/questions/:questionId` — drop `source` query param.
- `GET` memberships: return joined question rows (or ids + fields needed by QM).
- `POST /api/questions`: accept and persist `source`, `externalId`, `externalSource` (default source `question-maker`).

## QM behavior

- `addQuestionToBank` / `removeQuestionFromBank`: require a variant with `coreQuestionId`; otherwise **409** with clear message (do not auto-push).
- Push path (`pushVariantToCore` / `pushQuestionToCore`): send `source: "question-maker"`; if Canvas-imported, set `externalSource: "CANVAS"` and `externalId` from `CanvasBankQuestionMapping`.
- Canvas import: keep `CanvasBankQuestionMapping.localQuestionMetadataId` for dedupe; store Core bank id in `localBankId`.
- Bank question list in QM: Core memberships resolved to local variants via `coreQuestionId`, **plus** pending mapped shells for that bank.

## Frontend

- Finish merge against `development`: remove orphan `Homepage` / `QuestionBankHeader`; port bank controls into `CourseDetailPage` + development `QuestionBank`.
- Add-to-bank disabled without `coreQuestionId` + tooltip.
- Pending Canvas imports visible under the bank with a pending indicator.

## Testing

- Core: reject unknown / wrong-course / deleted `questionId`; persist origin fields on create.
- QM: 409 without `coreQuestionId`; Canvas push includes external fields; pending overlay + re-sync push-before-membership.

## Out of scope for this change

- AI Tutor bank usage.
- Backfill of old external-id memberships (none in production).
