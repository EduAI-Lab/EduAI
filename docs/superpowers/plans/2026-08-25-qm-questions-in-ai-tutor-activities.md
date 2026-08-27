# QM Bank Questions in AI Tutor Activities — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an instructor build an AI Tutor activity from a question already in their Question Maker bank, instead of retyping it.

**Architecture:** An AI Tutor server endpoint proxies Core's existing testable-questions list (service key, GET) and enriches each question with its topic *name*. A pure mapping function turns a bank question into the draft the Add Activity form holds. The panel gains a "Start from" toggle whose bank mode lists those questions and prefills the form on selection. The activity keeps its own copy — nothing links back to Core at render time.

**Tech Stack:** Express 5 + Prisma (AI Tutor server), React Router v7 SPA (AI Tutor frontend), Vitest + supertest, Zod for upstream response validation.

**Spec:** `docs/superpowers/specs/2026-08-25-qm-questions-in-ai-tutor-activities-design.md`

## Global Constraints

- Only questions Core marks `testable=true` may appear — this is the "usable by other extensions" flag from #1555. Never widen the filter.
- Long-answer (`LA`) questions are excluded server-side and never reach the client.
- AI Tutor must **never create or modify `Topic` rows** here. `topicSync.js` owns that table and `POST /courses/:id/topics` rejects manual creation for imported courses. Topic resolution is read-only, by **name**, scoped to the course offering.
- The activity stores a **copy**. Do not add a foreign key, a source id column, or any render-time dependency on Core.
- All new server code is ESM (`import`, not `require`) and matches the file-header comment convention used across `server/src/routes/*.js`.
- Run backend tests from `apps/extensions/ai-tutor/server`, frontend tests from `apps/extensions/ai-tutor`.

---

## File Structure

| File | Responsibility |
|---|---|
| `server/src/services/bankQuestions.js` (create) | Fetch testable questions from Core, drop `LA`, attach `topicName`. The only place that talks to Core for this feature. |
| `server/src/routes/courses.js` (modify) | Mount `GET /courses/:courseId/bank-questions` with the existing course gate. |
| `server/tests/unit/bankQuestions.test.js` (create) | Service behaviour: LA exclusion, topic-name enrichment, Core failure. |
| `server/tests/unit/bankQuestionsRoute.test.js` (create) | Route behaviour: auth gate, query passthrough, upstream failure shape. |
| `app/lib/bankQuestionToActivityDraft.ts` (create) | Pure mapping from a bank question to the panel's draft. No React, no fetch. |
| `app/tests/unit/bankQuestionToActivityDraft.test.ts` (create) | Mapping across MCQ, SA, topic match, topic miss. |
| `app/components/AddActivityPanel.tsx` (modify) | "Start from" toggle, bank list, prefill-on-select, "From bank" chip. |
| `app/tests/unit/AddActivityPanel.bank-mode.test.tsx` (create) | Toggle reveals the list; selection prefills; clear resets. |

---

### Task 1: Bank questions service

**Files:**
- Create: `apps/extensions/ai-tutor/server/src/services/bankQuestions.js`
- Test: `apps/extensions/ai-tutor/server/tests/unit/bankQuestions.test.js`

**Interfaces:**
- Consumes: `listCourseTestableQuestions(coreOfferingId, { limit, offset })` and `listEduAiCourseTopics(coreOfferingId)` from `server/src/services/eduaiClient.js`.
- Produces: `listBankQuestions(coreOfferingId, { topicId, limit, offset })` → `Promise<Array<{ id, content, type, choices, answer, topicId, topicName, difficulty }>>`.

- [ ] **Step 1: Write the failing test**

