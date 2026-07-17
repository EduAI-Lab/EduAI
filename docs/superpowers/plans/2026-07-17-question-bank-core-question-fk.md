# Question Bank Core Question FK Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Core question-bank membership a real FK M2M to Core `Question`, and update QM (including Canvas hybrid pending/re-sync) + FE merge so only approved/pushed questions become bank members.

**Architecture:** Rewrite the unmerged `#1069` bank migration so `QuestionBankMembership.questionId` → `Question.id`. QM resolves membership via `Variants.coreQuestionId`. Canvas first import creates shells + Core bank without membership (pending overlay); re-sync auto-pushes then memberships. Origin fields on `Question` track app + LMS provenance.

**Tech Stack:** Prisma/Postgres (Core), Express/Sequelize (QM), React Router + `@eduai/ui` (QM FE), Vitest, session-cookie Core `POST /api/questions`.

**Spec:** `docs/superpowers/specs/2026-07-17-question-bank-core-question-fk-design.md`

## Global Constraints

- No production data under old `externalQuestionId` shape — **rewrite** migration `20260716120000_add_question_banks`, do not add a second backfill migration.
- Do not auto-push on manual “add to bank”; return **409** if no `coreQuestionId`.
- Canvas **first** import: no membership; **re-sync / existing target bank**: auto-push then membership.
- Prefer `Course.coreCourseId` for Core course resolution; keep code-match only as fallback if a course is unlinked.
- Finish the open merge conflicts as Task 0 before other FE work.
- Do not commit `pgvector/`.

## File map

| File | Responsibility |
|------|----------------|
| `apps/core/prisma/schema.prisma` | `QuestionBankMembership` FK model; `Question` origin + relation |
| `apps/core/prisma/migrations/20260716120000_add_question_banks/migration.sql` | Rewritten DDL |
| `apps/core/app/lib/question-banks/schemas.ts` | Zod: `{ questionId }` membership |
| `apps/core/app/lib/question-banks/server.ts` | Membership CRUD against `Question` |
| `apps/core/app/routes/api/courses.banks.$.ts` | HTTP shape for membership |
| `apps/core/app/lib/questions/server.ts` | Persist `source` / `externalId` / `externalSource` |
| `apps/extensions/question-maker/app/backend/src/services/questionBankService.js` | Require `coreQuestionId`; list merge pending |
| `apps/extensions/question-maker/app/backend/src/services/eduaiService.js` | Membership API client |
| `apps/extensions/question-maker/app/backend/src/services/coreWiringService.js` | Push payload origin fields |
| `apps/extensions/question-maker/app/backend/src/services/canvasService.js` | Hybrid import sequencing |
| `apps/extensions/question-maker/app/frontend/src/pages/CourseDetailPage.tsx` | Bank state + sync wiring |
| `apps/extensions/question-maker/app/frontend/src/components/question-bank/QuestionBank.tsx` | BankSelector + pending UI |

---

### Task 0: Finish merge conflicts (FE shell)

**Files:**
- Resolve: `apps/extensions/question-maker/app/frontend/src/components/question-bank/QuestionBank.tsx`
- Delete (take development): `apps/extensions/question-maker/app/frontend/src/pages/Homepage.tsx`
- Delete (take development): `apps/extensions/question-maker/app/frontend/src/components/question-bank/QuestionBankHeader.tsx`
- Keep: `BankSelector.tsx`, `CanvasBankSyncDialog.tsx`, `questionBankService.ts` (will wire in Task 6)

**Interfaces:**
- Produces: clean merge tree; development `QuestionBank` UI without bank props yet (props added in Task 6)

- [ ] **Step 1: Resolve modify/delete conflicts**

```bash
git rm -f "apps/extensions/question-maker/app/frontend/src/pages/Homepage.tsx"
git rm -f "apps/extensions/question-maker/app/frontend/src/components/question-bank/QuestionBankHeader.tsx"
```

- [ ] **Step 2: Take development `QuestionBank.tsx` as base**

Remove all conflict markers. Keep development’s `@eduai/ui` header + `compact` prop. Do **not** reintroduce `QuestionBankHeader` yet.

- [ ] **Step 3: Complete the merge commit**

```bash
git add -A
git status   # confirm no "Unmerged paths"
git commit -m "merge: integrate origin/development into feat/845-question-banks-canvas-sync"
```

Expected: merge commit succeeds; branch builds enough to continue Tasks 1+.

---

