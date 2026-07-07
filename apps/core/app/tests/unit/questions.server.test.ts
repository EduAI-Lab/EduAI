import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("~/lib/prisma.server", () => {
  const mock = {
    course: { findUnique: vi.fn() },
    courseTopic: { findUnique: vi.fn(), findMany: vi.fn() },
    question: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    questionSecondaryTopic: { createMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return { default: mock };
});

import prisma from "~/lib/prisma.server";
import {
  createQuestion,
  listQuestions,
  getQuestionById,
  updateQuestionTestable,
} from "~/lib/questions/server";

const db = prisma as unknown as {
  course: { findUnique: ReturnType<typeof vi.fn> };
  courseTopic: { findUnique: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  question: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  questionSecondaryTopic: { createMany: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const CREATOR = "user-cuid-creator";
const COURSE_ID = "course-cuid-abc";
const TOPIC_ID = "topic-cuid-primary";
const SEC_TOPIC_ID = "topic-cuid-secondary";
const QUESTION_ID = "question-cuid-xyz";

const baseBody = {
  courseId: COURSE_ID,
  topicId: TOPIC_ID,
  content: "What is X?",
  type: "MCQ" as const,
  difficulty: "MEDIUM" as const,
  reasoningLevel: "FACTUAL" as const,
  choices: [{ letter: "A", text: "Answer" }],
  testable: false,
  secondaryTopicIds: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── createQuestion ──────────────────────────────────────────────────────────

describe("createQuestion", () => {
  it("returns COURSE_NOT_FOUND when course does not exist", async () => {
    db.course.findUnique.mockResolvedValue(null);
    expect(await createQuestion(baseBody, CREATOR)).toEqual({ error: "COURSE_NOT_FOUND" });
  });

  it("returns TOPIC_NOT_FOUND when primary topic does not exist", async () => {
    db.course.findUnique.mockResolvedValue({ id: COURSE_ID });
    db.courseTopic.findUnique.mockResolvedValue(null);
    expect(await createQuestion(baseBody, CREATOR)).toEqual({ error: "TOPIC_NOT_FOUND" });
  });

  it("returns TOPIC_NOT_FOUND when primary topic is soft-deleted", async () => {
    db.course.findUnique.mockResolvedValue({ id: COURSE_ID });
    db.courseTopic.findUnique.mockResolvedValue({ id: TOPIC_ID, deletedAt: new Date() });
    expect(await createQuestion(baseBody, CREATOR)).toEqual({ error: "TOPIC_NOT_FOUND" });
  });

  it("returns DUPLICATE_TOPIC when topicId also appears in secondaryTopicIds", async () => {
    db.course.findUnique.mockResolvedValue({ id: COURSE_ID });
    db.courseTopic.findUnique.mockResolvedValue({ id: TOPIC_ID, deletedAt: null });
    const result = await createQuestion({ ...baseBody, secondaryTopicIds: [TOPIC_ID] }, CREATOR);
    expect(result).toEqual({ error: "DUPLICATE_TOPIC", conflictingIds: [TOPIC_ID] });
  });

  it("returns INVALID_TOPIC_IDS with the deleted topic's id when a secondary topic is soft-deleted", async () => {
    db.course.findUnique.mockResolvedValue({ id: COURSE_ID });
    db.courseTopic.findUnique.mockResolvedValue({ id: TOPIC_ID, deletedAt: null });
    db.courseTopic.findMany.mockResolvedValue([{ id: SEC_TOPIC_ID, deletedAt: new Date() }]);
    const result = await createQuestion(
      { ...baseBody, secondaryTopicIds: [SEC_TOPIC_ID] },
      CREATOR
    );
    expect(result).toEqual({
      error: "INVALID_TOPIC_IDS",
      deletedTopicIds: [SEC_TOPIC_ID],
      conflictingWithPrimary: [],
    });
  });

  it("returns existing id on idempotency key replay and never opens a transaction", async () => {
    db.course.findUnique.mockResolvedValue({ id: COURSE_ID });
    db.courseTopic.findUnique.mockResolvedValue({ id: TOPIC_ID, deletedAt: null });
    db.question.findUnique.mockResolvedValue({ id: QUESTION_ID });

    const result = await createQuestion({ ...baseBody, idempotencyKey: "idem-key-abc" }, CREATOR);

    expect(result).toEqual({ id: QUESTION_ID });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("writes correct data to question.create inside the transaction", async () => {
    db.course.findUnique.mockResolvedValue({ id: COURSE_ID });
    db.courseTopic.findUnique.mockResolvedValue({ id: TOPIC_ID, deletedAt: null });
    db.courseTopic.findMany.mockResolvedValue([{ id: SEC_TOPIC_ID, deletedAt: null }]);
    db.question.findUnique.mockResolvedValue(null); // idempotency key not already used
    db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => {
      db.question.create.mockResolvedValue({ id: QUESTION_ID });
      db.questionSecondaryTopic.createMany.mockResolvedValue({ count: 1 });
      return fn(db);
    });

    const result = await createQuestion(
      { ...baseBody, secondaryTopicIds: [SEC_TOPIC_ID], idempotencyKey: "idem-new" },
      CREATOR
    );

    expect(result).toEqual({ id: QUESTION_ID });
    expect(db.$transaction).toHaveBeenCalledOnce();

    // Verify question.create received the right data — including createdBy and idempotencyKey
    const createData = db.question.create.mock.calls[0][0].data;
    expect(createData.createdBy).toBe(CREATOR);
    expect(createData.courseId).toBe(COURSE_ID);
    expect(createData.topicId).toBe(TOPIC_ID);
    expect(createData.content).toBe("What is X?");
    expect(createData.idempotencyKey).toBe("idem-new");

    // Verify secondary topics are written with the correct question id
    expect(db.questionSecondaryTopic.createMany).toHaveBeenCalledWith({
      data: [{ questionId: QUESTION_ID, topicId: SEC_TOPIC_ID }],
    });
  });

  it("returns VALIDATION_ERROR for a malformed body (missing content, bad enum)", async () => {
    const result = await createQuestion(
      { ...baseBody, content: "", type: "ESSAY" },
      CREATOR
    );
    expect(result).toMatchObject({ error: "VALIDATION_ERROR" });
    const fields = (result as { fields: Record<string, string> }).fields;
    expect(fields).toHaveProperty("content");
    expect(fields).toHaveProperty("type");
    // validation short-circuits before any DB access
    expect(db.course.findUnique).not.toHaveBeenCalled();
  });

  it("returns INVALID_TOPIC_IDS when a secondary topic id does not exist at all (no FK 500)", async () => {
    db.course.findUnique.mockResolvedValue({ id: COURSE_ID });
    db.courseTopic.findUnique.mockResolvedValue({ id: TOPIC_ID, deletedAt: null });
    // findMany returns nothing — the requested secondary id is absent in Core
    db.courseTopic.findMany.mockResolvedValue([]);
    const result = await createQuestion(
      { ...baseBody, secondaryTopicIds: ["ghost-topic"] },
      CREATOR
    );
    expect(result).toEqual({
      error: "INVALID_TOPIC_IDS",
      deletedTopicIds: ["ghost-topic"],
      conflictingWithPrimary: [],
    });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("recovers from an idempotency-key race (P2002) by returning the existing id", async () => {
    db.course.findUnique.mockResolvedValue({ id: COURSE_ID });
    db.courseTopic.findUnique.mockResolvedValue({ id: TOPIC_ID, deletedAt: null });
    // First idempotency check finds nothing; a concurrent request commits before
    // our create, so the transaction throws P2002, then the recovery lookup hits.
    db.question.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: QUESTION_ID });
    db.$transaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", {
        code: "P2002",
        clientVersion: "5.0.0",
      })
    );

    const result = await createQuestion(
      { ...baseBody, idempotencyKey: "idem-race" },
      CREATOR
    );

    expect(result).toEqual({ id: QUESTION_ID });
  });

  it("does NOT call createMany when secondaryTopicIds is empty", async () => {
    db.course.findUnique.mockResolvedValue({ id: COURSE_ID });
    db.courseTopic.findUnique.mockResolvedValue({ id: TOPIC_ID, deletedAt: null });
    db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => {
      db.question.create.mockResolvedValue({ id: QUESTION_ID });
      return fn(db);
    });

    await createQuestion(baseBody, CREATOR); // baseBody has secondaryTopicIds: []

    expect(db.$transaction).toHaveBeenCalledOnce();
    expect(db.questionSecondaryTopic.createMany).not.toHaveBeenCalled();
  });
});

// ─── listQuestions ───────────────────────────────────────────────────────────

describe("listQuestions", () => {
  it("returns questions with the correct total, limit, and offset shape", async () => {
    const fakeQuestion = { id: QUESTION_ID, courseId: COURSE_ID, testable: false, secondaryTopics: [] };
    db.question.findMany.mockResolvedValue([fakeQuestion]);
    db.question.count.mockResolvedValue(1);

    const result = await listQuestions({ courseId: COURSE_ID });

    expect(result).toEqual({ questions: [fakeQuestion], total: 1, limit: 100, offset: 0 });
    const whereArg = db.question.findMany.mock.calls[0][0].where;
    expect(whereArg.courseId).toBe(COURSE_ID);
    expect(whereArg.deletedAt).toBeNull();
  });

  it("applies topicId filter when provided", async () => {
    db.question.findMany.mockResolvedValue([]);
    db.question.count.mockResolvedValue(0);

    await listQuestions({ courseId: COURSE_ID, topicId: TOPIC_ID });

    const whereArg = db.question.findMany.mock.calls[0][0].where;
    expect(whereArg.topicId).toBe(TOPIC_ID);
  });

  it("applies testable: true filter", async () => {
    db.question.findMany.mockResolvedValue([]);
    db.question.count.mockResolvedValue(0);

    await listQuestions({ courseId: COURSE_ID, testable: true });

    expect(db.question.findMany.mock.calls[0][0].where.testable).toBe(true);
  });

  it("applies testable: false filter — false is a real value, not omitted", async () => {
    db.question.findMany.mockResolvedValue([]);
    db.question.count.mockResolvedValue(0);

    await listQuestions({ courseId: COURSE_ID, testable: false });

    expect(db.question.findMany.mock.calls[0][0].where.testable).toBe(false);
  });

  it("omits topicId from WHERE when not provided", async () => {
    db.question.findMany.mockResolvedValue([]);
    db.question.count.mockResolvedValue(0);

    await listQuestions({ courseId: COURSE_ID });

    const whereArg = db.question.findMany.mock.calls[0][0].where;
    expect("topicId" in whereArg).toBe(false);
  });

  it("clamps limit to 500", async () => {
    db.question.findMany.mockResolvedValue([]);
    db.question.count.mockResolvedValue(0);

    const result = await listQuestions({ courseId: COURSE_ID, limit: 999 });

    expect(result.limit).toBe(500);
    expect(db.question.findMany.mock.calls[0][0].take).toBe(500);
  });

  it("honours offset", async () => {
    db.question.findMany.mockResolvedValue([]);
    db.question.count.mockResolvedValue(50);

    const result = await listQuestions({ courseId: COURSE_ID, offset: 20 });

    expect(result.offset).toBe(20);
    expect(db.question.findMany.mock.calls[0][0].skip).toBe(20);
  });

  // #315: ADMIN forensics opt-in. Gating to ADMIN happens at the route layer;
  // the service honours the flag once passed.
  it("excludes soft-deleted questions by default (deletedAt: null)", async () => {
    db.question.findMany.mockResolvedValue([]);
    db.question.count.mockResolvedValue(0);

    await listQuestions({ courseId: COURSE_ID });

    expect(db.question.findMany.mock.calls[0][0].where.deletedAt).toBeNull();
  });

  it("includes soft-deleted questions when includeDeleted is true (deletedAt omitted)", async () => {
    db.question.findMany.mockResolvedValue([]);
    db.question.count.mockResolvedValue(0);

    await listQuestions({ courseId: COURSE_ID, includeDeleted: true });

    expect("deletedAt" in db.question.findMany.mock.calls[0][0].where).toBe(false);
  });
});

// ─── getQuestionById ─────────────────────────────────────────────────────────

describe("getQuestionById", () => {
  it("returns null when question not found", async () => {
    db.question.findFirst.mockResolvedValue(null);
    expect(await getQuestionById("nonexistent")).toBeNull();
  });

  it("returns the question when found", async () => {
    const fakeQuestion = { id: QUESTION_ID, secondaryTopics: [] };
    db.question.findFirst.mockResolvedValue(fakeQuestion);
    expect(await getQuestionById(QUESTION_ID)).toBe(fakeQuestion);
  });

  it("queries with deletedAt: null so soft-deleted questions are invisible", async () => {
    db.question.findFirst.mockResolvedValue(null);
    await getQuestionById(QUESTION_ID);
    expect(db.question.findFirst.mock.calls[0][0].where).toEqual({
      id: QUESTION_ID,
      deletedAt: null,
    });
  });

  // #315: ADMIN forensics opt-in surfaces a soft-deleted question by id.
  it("omits deletedAt from the where clause when includeDeleted is true", async () => {
    db.question.findFirst.mockResolvedValue(null);
    await getQuestionById(QUESTION_ID, true);
    expect(db.question.findFirst.mock.calls[0][0].where).toEqual({ id: QUESTION_ID });
  });
});

// ─── updateQuestionTestable ──────────────────────────────────────────────────

describe("updateQuestionTestable", () => {
  it("returns { id, testable } on success", async () => {
    db.question.update.mockResolvedValue({ id: QUESTION_ID, testable: true });
    expect(await updateQuestionTestable(QUESTION_ID, true)).toEqual({ id: QUESTION_ID, testable: true });
  });

  it("updates using the correct id and testable value", async () => {
    db.question.update.mockResolvedValue({ id: QUESTION_ID, testable: false });
    await updateQuestionTestable(QUESTION_ID, false);
    expect(db.question.update.mock.calls[0][0]).toMatchObject({
      where: { id: QUESTION_ID },
      data: { testable: false },
    });
  });

  it("returns null on P2025 (question not found)", async () => {
    const err = new Prisma.PrismaClientKnownRequestError("not found", {
      code: "P2025",
      clientVersion: "5.0.0",
    });
    db.question.update.mockRejectedValue(err);
    expect(await updateQuestionTestable("ghost-id", false)).toBeNull();
  });

  it("re-throws non-P2025 errors", async () => {
    db.question.update.mockRejectedValue(new Error("db gone"));
    await expect(updateQuestionTestable(QUESTION_ID, true)).rejects.toThrow("db gone");
  });

  it("guards against soft-deleted questions — where clause includes deletedAt: null", async () => {
    db.question.update.mockResolvedValue({ id: QUESTION_ID, testable: true });
    await updateQuestionTestable(QUESTION_ID, true);
    expect(db.question.update.mock.calls[0][0].where).toEqual({
      id: QUESTION_ID,
      deletedAt: null,
    });
  });
});