```javascript
/**
 * The activity picker only ever shows questions an author marked usable by
 * other extensions (#1555), and an activity has no faithful representation of a
 * long-answer question — so LA is dropped before it can reach the panel.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const listCourseTestableQuestions = vi.fn();
const listEduAiCourseTopics = vi.fn();

vi.mock("../../src/services/eduaiClient.js", () => ({
  listCourseTestableQuestions: (...args) => listCourseTestableQuestions(...args),
  listEduAiCourseTopics: (...args) => listEduAiCourseTopics(...args),
}));

const { listBankQuestions } = await import("../../src/services/bankQuestions.js");

beforeEach(() => {
  vi.clearAllMocks();
  listEduAiCourseTopics.mockResolvedValue([
    { id: "core-t1", name: "Complexity" },
    { id: "core-t2", name: "Sorting" },
  ]);
  listCourseTestableQuestions.mockResolvedValue([
    { id: "q1", type: "MCQ", content: "What does Big-O measure?", topicId: "core-t1",
      choices: [{ letter: "A", text: "Time" }], answer: "A", difficulty: "MEDIUM" },
    { id: "q2", type: "LA", content: "Discuss amortised analysis", topicId: "core-t1",
      choices: null, answer: null, difficulty: "HARD" },
    { id: "q3", type: "SA", content: "Define a stable sort", topicId: "core-t2",
      choices: null, answer: "Preserves order", difficulty: "EASY" },
  ]);
});

describe("listBankQuestions", () => {
  it("drops long-answer questions, which an activity cannot represent", async () => {
    const result = await listBankQuestions("core-course-1", {});

    expect(result.map((q) => q.id)).toEqual(["q1", "q3"]);
  });

  it("names each question's topic, so the panel can match it without a per-question fetch", async () => {
    const result = await listBankQuestions("core-course-1", {});

    expect(result[0].topicName).toBe("Complexity");
    expect(result[1].topicName).toBe("Sorting");
    expect(listEduAiCourseTopics).toHaveBeenCalledTimes(1);
  });

  it("leaves topicName null when Core has no topic under that id", async () => {
    listEduAiCourseTopics.mockResolvedValue([]);

    const result = await listBankQuestions("core-course-1", {});

    expect(result[0].topicName).toBeNull();
  });

  it("passes paging and the topic filter through to Core", async () => {
    await listBankQuestions("core-course-1", { topicId: "core-t2", limit: 5, offset: 10 });

    expect(listCourseTestableQuestions).toHaveBeenCalledWith("core-course-1", {
      topicId: "core-t2",
      limit: 5,
      offset: 10,
    });
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd apps/extensions/ai-tutor/server && npx vitest run tests/unit/bankQuestions.test.js`
Expected: FAIL — cannot resolve `../../src/services/bankQuestions.js`.

- [ ] **Step 3: Extend the Core client to accept a topic filter**

`listCourseTestableQuestions` currently takes only `{ limit, offset }`. In
`server/src/services/eduaiClient.js`, add `topicId` and forward it only when
present — Core treats an absent `topicId` as "all topics", and sending an empty
string would filter everything out:

```javascript
export async function listCourseTestableQuestions(
  coreOfferingId,
  { limit = 20, offset = 0, topicId } = {},
) {
  const serviceKey = process.env.EDUAI_API_KEY;
  if (!serviceKey) {
    throw new Error("EDUAI_API_KEY not configured");
  }

  const params = new URLSearchParams({
    courseId: coreOfferingId,
    testable: "true",
    limit: String(limit),
    offset: String(offset),
  });
  if (topicId) params.set("topicId", topicId);

  // ... rest of the function unchanged
}
```

- [ ] **Step 4: Write the service**

```javascript
/**
 * @file Bank questions for the activity picker.
 *
 * Responsibility: the single place that reads Core's shared question bank for
 *   AI Tutor. Returns only questions an author marked usable by other
 *   extensions (Core `testable=true`, #1555).
 * Gotchas:
 *   - Long-answer questions are dropped here, not in the UI: an activity is
 *     MCQ or short answer, and relabelling LA as short answer would mislead
 *     both the student and the AI grading them.
 *   - Topic names are resolved from one course-wide topic fetch, never per
 *     question. AI Tutor topics are keyed by NAME (topicSync.js never writes
 *     coreTopicId), so the name is what the panel needs to match on.
 * Related: services/eduaiClient.js, services/topicSync.js
 */
import { listCourseTestableQuestions, listEduAiCourseTopics } from "./eduaiClient.js";

export async function listBankQuestions(coreOfferingId, { topicId, limit = 20, offset = 0 } = {}) {
  const [questions, topics] = await Promise.all([
    listCourseTestableQuestions(coreOfferingId, { topicId, limit, offset }),
    listEduAiCourseTopics(coreOfferingId),
  ]);

  const nameByTopicId = new Map(
    (topics || []).map((topic) => [String(topic.id), topic.name ?? null]),
  );

  return (questions || [])
    .filter((question) => question.type !== "LA")
    .map((question) => ({
      id: question.id,
      content: question.content,
      type: question.type,
      choices: question.choices ?? null,
      answer: question.answer ?? null,
      difficulty: question.difficulty ?? null,
      topicId: question.topicId ?? null,
      topicName: nameByTopicId.get(String(question.topicId)) ?? null,
    }));
}
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd apps/extensions/ai-tutor/server && npx vitest run tests/unit/bankQuestions.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/extensions/ai-tutor/server/src/services/bankQuestions.js \
        apps/extensions/ai-tutor/server/src/services/eduaiClient.js \
        apps/extensions/ai-tutor/server/tests/unit/bankQuestions.test.js
git commit -m "feat(ai-tutor): read the shared question bank for the activity picker"
```