### Task 1: Core schema + rewritten migration

**Files:**
- Modify: `apps/core/prisma/schema.prisma` (`QuestionBankMembership`, `Question`)
- Rewrite: `apps/core/prisma/migrations/20260716120000_add_question_banks/migration.sql`
- Test: `apps/core/app/lib/question-banks/schemas.test.ts` (update later in Task 2)

**Interfaces:**
- Produces: Prisma models matching the approved spec

- [ ] **Step 1: Update `QuestionBankMembership` and `Question` in schema.prisma**

Replace membership model with:

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

On `Question`, add:

```prisma
  source         String?  @default("question-maker")
  externalId     String?
  externalSource String?
  bankMemberships QuestionBankMembership[]

  @@index([source])
  @@index([externalSource, externalId])
```

Update `QuestionBank` comment (remove externalQuestionId wording).

- [ ] **Step 2: Rewrite migration.sql**

```sql
-- CreateTable
CREATE TABLE "question_banks" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "question_banks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "question_bank_memberships" (
    "id" TEXT NOT NULL,
    "questionBankId" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "question_bank_memberships_pkey" PRIMARY KEY ("id")
);

-- Question origin columns (additive on existing questions table)
ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "source" TEXT DEFAULT 'question-maker';
ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "externalSource" TEXT;

CREATE INDEX "question_banks_courseId_isDefault_idx" ON "question_banks"("courseId", "isDefault");
CREATE INDEX "question_bank_memberships_questionId_idx" ON "question_bank_memberships"("questionId");
CREATE UNIQUE INDEX "question_bank_memberships_questionBankId_questionId_key" ON "question_bank_memberships"("questionBankId", "questionId");
CREATE INDEX "questions_source_idx" ON "questions"("source");
CREATE INDEX "questions_externalSource_externalId_idx" ON "questions"("externalSource", "externalId");

ALTER TABLE "question_banks" ADD CONSTRAINT "question_banks_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "question_bank_memberships" ADD CONSTRAINT "question_bank_memberships_questionBankId_fkey" FOREIGN KEY ("questionBankId") REFERENCES "question_banks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "question_bank_memberships" ADD CONSTRAINT "question_bank_memberships_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

Note: If local DBs already applied the old migration, reset that migration locally (`migrate reset` on a throwaway DB) — do not invent a second “fix” migration for #1069.

- [ ] **Step 3: Generate client**

```bash
cd apps/core
npx prisma generate
```

Expected: client generates without errors.

- [ ] **Step 4: Commit**

```bash
git add apps/core/prisma/schema.prisma apps/core/prisma/migrations/20260716120000_add_question_banks/migration.sql
git commit -m "feat(core): bank membership FK to Question + origin fields"
```

---

### Task 2: Core bank membership API (TDD)

**Files:**
- Modify: `apps/core/app/lib/question-banks/schemas.ts`
- Modify: `apps/core/app/lib/question-banks/server.ts`
- Modify: `apps/core/app/routes/api/courses.banks.$.ts`
- Modify: `apps/core/app/lib/question-banks/schemas.test.ts`
- Create: `apps/core/app/lib/question-banks/server.test.ts` (unit, mocked prisma) **or** extend existing Core test patterns under `apps/core/app/tests/`

**Interfaces:**
- Consumes: Prisma `Question` / `QuestionBankMembership`
- Produces:
  - `addQuestionToBank(courseId, bankId, { questionId })`
  - `removeQuestionFromBank(courseId, bankId, questionId)`
  - `listBankMemberships(courseId, bankId)` → `{ memberships: [{ id, questionId, question? }] }`

- [ ] **Step 1: Write failing schema/unit tests**

```ts
// schemas.test.ts
it("requires questionId for membership", () => {
  expect(AddBankMembershipSchema.safeParse({}).success).toBe(false);
  expect(AddBankMembershipSchema.safeParse({ questionId: "clxxx" }).success).toBe(true);
});

// server.test.ts (mock prisma)
it("rejects questionId from another course", async () => {
  // mock bank in course A, question in course B
  const result = await addQuestionToBank("courseA", "bank1", { questionId: "qB" });
  expect(result).toMatchObject({ error: expect.any(String) });
});

