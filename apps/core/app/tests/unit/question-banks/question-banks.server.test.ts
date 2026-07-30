/**
 * @vitest-environment node
 *
 * Unit tests for Core question-bank server helpers (mocked Prisma).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  questionBank: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  questionBankMembership: {
    count: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    upsert: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
  course: {
    findUnique: vi.fn(),
  },
}));

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

import {
  addQuestionToBank,
  createQuestionBank,
  deleteQuestionBank,
  ensureDefaultBank,
  listBankMemberships,
  listMembershipsForQuestion,
  listQuestionBanks,
  removeQuestionFromBank,
  updateQuestionBank,
} from "~/lib/question-banks/server";

const COURSE_ID = "course_cuid_1";
const DEFAULT_BANK = {
  id: "bank_default",
  courseId: COURSE_ID,
  name: "Course bank",
  isDefault: true,
};
const EXTRA_BANK = {
  id: "bank_extra",
  courseId: COURSE_ID,
  name: "Extra",
  isDefault: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ensureDefaultBank", () => {
  it("returns the existing default bank", async () => {
    prismaMock.questionBank.findFirst.mockResolvedValue(DEFAULT_BANK);

    await expect(ensureDefaultBank(COURSE_ID)).resolves.toEqual(DEFAULT_BANK);
    expect(prismaMock.questionBank.create).not.toHaveBeenCalled();
  });

  it("creates a default bank when missing", async () => {
    prismaMock.questionBank.findFirst.mockResolvedValue(null);
    prismaMock.questionBank.create.mockResolvedValue(DEFAULT_BANK);

    await expect(ensureDefaultBank(COURSE_ID)).resolves.toEqual(DEFAULT_BANK);
    expect(prismaMock.questionBank.create).toHaveBeenCalledWith({
      data: {
        courseId: COURSE_ID,
        name: "Course bank",
        isDefault: true,
      },
    });
  });
});

describe("listQuestionBanks", () => {
  it("ensures a default bank then returns course banks", async () => {
    prismaMock.questionBank.findFirst.mockResolvedValue(DEFAULT_BANK);
    prismaMock.questionBank.findMany.mockResolvedValue([DEFAULT_BANK, EXTRA_BANK]);

    await expect(listQuestionBanks(COURSE_ID)).resolves.toEqual([
      DEFAULT_BANK,
      EXTRA_BANK,
    ]);
  });
});

describe("createQuestionBank", () => {
  it("rejects invalid input", async () => {
    const result = await createQuestionBank(COURSE_ID, { name: "  " });
    expect(result).toMatchObject({ error: "Invalid input" });
  });

  it("rejects when the course is missing", async () => {
    prismaMock.course.findUnique.mockResolvedValue(null);
    const result = await createQuestionBank(COURSE_ID, { name: "Midterm" });
    expect(result).toEqual({ error: "Course not found" });
  });

  it("creates a non-default bank after ensuring the default exists", async () => {
    prismaMock.course.findUnique.mockResolvedValue({ id: COURSE_ID });
    prismaMock.questionBank.findFirst.mockResolvedValue(DEFAULT_BANK);
    prismaMock.questionBank.create.mockResolvedValue(EXTRA_BANK);

    const result = await createQuestionBank(COURSE_ID, {
      name: " Extra ",
      description: "Prep",
    });

    expect(result).toEqual({ bank: EXTRA_BANK });
    expect(prismaMock.questionBank.create).toHaveBeenCalledWith({
      data: {
        courseId: COURSE_ID,
        name: "Extra",
        description: "Prep",
        isDefault: false,
      },
    });
  });
});

describe("deleteQuestionBank", () => {
  it("refuses to delete the default bank", async () => {
    prismaMock.questionBank.findFirst.mockResolvedValue(DEFAULT_BANK);
    const result = await deleteQuestionBank(COURSE_ID, DEFAULT_BANK.id);
    expect(result).toEqual({ error: "Cannot delete the default question bank" });
  });

  it("requires a move target when the bank still has memberships", async () => {
    prismaMock.questionBank.findFirst.mockResolvedValue(EXTRA_BANK);
    prismaMock.questionBankMembership.count.mockResolvedValue(2);

    const result = await deleteQuestionBank(COURSE_ID, EXTRA_BANK.id);
    expect(result).toMatchObject({
      error: expect.stringContaining("moveMembershipsToBankId"),
    });
  });

  it("deletes an empty non-default bank", async () => {
    prismaMock.questionBank.findFirst.mockResolvedValue(EXTRA_BANK);
    prismaMock.questionBankMembership.count.mockResolvedValue(0);
    prismaMock.questionBank.delete.mockResolvedValue(EXTRA_BANK);

    await expect(deleteQuestionBank(COURSE_ID, EXTRA_BANK.id)).resolves.toEqual({
      success: true,
    });
  });
});

describe("addQuestionToBank", () => {
  it("rejects invalid membership input", async () => {
    const result = await addQuestionToBank(COURSE_ID, EXTRA_BANK.id, {
      source: "question-maker",
    } as never);
    expect(result).toMatchObject({ error: "Invalid input" });
  });

  it("upserts membership for a valid bank", async () => {
    prismaMock.questionBank.findFirst.mockResolvedValue(EXTRA_BANK);
    const membership = {
      id: "mem_1",
      questionBankId: EXTRA_BANK.id,
      source: "question-maker",
      externalQuestionId: "42",
    };
    prismaMock.questionBankMembership.upsert.mockResolvedValue(membership);

    const result = await addQuestionToBank(COURSE_ID, EXTRA_BANK.id, {
      externalQuestionId: "42",
      source: "question-maker",
    });

    expect(result).toEqual({ membership });
  });

  it("returns not found when the bank is missing", async () => {
    prismaMock.questionBank.findFirst.mockResolvedValue(null);
    const result = await addQuestionToBank(COURSE_ID, "missing", {
      externalQuestionId: "42",
      source: "question-maker",
    });
    expect(result).toEqual({ error: "Question bank not found" });
  });
});

describe("updateQuestionBank", () => {
  it("rejects invalid input", async () => {
    const result = await updateQuestionBank(COURSE_ID, EXTRA_BANK.id, {
      name: "  ",
    });
    expect(result).toMatchObject({ error: "Invalid input" });
  });

  it("returns not found when the bank is missing", async () => {
    prismaMock.questionBank.findFirst.mockResolvedValue(null);
    const result = await updateQuestionBank(COURSE_ID, "missing", {
      name: "Renamed",
    });
    expect(result).toEqual({ error: "Question bank not found" });
  });

  it("updates name and description", async () => {
    prismaMock.questionBank.findFirst.mockResolvedValue(EXTRA_BANK);
    const updated = { ...EXTRA_BANK, name: "Renamed", description: "Prep" };
    prismaMock.questionBank.update.mockResolvedValue(updated);

    const result = await updateQuestionBank(COURSE_ID, EXTRA_BANK.id, {
      name: " Renamed ",
      description: "Prep",
    });

    expect(result).toEqual({ bank: updated });
    expect(prismaMock.questionBank.update).toHaveBeenCalledWith({
      where: { id: EXTRA_BANK.id },
      data: { name: "Renamed", description: "Prep" },
    });
  });
});

describe("deleteQuestionBank with membership move", () => {
  it("moves memberships then deletes the bank", async () => {
    prismaMock.questionBank.findFirst
      .mockResolvedValueOnce(EXTRA_BANK)
      .mockResolvedValueOnce(DEFAULT_BANK);
    prismaMock.questionBankMembership.count.mockResolvedValue(1);
    prismaMock.questionBankMembership.findMany.mockResolvedValue([
      {
        id: "mem_1",
        questionBankId: EXTRA_BANK.id,
        source: "question-maker",
        externalQuestionId: "42",
      },
    ]);
    prismaMock.questionBankMembership.upsert.mockResolvedValue({});
    prismaMock.questionBankMembership.deleteMany.mockResolvedValue({
      count: 1,
    });
    prismaMock.questionBank.delete.mockResolvedValue(EXTRA_BANK);

    const result = await deleteQuestionBank(COURSE_ID, EXTRA_BANK.id, {
      moveMembershipsToBankId: DEFAULT_BANK.id,
    });

    expect(result).toEqual({ success: true });
    expect(prismaMock.questionBankMembership.upsert).toHaveBeenCalled();
    expect(prismaMock.questionBankMembership.deleteMany).toHaveBeenCalledWith({
      where: { questionBankId: EXTRA_BANK.id },
    });
  });

  it("rejects a missing or self move target", async () => {
    prismaMock.questionBank.findFirst
      .mockResolvedValueOnce(EXTRA_BANK)
      .mockResolvedValueOnce(null);
    prismaMock.questionBankMembership.count.mockResolvedValue(1);

    const result = await deleteQuestionBank(COURSE_ID, EXTRA_BANK.id, {
      moveMembershipsToBankId: "missing",
    });
    expect(result).toEqual({ error: "Target bank not found in this course" });
  });
});

describe("listBankMemberships", () => {
  it("returns not found for a missing bank", async () => {
    prismaMock.questionBank.findFirst.mockResolvedValue(null);
    await expect(listBankMemberships(COURSE_ID, "missing")).resolves.toEqual({
      error: "Question bank not found",
    });
  });

  it("lists memberships ordered by createdAt", async () => {
    prismaMock.questionBank.findFirst.mockResolvedValue(EXTRA_BANK);
    prismaMock.questionBankMembership.findMany.mockResolvedValue([
      { id: "m1", externalQuestionId: "1" },
    ]);

    await expect(listBankMemberships(COURSE_ID, EXTRA_BANK.id)).resolves.toEqual({
      memberships: [{ id: "m1", externalQuestionId: "1" }],
    });
  });
});

describe("listMembershipsForQuestion", () => {
  it("queries memberships for a question in the course", async () => {
    prismaMock.questionBankMembership.findMany.mockResolvedValue([]);
    await listMembershipsForQuestion(COURSE_ID, "42");
    expect(prismaMock.questionBankMembership.findMany).toHaveBeenCalledWith({
      where: {
        source: "question-maker",
        externalQuestionId: "42",
        questionBank: { courseId: COURSE_ID },
      },
      include: { questionBank: true },
    });
  });
});

describe("removeQuestionFromBank", () => {
  it("returns not found when the bank is missing", async () => {
    prismaMock.questionBank.findFirst.mockResolvedValue(null);
    await expect(
      removeQuestionFromBank(COURSE_ID, "missing", "42"),
    ).resolves.toEqual({ error: "Question bank not found" });
  });

  it("returns not found when the membership is missing", async () => {
    prismaMock.questionBank.findFirst.mockResolvedValue(EXTRA_BANK);
    prismaMock.questionBankMembership.findUnique.mockResolvedValue(null);
    await expect(
      removeQuestionFromBank(COURSE_ID, EXTRA_BANK.id, "42"),
    ).resolves.toEqual({ error: "Question is not a member of this bank" });
  });

  it("reassigns to the default bank when no other memberships remain", async () => {
    prismaMock.questionBank.findFirst
      .mockResolvedValueOnce(EXTRA_BANK)
      .mockResolvedValueOnce(DEFAULT_BANK);
    prismaMock.questionBankMembership.findUnique.mockResolvedValue({
      id: "mem_1",
      questionBankId: EXTRA_BANK.id,
      source: "question-maker",
      externalQuestionId: "42",
    });
    prismaMock.questionBankMembership.delete.mockResolvedValue({});
    prismaMock.questionBankMembership.count.mockResolvedValue(0);
    prismaMock.questionBankMembership.create.mockResolvedValue({});

    const result = await removeQuestionFromBank(
      COURSE_ID,
      EXTRA_BANK.id,
      "42",
    );

    expect(result).toEqual({
      removed: true,
      reassignedToDefault: true,
      defaultBankId: DEFAULT_BANK.id,
    });
    expect(prismaMock.questionBankMembership.create).toHaveBeenCalledWith({
      data: {
        questionBankId: DEFAULT_BANK.id,
        source: "question-maker",
        externalQuestionId: "42",
      },
    });
  });

  it("does not reassign when the question remains in another bank", async () => {
    prismaMock.questionBank.findFirst.mockResolvedValue(EXTRA_BANK);
    prismaMock.questionBankMembership.findUnique.mockResolvedValue({
      id: "mem_1",
      questionBankId: EXTRA_BANK.id,
      source: "question-maker",
      externalQuestionId: "42",
    });
    prismaMock.questionBankMembership.delete.mockResolvedValue({});
    prismaMock.questionBankMembership.count.mockResolvedValue(1);

    const result = await removeQuestionFromBank(
      COURSE_ID,
      EXTRA_BANK.id,
      "42",
    );

    expect(result).toEqual({ removed: true, reassignedToDefault: false });
    expect(prismaMock.questionBankMembership.create).not.toHaveBeenCalled();
  });
});