---

### Task 2: Bank questions endpoint

**Files:**
- Modify: `apps/extensions/ai-tutor/server/src/routes/courses.js`
- Test: `apps/extensions/ai-tutor/server/tests/unit/bankQuestionsRoute.test.js`

**Interfaces:**
- Consumes: `listBankQuestions` from Task 1.
- Produces: `GET /api/courses/:courseId/bank-questions?topicId=&limit=&offset=` → `200 { questions }`, `403` for a non-instructor, `400` when the course has no `coreOfferingId`, `502` when Core fails.

- [ ] **Step 1: Read the surrounding conventions**

Open `server/src/routes/courses.js` and read one existing course-scoped
instructor route end to end (`POST /courses/:courseId/sync-enrollments` is a
good model). Copy its shape: `requireRole([...])`, numeric `courseId` parse,
`prisma.courseOffering.findUnique`, `isCourseAdmin`, the `coreOfferingId` guard,
and `respondEduAiUpstreamError` in the catch. Do not invent a new pattern.

- [ ] **Step 2: Write the failing test**

```javascript
/**
 * The picker is instructor-facing and reads another app's data, so the gate and
 * the upstream failure shape matter as much as the payload.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

const listBankQuestions = vi.fn();
const isCourseAdmin = vi.fn();

vi.mock("../../src/services/bankQuestions.js", () => ({
  listBankQuestions: (...args) => listBankQuestions(...args),
}));

vi.mock("../../src/middleware/auth.js", async () => {
  const actual = await vi.importActual("../../src/middleware/auth.js");
  return {
    ...actual,
    requireRole: () => (req, _res, next) => {
      req.user = { id: "instructor-1", role: "INSTRUCTOR" };
      next();
    },
    isCourseAdmin: (...args) => isCourseAdmin(...args),
  };
});

const { prisma } = await import("../../src/config/database.js");
const { default: app } = await import("../../src/app.js");

beforeEach(() => {
  vi.clearAllMocks();
  isCourseAdmin.mockResolvedValue(true);
  vi.spyOn(prisma.courseOffering, "findUnique").mockResolvedValue({
    id: 7,
    coreOfferingId: "core-course-1",
    instructors: [{ userId: "instructor-1" }],
  });
  listBankQuestions.mockResolvedValue([
    { id: "q1", content: "What does Big-O measure?", type: "MCQ", choices: null,
      answer: "A", difficulty: "MEDIUM", topicId: "core-t1", topicName: "Complexity" },
  ]);
});

describe("GET /api/courses/:courseId/bank-questions", () => {
  it("returns the course's shared questions", async () => {
    const res = await request(app).get("/api/courses/7/bank-questions");

    expect(res.status).toBe(200);
    expect(res.body.questions).toHaveLength(1);
    expect(res.body.questions[0].topicName).toBe("Complexity");
  });

  it("forwards the topic filter and paging", async () => {
    await request(app).get("/api/courses/7/bank-questions?topicId=core-t2&limit=5&offset=10");

    expect(listBankQuestions).toHaveBeenCalledWith("core-course-1", {
      topicId: "core-t2",
      limit: 5,
      offset: 10,
    });
  });

  it("refuses a caller who does not administer the course", async () => {
    isCourseAdmin.mockResolvedValue(false);

    const res = await request(app).get("/api/courses/7/bank-questions");

    expect(res.status).toBe(403);
    expect(listBankQuestions).not.toHaveBeenCalled();
  });

  it("explains that a course with no Core link has no bank", async () => {
    prisma.courseOffering.findUnique.mockResolvedValue({ id: 7, coreOfferingId: null, instructors: [] });

    const res = await request(app).get("/api/courses/7/bank-questions");

    expect(res.status).toBe(400);
  });

  it("does not report success when Core fails", async () => {
    const upstream = new Error("Core unreachable");
    upstream.status = 502;
    listBankQuestions.mockRejectedValue(upstream);

    const res = await request(app).get("/api/courses/7/bank-questions");

    expect(res.status).toBeGreaterThanOrEqual(500);
  });
});
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `cd apps/extensions/ai-tutor/server && npx vitest run tests/unit/bankQuestionsRoute.test.js`
Expected: FAIL — 404 from Express, because the route does not exist.

- [ ] **Step 4: Add the route**

Add to `server/src/routes/courses.js`, importing `listBankQuestions` at the top
alongside the other service imports:

```javascript
/**
 * `GET /courses/:courseId/bank-questions` — the shared question bank for the
 * activity picker.
 *
 * Auth: course admin (LEAD instructor / unit-admin / admin), same gate as the
 * other authoring routes.
 * Only EduAI-imported courses have a bank; a native course returns 400 rather
 * than a misleading empty list.
 */