it("rejects soft-deleted question", async () => {
  // mock question.deletedAt = new Date()
  const result = await addQuestionToBank("courseA", "bank1", { questionId: "qDel" });
  expect("error" in result).toBe(true);
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd apps/core
npx vitest run app/lib/question-banks
```

- [ ] **Step 3: Implement schemas + server**

```ts
// schemas.ts
export const AddBankMembershipSchema = z.object({
  questionId: z.string().min(1),
});

// server.ts (addQuestionToBank core logic)
const question = await prisma.question.findFirst({
  where: { id: questionId, courseId, deletedAt: null },
});
if (!question) return { error: "Question not found in this course" } as const;

const membership = await prisma.questionBankMembership.upsert({
  where: { questionBankId_questionId: { questionBankId: bankId, questionId } },
  create: { questionBankId: bankId, questionId },
  update: {},
});
```

Remove `source` / `externalQuestionId` paths and last-membership-reassign-to-default that keyed off external ids (reassign logic is obsolete with FK-to-Question; deleting membership just removes the join).

`listBankMemberships`:

```ts
const memberships = await prisma.questionBankMembership.findMany({
  where: { questionBankId: bankId },
  include: { question: true },
  orderBy: { createdAt: "asc" },
});
return { memberships };
```

Update `courses.banks.$.ts` DELETE path: no `source` query param; path param is Core `questionId`.

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd apps/core
npx vitest run app/lib/question-banks
```

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(core): bank membership API uses Question.id"
```

---

### Task 3: Core `POST /api/questions` origin fields (TDD)

**Files:**
- Modify: `apps/core/app/lib/questions/server.ts`
- Modify: `apps/core/app/tests/unit/questions.server.test.ts`
- Modify: `apps/core/app/tests/integration/questions.integration.test.ts` (add one case)

**Interfaces:**
- Produces: `CreateQuestionBody` includes optional `source`, `externalId`, `externalSource`

- [ ] **Step 1: Failing unit test**

```ts
it("persists source and external origin when provided", async () => {
  // arrange mocks so create succeeds
  const result = await createQuestion(
    {
      ...baseBody,
      source: "question-maker",
      externalSource: "CANVAS",
      externalId: "99",
    },
    CREATOR,
  );
  expect(result).toEqual({ id: expect.any(String) });
  // assert prisma.question.create called with source/externalSource/externalId
});

it("defaults source to question-maker when omitted", async () => {
  await createQuestion(baseBody, CREATOR);
  // assert create data.source === "question-maker" OR relies on DB default
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/core
npx vitest run app/tests/unit/questions.server.test.ts
```

- [ ] **Step 3: Extend schema + create**

```ts
const CreateQuestionSchema = z.object({
  // ...existing...
  source: z.string().min(1).optional(),
  externalId: z.string().min(1).optional(),
  externalSource: z.string().min(1).optional(),
});

// in prisma.question.create data:
source: parsed.data.source ?? "question-maker",
externalId: parsed.data.externalId ?? null,
externalSource: parsed.data.externalSource ?? null,
```

- [ ] **Step 4: Run — expect PASS; commit**

```bash
git commit -am "feat(core): persist Question source and LMS external origin"
```

---

### Task 4: QM eduai + questionBankService require `coreQuestionId` (TDD)

**Files:**
- Modify: `apps/extensions/question-maker/app/backend/src/services/eduaiService.js`
- Modify: `apps/extensions/question-maker/app/backend/src/services/questionBankService.js`
- Modify: `apps/extensions/question-maker/app/backend/src/routes/course.js` (membership body)
- Create: `apps/extensions/question-maker/app/backend/tests/unit/questionBankService.coreId.test.js`

**Interfaces:**
- Consumes: `Variants.coreQuestionId`, Core membership API
- Produces:
  - `addQuestionToBank(localCourseId, ownerUserId, bankId, questionMetadataId)` → uses core id
  - 409 when no approved variant

- [ ] **Step 1: Failing unit test**

```js
it('rejects add when variant has no coreQuestionId', async () => {
  // mock Question_Metadata + Variants without coreQuestionId
  await expect(
    addQuestionToBank(1, 1, 'bank_core', 42)
  ).rejects.toMatchObject({ status: 409 });
});

it('posts coreQuestionId to Core membership API', async () => {
  // mock variant.coreQuestionId = 'cl_q1'
  // expect eduaiService.addQuestionBankMembership(coreCourseId, bankId, { questionId: 'cl_q1' })
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
cd apps/extensions/question-maker/app/backend
npx vitest run tests/unit/questionBankService.coreId.test.js
```

- [ ] **Step 3: Implement**

`eduaiService.addQuestionBankMembership(coreCourseId, bankId, { questionId })`  
`removeQuestionBankMembership(coreCourseId, bankId, questionId)` — drop `source` query.

`resolveCoreCourse`: if `localCourse.coreCourseId` set, use it; else existing code-match via `listCourses()`.

`addQuestionToBank`:

```js
const variant = await Variants.findOne({
  where: { questionMetadataId, coreQuestionId: { [Op.ne]: null } },
  order: [['updatedAt', 'DESC']],
});
if (!variant?.coreQuestionId) {
  throw Object.assign(
    new Error('Approve the question (push to Core) before adding it to a bank'),
    { status: 409 },
  );
}
await eduaiService.addQuestionBankMembership(coreCourseId, bankId, {
  questionId: variant.coreQuestionId,
});
```

`listExternalQuestionIdsForBank` → rename conceptually to resolve **local** metadata ids:

1. List Core memberships → Core question ids  
2. Find `Variants` where `coreQuestionId IN (...)` → metadata ids  
3. Union pending: `CanvasBankQuestionMapping` where `localBankId = bankId` and linked metadata has no `coreQuestionId` variant  

Expose helper `listLocalQuestionIdsForBank(localCourseId, ownerUserId, bankId)` returning `{ memberIds: number[], pendingIds: number[] }` for list filtering.

- [ ] **Step 4: Run — PASS; update integration mock in `questionBanks.integration.test.js` to use `{ questionId }`**

- [ ] **Step 5: Commit**

```bash
git commit -am "feat(qm): bank membership requires Variants.coreQuestionId"
```

---

### Task 5: Push origin fields + Canvas hybrid import (TDD)

**Files:**
- Modify: `apps/extensions/question-maker/app/backend/src/services/coreWiringService.js`
- Modify: `apps/extensions/question-maker/app/backend/src/services/canvasService.js`
- Modify: `apps/extensions/question-maker/app/backend/tests/unit/canvasBankClient.test.js`
- Create: `apps/extensions/question-maker/app/backend/tests/unit/pushVariantOrigin.test.js`
- Create: `apps/extensions/question-maker/app/backend/tests/unit/canvasBankImportHybrid.test.js`

**Interfaces:**
- Consumes: `pushVariantToCore`, `CanvasBankQuestionMapping`, `pushQuestionToCore` (session cookie)
- Produces: Canvas first import without membership; re-sync with push→membership

- [ ] **Step 1: Failing tests**

```js
// pushVariantOrigin.test.js
it('includes source question-maker and Canvas external fields when mapping exists', async () => {
  // mock CanvasBankQuestionMapping for metadata
  // spy pushQuestionToCore payload
  expect(payload).toMatchObject({
    source: 'question-maker',
    externalSource: 'CANVAS',
    externalId: '10',
  });
});

// canvasBankImportHybrid.test.js
it('first import creates mapping but does not call addQuestionBankMembership', async () => { ... });
it('re-sync with existing mapping pushes then adds membership', async () => { ... });
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement `pushVariantToCore` payload extras**

```js
const canvasMap = await CanvasBankQuestionMapping.findOne({
  where: { localQuestionMetadataId: qm.id },
});
const payload = {
  // ...existing fields...
  source: 'question-maker',
  ...(canvasMap
    ? {
        externalSource: 'CANVAS',
        externalId: String(canvasMap.canvasAssessmentQuestionId),
      }
    : {}),
};
```

Canvas `importQuestionBankFromCanvas`:

1. Resolve/create Core bank (existing `createBank` / `listBanks`).
2. Upsert `CanvasBankMapping` / per-question `CanvasBankQuestionMapping` with Core `localBankId`.
3. Create/update QM shell + variant as today.
4. **If** `existingMapping` or `options.targetBankId` (re-sync / explicit target):  
   - `pushVariantToCore(variant, course, cookieHeader)` — **requires** `course.coreCourseId` and caller cookie; if missing, fail with clear 400.  
   - `addQuestionToBank(..., metadataId)` using new path.  
5. **Else** (first import): skip push and membership.

Route layer must pass `req.headers.cookie` into import for the auto-push path.

- [ ] **Step 4: Run unit tests — PASS; commit**

```bash
git commit -am "feat(qm): Canvas hybrid push-before-membership + Question origin on push"
```

---

### Task 6: Frontend — CourseDetailPage bank wiring + pending UX

**Files:**
- Modify: `apps/extensions/question-maker/app/frontend/src/pages/CourseDetailPage.tsx`
- Modify: `apps/extensions/question-maker/app/frontend/src/components/question-bank/QuestionBank.tsx`
- Modify: `apps/extensions/question-maker/app/frontend/src/components/question-bank/BankSelector.tsx` (restyle to `@eduai/ui` if still on old radix wrappers)
- Modify: `apps/extensions/question-maker/app/frontend/src/services/questionBankService.ts`
- Modify: `apps/extensions/question-maker/app/frontend/src/services/questionService.ts` (ensure `coreQuestionId` on entries if exposed)
- Tests: `BankSelector.test.tsx`, `CanvasBankSyncDialog.test.tsx`

**Interfaces:**
- Consumes: `questionBankService.listBanks`, questions with `coreQuestionId` / pending flag
- Produces: bank filter + sync dialog on Questions tab

- [ ] **Step 1: Port bank state from old Homepage into `CourseDetailPage`**

State: `banks`, `selectedBankId: string | null`, localStorage key `home:last-selected-bank:${courseId}` (or rename to `course:last-selected-bank:`).

Load banks when course loads; pass `questionBankId` into `getQuestions` when selected.

Wire `CanvasBankSyncDialog` (open from Questions tab or Canvas tab — prefer Questions tab next to BankSelector, matching prior UX).

- [ ] **Step 2: Extend `QuestionBank` props (development UI + banks)**

```tsx
banks?: QuestionBankModel[];
selectedBankId?: string | null;
onBankChange?: (id: string | null) => void;
onCreateBank?: (name: string) => void;
onSyncFromCanvas?: () => void;
pendingQuestionIds?: Set<number> | number[];
```

Render `BankSelector` under the header. For cards whose question id is in `pendingQuestionIds`, show a “Pending approval” badge; disable “add to bank” if that action exists elsewhere without `coreQuestionId`.

- [ ] **Step 3: FE tests**

```bash
cd apps/extensions/question-maker/app/frontend
npx vitest run src/components/question-bank/BankSelector.test.tsx src/components/canvas/CanvasBankSyncDialog.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git commit -am "feat(qm-fe): wire Core banks into CourseDetailPage with pending overlay"
```

---

### Task 7: Integration tests + docs + PR push

**Files:**
- Modify: `apps/extensions/question-maker/app/backend/tests/integration/questionBanks.integration.test.js`
- Modify: `apps/extensions/question-maker/docs/TEST_PLAN.md`
- Optional Core integration test under `apps/core/app/tests/integration/` if harness allows bank routes

- [ ] **Step 1: Rewrite QM integration expectations**

- Seed/mock Core memberships with `{ questionId }`  
- Creating a question does **not** bank-member until a mocked `coreQuestionId` exists  
- Canvas re-sync test asserts push then membership; first import asserts pending-only mapping  

- [ ] **Step 2: Run targeted suites**

```bash
cd apps/extensions/question-maker/app/backend
npx vitest run tests/unit/questionBankService.coreId.test.js tests/unit/canvasBankImportHybrid.test.js tests/unit/pushVariantOrigin.test.js
# with TEST_DATABASE_URL:
npx vitest run --config vitest.integration.config.js tests/integration/questionBanks.integration.test.js
```

- [ ] **Step 3: Update TEST_PLAN.md rows for G5/G6/J3/J4**

- [ ] **Step 4: Commit + push**

```bash
git add apps/extensions/question-maker/docs/TEST_PLAN.md apps/extensions/question-maker/app/backend/tests
git commit -m "test(qm): cover Core Question bank membership and Canvas hybrid"
git push -u origin HEAD
```

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| Rewrite membership FK migration | 1 |
| `Question` origin fields | 1, 3 |
| Core add/remove/list membership API | 2 |
| QM 409 without `coreQuestionId` | 4 |
| Push sends source/external* | 5 |
| Canvas hybrid first vs re-sync | 5 |
| Pending overlay in bank UI | 4 (API list) + 6 (FE) |
| FE merge + CourseDetailPage | 0, 6 |
| Tests listed in spec | 2–5, 7 |

## Placeholder scan

No TBD/TODO steps; commands and signatures are concrete.

## Type consistency

- Membership body always `{ questionId: string }` (Core CUID).  
- QM routes may still accept `questionMetadataId` locally, then resolve to `coreQuestionId`.  
- Canvas `localBankId` remains Core bank CUID string.
