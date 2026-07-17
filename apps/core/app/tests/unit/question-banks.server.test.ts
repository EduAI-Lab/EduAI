/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  questionBank: {
    findFirst: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  question: { findFirst: vi.fn() },
  questionBankMembership: {
    count: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
  course: { findUnique: vi.fn() },
}));

vi.mock("~/lib/prisma.server", () => ({
  default: prismaMock,
}));

import {
  addQuestionToBank,
  deleteQuestionBank,
  listBankMemberships,
  listMembershipsForQuestion,
  removeQuestionFromBank,
} from "~/lib/question-banks/server";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("addQuestionToBank", () => {
  it("rejects a questionId from another course", async () => {
    prismaMock.questionBank.findFirst.mockResolvedValue({
      id: "bank1",
      courseId: "courseA",
    });
    prismaMock.question.findFirst.mockResolvedValue({
      id: "question-in-course-b",
      courseId: "courseB",
      deletedAt: null,
    });

    const result = await addQuestionToBank("courseA", "bank1", {
      questionId: "question-in-course-b",
    });

    expect(result).toMatchObject({
      error: "Question not found in this course",
    });
    expect(prismaMock.question.findFirst).toHaveBeenCalledWith({
      where: {
        id: "question-in-course-b",
        courseId: "courseA",
        deletedAt: null,
      },
    });
    expect(prismaMock.questionBankMembership.upsert).not.toHaveBeenCalled();
  });

  it("rejects a soft-deleted question", async () => {
    prismaMock.questionBank.findFirst.mockResolvedValue({
      id: "bank1",
      courseId: "courseA",
    });
    prismaMock.question.findFirst.mockResolvedValue({
      id: "deleted-question",
      courseId: "courseA",
      deletedAt: new Date(),
    });

    const result = await addQuestionToBank("courseA", "bank1", {
      questionId: "deleted-question",
    });

    expect(result).toMatchObject({
      error: "Question not found in this course",
    });
    expect(prismaMock.question.findFirst).toHaveBeenCalledWith({
      where: {
        id: "deleted-question",
        courseId: "courseA",
        deletedAt: null,
      },
    });
    expect(prismaMock.questionBankMembership.upsert).not.toHaveBeenCalled();
  });

  it("upserts membership by bank and Core question id", async () => {
    prismaMock.questionBank.findFirst.mockResolvedValue({
      id: "bank1",
      courseId: "courseA",
    });
    prismaMock.question.findFirst.mockResolvedValue({
      id: "question1",
      courseId: "courseA",
      deletedAt: null,
    });
    prismaMock.questionBankMembership.upsert.mockResolvedValue({
      id: "membership1",
      questionBankId: "bank1",
      questionId: "question1",
    });

    const result = await addQuestionToBank("courseA", "bank1", {
      questionId: "question1",
    });

    expect(result).toEqual({
      membership: {
        id: "membership1",
        questionBankId: "bank1",
        questionId: "question1",
      },
    });
    expect(prismaMock.questionBankMembership.upsert).toHaveBeenCalledWith({
      where: {
        questionBankId_questionId: {
          questionBankId: "bank1",
          questionId: "question1",
        },
      },
      create: {
        questionBankId: "bank1",
        questionId: "question1",
      },
      update: {},
    });
  });
});

describe("removeQuestionFromBank", () => {
  it("removes the join without reassigning a last membership", async () => {
    prismaMock.questionBank.findFirst.mockResolvedValue({
      id: "bank1",
      courseId: "courseA",
    });
    prismaMock.questionBankMembership.findUnique.mockResolvedValue({
      id: "membership1",
      questionBankId: "bank1",
      questionId: "question1",
    });

    const result = await removeQuestionFromBank(
      "courseA",
      "bank1",
      "question1",
    );

    expect(result).toEqual({ removed: true });
    expect(prismaMock.questionBankMembership.findUnique).toHaveBeenCalledWith({
      where: {
        questionBankId_questionId: {
          questionBankId: "bank1",
          questionId: "question1",
        },
      },
    });
    expect(prismaMock.questionBankMembership.delete).toHaveBeenCalledWith({
      where: { id: "membership1" },
    });
    expect(prismaMock.questionBankMembership.count).not.toHaveBeenCalled();
    expect(prismaMock.questionBankMembership.create).not.toHaveBeenCalled();
  });
});

describe("listBankMemberships", () => {
  it("includes each membership's Core question", async () => {
    prismaMock.questionBank.findFirst.mockResolvedValue({
      id: "bank1",
      courseId: "courseA",
    });
    const memberships = [
      {
        id: "membership1",
        questionId: "question1",
        question: { id: "question1" },
      },
    ];
    prismaMock.questionBankMembership.findMany.mockResolvedValue(memberships);

    await expect(
      listBankMemberships("courseA", "bank1"),
    ).resolves.toEqual({ memberships });
    expect(prismaMock.questionBankMembership.findMany).toHaveBeenCalledWith({
      where: { questionBankId: "bank1" },
      include: { question: true },
      orderBy: { createdAt: "asc" },
    });
  });
});

describe("listMembershipsForQuestion", () => {
  it("filters by Core question id and course", async () => {
    prismaMock.questionBankMembership.findMany.mockResolvedValue([]);

    await listMembershipsForQuestion("courseA", "question1");

    expect(prismaMock.questionBankMembership.findMany).toHaveBeenCalledWith({
      where: {
        questionId: "question1",
        questionBank: { courseId: "courseA" },
      },
      include: { questionBank: true },
    });
  });
});

describe("deleteQuestionBank", () => {
  it("moves memberships using questionId", async () => {
    prismaMock.questionBank.findFirst
      .mockResolvedValueOnce({
        id: "bank1",
        courseId: "courseA",
        isDefault: false,
      })
      .mockResolvedValueOnce({
        id: "bank2",
        courseId: "courseA",
        isDefault: true,
      });
    prismaMock.questionBankMembership.count.mockResolvedValue(1);
    prismaMock.questionBankMembership.findMany.mockResolvedValue([
      { id: "membership1", questionId: "question1" },
    ]);

    await expect(
      deleteQuestionBank("courseA", "bank1", {
        moveMembershipsToBankId: "bank2",
      }),
    ).resolves.toEqual({ success: true });
    expect(prismaMock.questionBankMembership.upsert).toHaveBeenCalledWith({
      where: {
        questionBankId_questionId: {
          questionBankId: "bank2",
          questionId: "question1",
        },
      },
      create: {
        questionBankId: "bank2",
        questionId: "question1",
      },
      update: {},
    });
  });
});