router.get(
  "/courses/:courseId/bank-questions",
  requireRole(["INSTRUCTOR", "UNIT_ADMIN", "ADMIN"]),
  async (req, res) => {
    const authUser = req.user;
    const courseId = Number(req.params.courseId);
    if (!Number.isFinite(courseId)) {
      return res.status(400).json({ error: "Invalid course id" });
    }

    try {
      const course = await prisma.courseOffering.findUnique({
        where: { id: courseId },
        include: { instructors: { select: { userId: true } } },
      });
      if (!course) return res.status(404).json({ error: "Course not found" });
      if (!(await isCourseAdmin(authUser, course))) {
        return res.status(403).json({ error: "Not authorized for this course" });
      }
      if (!course.coreOfferingId) {
        return res.status(400).json({ error: "Course was not imported from EduAI" });
      }

      const limit = Number(req.query.limit) || 20;
      const offset = Number(req.query.offset) || 0;
      const questions = await listBankQuestions(course.coreOfferingId, {
        topicId: req.query.topicId || undefined,
        limit,
        offset,
      });
      res.json({ questions });
    } catch (error) {
      logSafeError("[eduai] Failed to list bank questions", error);
      return respondEduAiUpstreamError(res, error, "Unable to load the question bank");
    }
  },
);
```

- [ ] **Step 5: Run the test and watch it pass**

Run: `cd apps/extensions/ai-tutor/server && npx vitest run tests/unit/bankQuestionsRoute.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 6: Run the whole server unit suite for regressions**

Run: `cd apps/extensions/ai-tutor/server && npm run test:unit`
Expected: PASS. If a suite reports "skipped", check whether it needs a database
URL rather than assuming it is fine.

- [ ] **Step 7: Commit**

```bash
git add apps/extensions/ai-tutor/server/src/routes/courses.js \
        apps/extensions/ai-tutor/server/tests/unit/bankQuestionsRoute.test.js
git commit -m "feat(ai-tutor): expose the course question bank to instructors"
```

---

### Task 3: Bank question to activity draft

**Files:**
- Create: `apps/extensions/ai-tutor/app/lib/bankQuestionToActivityDraft.ts`
- Test: `apps/extensions/ai-tutor/app/tests/unit/bankQuestionToActivityDraft.test.ts`

**Alias:** AI Tutor resolves app imports with `~/` (vite-tsconfig-paths), never `@/`.

**Interfaces:**
- Consumes: nothing — pure.
- Produces:
  ```ts
  export interface BankQuestion {
    id: string; content: string; type: string;
    choices: Array<{ letter: string; text: string }> | null;
    answer: string | null; topicId: string | null; topicName: string | null;
  }
  export interface ActivityDraft {
    type: "MCQ" | "SHORT_TEXT";
    question: string;
    choices: string[];
    correct: number | null;
    answer: string;
    mainTopicId: string | null;
    unresolvedTopicName: string | null;
  }
  export function bankQuestionToActivityDraft(
    question: BankQuestion,
    topics: Array<{ id: string; name: string }>,
  ): ActivityDraft;
  ```

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * AI Tutor topics are matched by NAME: topicSync.js ensures topics by name and
 * never writes coreTopicId, so matching on the id would miss every synced topic
 * and duplicate topics that already exist.
 */
import { describe, expect, it } from "vitest";
import { bankQuestionToActivityDraft } from "~/lib/bankQuestionToActivityDraft";

const TOPICS = [
  { id: "local-1", name: "Complexity" },
  { id: "local-2", name: "Sorting" },
];

const MCQ = {
  id: "q1",
  content: "What does Big-O measure?",
  type: "MCQ",
  choices: [
    { letter: "A", text: "Growth rate" },
    { letter: "B", text: "Wall clock time" },
  ],
  answer: "A",
  topicId: "core-t1",
  topicName: "Complexity",
};

describe("bankQuestionToActivityDraft", () => {
  it("carries an MCQ across with its choices and correct answer", () => {
    const draft = bankQuestionToActivityDraft(MCQ, TOPICS);

    expect(draft.type).toBe("MCQ");
    expect(draft.question).toBe("What does Big-O measure?");
    expect(draft.choices).toEqual(["Growth rate", "Wall clock time"]);
    expect(draft.correct).toBe(0);
  });

  it("maps a short-answer question to SHORT_TEXT with its answer", () => {
    const draft = bankQuestionToActivityDraft(
      { ...MCQ, id: "q2", type: "SA", choices: null, answer: "Preserves order" },
      TOPICS,
    );

    expect(draft.type).toBe("SHORT_TEXT");
    expect(draft.choices).toEqual([]);
    expect(draft.correct).toBeNull();
    expect(draft.answer).toBe("Preserves order");
  });

  it("resolves the topic by name", () => {
    const draft = bankQuestionToActivityDraft(MCQ, TOPICS);

    expect(draft.mainTopicId).toBe("local-1");
    expect(draft.unresolvedTopicName).toBeNull();
  });

  it("reports an unmatched topic instead of guessing one", () => {
    const draft = bankQuestionToActivityDraft({ ...MCQ, topicName: "Graphs" }, TOPICS);

    expect(draft.mainTopicId).toBeNull();
    expect(draft.unresolvedTopicName).toBe("Graphs");
  });

  it("does not crash on an MCQ whose correct letter is missing", () => {
    const draft = bankQuestionToActivityDraft({ ...MCQ, answer: null }, TOPICS);

    expect(draft.correct).toBeNull();
    expect(draft.choices).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test and watch it fail**

Run: `cd apps/extensions/ai-tutor && npx vitest run app/tests/unit/bankQuestionToActivityDraft.test.ts`
Expected: FAIL — cannot resolve `~/lib/bankQuestionToActivityDraft`.

- [ ] **Step 3: Write the mapper**

```typescript
/**
 * Turns a shared bank question into the draft the Add Activity form holds.
 *
 * Pure on purpose: the panel's prefill is the part most likely to be wrong in a
 * way tests can catch, and it should be testable without rendering the panel.
 *
 * Topic matching is by NAME, not `coreTopicId`: `topicSync.js` ensures AI Tutor
 * topics by name and never writes `coreTopicId`, so the id would match nothing.
 * This function never creates a topic — for an imported course, sync owns that
 * table — it reports an unmatched name and lets the caller refresh and retry.
 */
export interface BankQuestion {
  id: string;
  content: string;
  type: string;
  choices: Array<{ letter: string; text: string }> | null;
  answer: string | null;
  topicId: string | null;
  topicName: string | null;
}

export interface ActivityDraft {
  type: "MCQ" | "SHORT_TEXT";
  question: string;
  choices: string[];
  correct: number | null;
  answer: string;
  mainTopicId: string | null;
  unresolvedTopicName: string | null;
}

export function bankQuestionToActivityDraft(
  question: BankQuestion,
  topics: Array<{ id: string; name: string }>,
): ActivityDraft {
  const isMcq = question.type === "MCQ";
  const choices = isMcq ? (question.choices ?? []) : [];
  const correctIndex = choices.findIndex((choice) => choice.letter === question.answer);
  const match = topics.find((topic) => topic.name === question.topicName);

  return {
    type: isMcq ? "MCQ" : "SHORT_TEXT",
    question: question.content,
    choices: choices.map((choice) => choice.text),
    correct: correctIndex >= 0 ? correctIndex : null,
    answer: isMcq ? "" : (question.answer ?? ""),
    mainTopicId: match ? match.id : null,
    unresolvedTopicName: match ? null : question.topicName,
  };
}
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd apps/extensions/ai-tutor && npx vitest run app/tests/unit/bankQuestionToActivityDraft.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/extensions/ai-tutor/app/lib/bankQuestionToActivityDraft.ts \
        apps/extensions/ai-tutor/app/tests/unit/bankQuestionToActivityDraft.test.ts
git commit -m "feat(ai-tutor): map a bank question onto an activity draft"
```

---

### Task 4: Bank mode in Add Activity

**Files:**
- Modify: `apps/extensions/ai-tutor/app/components/AddActivityPanel.tsx`
- Modify: `apps/extensions/ai-tutor/app/routes/instructor.lesson.tsx` (pass `courseOfferingId`, already computed at line 230)
- Test: `apps/extensions/ai-tutor/app/tests/unit/AddActivityPanel.bank-mode.test.tsx`

**Interfaces:**
- Consumes: `bankQuestionToActivityDraft` (Task 3) and `GET /api/courses/:courseId/bank-questions` (Task 2).
- Produces: no exported API change — `AddActivityPanel`'s props stay as they are.

- [ ] **Step 1: Read the panel first**

Open `app/components/AddActivityPanel.tsx` and find the existing state:
`type`, `question`, `choices`, `correct`, `hasSelectedCorrect`, `answer`, and
the main-topic state. The bank prefill sets exactly these — do not introduce a
parallel set of state for bank mode.

- [ ] **Step 2: Write the failing test**

Copy the harness from the two existing `AddActivityPanel.*.test.tsx` files —
the panel renders inside `CourseTopicsProvider` + `Dialog` + `DialogContent`,
topics come from the provider (not a prop), and `~/lib/api` is a **default**
export. Do not invent a different harness.

```tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog, DialogContent } from "@eduai/ui";
import type { CourseTopicsState } from "~/hooks/useCourseTopics";
import { CourseTopicsProvider } from "~/hooks/useCourseTopics";
import AddActivityPanel from "~/components/AddActivityPanel";

vi.mock("~/lib/api", () => ({
  default: {
    createActivity: vi.fn(),
    listBankQuestions: vi.fn(),
  },
}));

import api from "~/lib/api";

function topicsState(overrides: Partial<CourseTopicsState> = {}): CourseTopicsState {
  return {
    topics: [{ id: "local-1", name: "Complexity" }],
    total: 1,
    loading: false,
    error: null,
    refresh: vi.fn(),
    createTopic: vi.fn(),
    loadMore: vi.fn().mockResolvedValue(false),
    loadingMore: false,
    ...overrides,
  } as CourseTopicsState;
}

function renderPanel(state: CourseTopicsState = topicsState()) {
  return render(
    <CourseTopicsProvider value={state}>
      <Dialog open>
        <DialogContent>
          <AddActivityPanel lessonId={1} courseOfferingId={7} onActivityCreated={vi.fn()} />
        </DialogContent>
      </Dialog>
    </CourseTopicsProvider>,
  );
}

describe("AddActivityPanel bank mode (#1555 follow-up)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.listBankQuestions).mockResolvedValue([
      {
        id: "q1",
        content: "What does Big-O measure?",
        type: "MCQ",
        choices: [
          { letter: "A", text: "Growth rate" },
          { letter: "B", text: "Wall clock time" },
        ],
        answer: "A",
        topicId: "core-t1",
        topicName: "Complexity",
      },
    ]);
  });

  it("offers the manual path by default", () => {
    renderPanel();

    expect(screen.queryByTestId("bank-question-list")).toBeNull();
  });

  it("lists the course's shared questions in bank mode", async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("activity-source-bank"));

    expect(await screen.findByText("What does Big-O measure?")).toBeTruthy();
    expect(api.listBankQuestions).toHaveBeenCalledWith(7, expect.anything());
  });

  it("prefills the form from the chosen question", async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("activity-source-bank"));
    fireEvent.click(await screen.findByTestId("bank-question-q1"));

    await waitFor(() => {
      expect(screen.getByDisplayValue("What does Big-O measure?")).toBeTruthy();
    });
    expect(screen.getByDisplayValue("Growth rate")).toBeTruthy();
    expect(screen.getByTestId("bank-source-chip")).toBeTruthy();
  });

  it("clears the prefill and the chip together", async () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("activity-source-bank"));
    fireEvent.click(await screen.findByTestId("bank-question-q1"));
    await screen.findByTestId("bank-source-chip");

    fireEvent.click(screen.getByTestId("bank-source-clear"));

    expect(screen.queryByTestId("bank-source-chip")).toBeNull();
    expect(screen.queryByDisplayValue("What does Big-O measure?")).toBeNull();
  });

  it("says so when the bank is empty rather than showing a blank area", async () => {
    vi.mocked(api.listBankQuestions).mockResolvedValue([]);
    renderPanel();
    fireEvent.click(screen.getByTestId("activity-source-bank"));

    expect(await screen.findByText(/No shared questions/i)).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run the test and watch it fail**

Run: `cd apps/extensions/ai-tutor && npx vitest run app/tests/unit/AddActivityPanelBankMode.test.tsx`
Expected: FAIL — no `activity-source-bank` element, and TypeScript rejects the
new `courseOfferingId` prop until Step 4 adds it.

- [ ] **Step 4: Add the prop and the API client method**

`AddActivityPanel`'s real props are `lessonId`, `onActivityCreated`, `onCancel?`.
Add `courseOfferingId?: number | null` and pass it from
`app/routes/instructor.lesson.tsx`, which already computes `courseOfferingId` at
line 230 and already wraps the panel in `CourseTopicsProvider`. Offer bank mode
only when it is present.

Add the method to the existing **default-exported** client object in
`app/lib/api.ts`, matching the file's existing method style:

```typescript
async listBankQuestions(courseId: number, params: { topicId?: string; limit?: number; offset?: number } = {}) {
  const query = new URLSearchParams();
  if (params.topicId) query.set("topicId", params.topicId);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  const suffix = query.toString() ? `?${query}` : "";
  const data = await this.request(`/courses/${courseId}/bank-questions${suffix}`);
  return data.questions ?? [];
}
```

- [ ] **Step 5: Add the source toggle and the list**

In `AddActivityPanel.tsx`:

```tsx
// `topics` below comes from useCourseTopicsContext(), which the panel already calls.
const [source, setSource] = useState<"manual" | "bank">("manual");
const [bankQuestions, setBankQuestions] = useState<BankQuestion[]>([]);
const [bankState, setBankState] = useState<"idle" | "loading" | "error">("idle");
// Shown as a chip once a bank question is loaded; clearing it empties the form.
const [bankSource, setBankSource] = useState<{ id: string; label: string } | null>(null);

useEffect(() => {
  if (source !== "bank") return;
  let cancelled = false;
  setBankState("loading");
  api
    .listBankQuestions(courseOfferingId, { limit: 20 })
    .then((questions) => {
      if (cancelled) return;
      setBankQuestions(questions);
      setBankState("idle");
    })
    .catch(() => {
      if (!cancelled) setBankState("error");
    });
  return () => {
    cancelled = true;
  };
}, [source, courseOfferingId]);
```

Render the toggle above the existing fields, using the panel's existing
`SegmentedControl`, and give each control a `data-testid`
(`activity-source-manual` / `activity-source-bank`) and `data-state` of `on`/`off`.
In bank mode render the list in place of the prompt fields:

```tsx
{source === "bank" && !bankSource ? (
  <div data-testid="bank-question-list" className="space-y-2">
    {bankState === "loading" && <p className="text-sm text-muted-foreground">Loading…</p>}
    {bankState === "error" && (
      <p className="text-sm text-destructive">
        Could not load the question bank. Write the question yourself, or try again.
      </p>
    )}
    {bankState === "idle" && bankQuestions.length === 0 && (
      <p className="text-sm text-muted-foreground">
        No shared questions in this course yet. In Question Maker, tick “Usable by other
        EduAI extensions” on a reviewed question.
      </p>
    )}
    {bankQuestions.map((bankQuestion) => (
      <button
        key={bankQuestion.id}
        type="button"
        data-testid={`bank-question-${bankQuestion.id}`}
        onClick={() => applyBankQuestion(bankQuestion)}
        className="w-full rounded-[var(--radius-md)] border border-border p-2 text-left"
      >
        <span className="text-sm font-medium">{bankQuestion.content}</span>
        <span className="block text-xs text-muted-foreground">
          {bankQuestion.type === "MCQ" ? "MCQ" : "Short answer"}
          {bankQuestion.topicName ? ` · ${bankQuestion.topicName}` : ""}
        </span>
      </button>
    ))}
    <p className="text-xs text-muted-foreground">
      Long-answer questions are not shown — an activity is MCQ or short answer.
    </p>
  </div>
) : null}
```

- [ ] **Step 6: Apply and clear the selection**

```tsx
const applyBankQuestion = (bankQuestion: BankQuestion) => {
  const draft = bankQuestionToActivityDraft(bankQuestion, topics);
  setType(draft.type);
  setQuestion(draft.question);
  setChoices(draft.choices.length ? draft.choices.map((text) => ({ text })) : emptyChoices());
  setCorrect(draft.correct ?? 0);
  setHasSelectedCorrect(draft.correct !== null);
  setAnswer(draft.answer);
  if (draft.mainTopicId) setMainTopicId(draft.mainTopicId);
  setBankSource({ id: bankQuestion.id, label: bankQuestion.content });
};

const clearBankSource = () => {
  setBankSource(null);
  setQuestion("");
  setChoices(emptyChoices());
  setCorrect(0);
  setHasSelectedCorrect(false);
  setAnswer("");
};
```

Match `setChoices` and `emptyChoices` to the panel's real choice shape — read
the existing choice state before writing this. Render the chip when
`bankSource` is set, with `data-testid="bank-source-chip"` and a clear button
`data-testid="bank-source-clear"` calling `clearBankSource`.

- [ ] **Step 7: Handle an unmatched topic**

When `draft.unresolvedTopicName` is set, refresh the topic list once (the
`GET /courses/:id/topics` read auto-syncs from Core) and re-run the match. If it
still misses, leave `mainTopicId` as it was and show:

```tsx
{unresolvedTopic ? (
  <p className="text-xs text-muted-foreground">
    “{unresolvedTopic}” is not in this course’s topics yet — choose a main topic below.
  </p>
) : null}
```

Do not create the topic. `topicSync.js` owns that table and
`POST /courses/:id/topics` rejects manual creation for imported courses.

- [ ] **Step 8: Run the test and watch it pass**

Run: `cd apps/extensions/ai-tutor && npx vitest run app/tests/unit/AddActivityPanelBankMode.test.tsx`
Expected: PASS, 5 tests.

- [ ] **Step 9: Typecheck and run both suites**

```bash
cd apps/extensions/ai-tutor && npx tsc --noEmit && npm test
cd server && npm run test:unit
```
Expected: clean typecheck, all suites pass.

- [ ] **Step 10: Commit**

```bash
git add apps/extensions/ai-tutor/app/components/AddActivityPanel.tsx \
        apps/extensions/ai-tutor/app/lib/api.ts \
        apps/extensions/ai-tutor/app/tests/unit/AddActivityPanelBankMode.test.tsx
git commit -m "feat(ai-tutor): build an activity from a shared bank question"
```

---

### Task 5: Documentation

**Files:**
- Modify: `TESTS.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add the four new suites to TESTS.md**

Add one row per new test file, in the section covering its app, each linking the
path and describing in plain English what it pins:

- `bankQuestions.test.js` — LA exclusion, one-call topic-name enrichment, paging/filter passthrough.
- `bankQuestionsRoute.test.js` — instructor gate, filter forwarding, 400 for a course with no Core link, no success on Core failure.
- `bankQuestionToActivityDraft.test.ts` — MCQ/SA mapping, correct-answer index, topic matched by name, topic miss reported rather than guessed.
- `AddActivityPanelBankMode.test.tsx` — manual default, list in bank mode, prefill, clear, empty-bank state.

- [ ] **Step 2: Add a CHANGELOG entry**

Under the current week's `### Added`, in the file's house style
(`- [ai-tutor] feat: … (@you, YYYY-MM-DD) — [#PR](link)`): an instructor can
build an activity from a question already marked usable by other extensions in
Question Maker, instead of retyping it.

- [ ] **Step 3: Commit**

```bash
git add TESTS.md CHANGELOG.md
git commit -m "docs: record the activity question-bank picker"
```

---

## Self-Review

**Spec coverage**

| Spec requirement | Task |
|---|---|
| GET bank-questions endpoint, instructor gate, paging, topic filter | 2 |
| `testable=true` only | 1 (via `listCourseTestableQuestions`) |
| LA excluded server-side | 1 |
| Payload carries `topicName` | 1 |
| Fail-soft on Core failure | 1, 2, 4 (error state) |
| Pure mapping function | 3 |
| Topic matched by name, never created | 3, 4 (step 7) |
| Refresh-and-retry on a topic miss | 4 (step 7) |
| Source toggle, list, prefill, chip, clear | 4 |
| `EditActivityPanel` unchanged | no task — deliberate |
| Copy, not link (no schema change) | no task — no migration exists in this plan by design |
| Tests for server, mapping, UI | 1, 2, 3, 4 |
| TESTS.md / CHANGELOG | 5 |

**Placeholders:** none — every code step carries real code. Two steps
deliberately instruct the implementer to read existing state/prop names before
writing (Task 4 steps 1 and 6); that is a real instruction, not a TBD.

**Type consistency:** `BankQuestion` and `ActivityDraft` are defined in Task 3
and used with those exact field names in Task 4. `listBankQuestions` has the
same signature in Tasks 1, 2 and 4. `topicName` is produced in Task 1, returned
in Task 2, consumed in Tasks 3 and 4.

**Known risk:** Task 4's test renders the real `AddActivityPanel`, whose props
and choice-state shape were not read line-by-line while writing this plan. The
implementer is told to read them first and adjust the test's render call — the
component is the source of truth, not this plan.
