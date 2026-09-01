/**
 * Unit tests for importQuestionBankFromCanvas (#845 / #1509).
 * Canvas LMS egress is mocked via Core proxies (coreApiService).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const proxyCoreCanvasGetIntegration = vi.fn();
const proxyCoreGetQuestionBank = vi.fn();
const proxyCoreListQuestionBankQuestions = vi.fn();
const getCourseFromCore = vi.fn();

vi.mock("../../src/services/coreApiService.js", () => ({
  proxyCoreCanvasGetIntegration: (...args) => proxyCoreCanvasGetIntegration(...args),
  proxyCoreGetQuestionBank: (...args) => proxyCoreGetQuestionBank(...args),
  proxyCoreListQuestionBankQuestions: (...args) => proxyCoreListQuestionBankQuestions(...args),
  proxyCoreListQuestionBanks: vi.fn(),
  proxyCoreCreateQuiz: vi.fn(),
  proxyCoreCreateQuizQuestion: vi.fn(),
  proxyCoreDeleteQuiz: vi.fn(),
  proxyCoreGetQuiz: vi.fn(),
  proxyCoreGetQuizQuestion: vi.fn(),
  proxyCoreListQuizQuestions: vi.fn(),
  proxyCoreListQuizzes: vi.fn(),
  getCourseFromCore: (...args) => getCourseFromCore(...args),
}));

vi.mock("../../src/services/questionService.js", () => ({
  createQuestion: vi.fn(),
}));

vi.mock("../../src/services/assessmentService.js", () => ({
  getAssessmentById: vi.fn(),
  createAssessment: vi.fn(),
}));

vi.mock("../../src/services/assessmentSectionService.js", () => ({
  createAssessmentSection: vi.fn(),
}));

vi.mock("../../src/services/questionBankService.js", () => ({
  listBanks: vi.fn(),
  createBank: vi.fn(),
  addQuestionsToBank: vi.fn(),
}));

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    course: { findFirst: vi.fn(), findUnique: vi.fn() },
    canvasCourseMapping: { findUnique: vi.fn() },
    canvasBankMapping: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    canvasBankQuestionMapping: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    questionMetadata: { findUnique: vi.fn(), update: vi.fn() },
    variants: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(async (fn) =>
      fn({
        questionMetadata: { update: vi.fn() },
        variants: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn(), create: vi.fn() },
        canvasBankQuestionMapping: { update: vi.fn(), create: vi.fn() },
      }),
    ),
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const { prisma } = await import("../../src/config/database.js");
const { listBanks, createBank, addQuestionsToBank } =
  await import("../../src/services/questionBankService.js");
const { createQuestion } = await import("../../src/services/questionService.js");
const { importQuestionBankFromCanvas, getCanvasCourseMapping } =
  await import("../../src/services/canvasService.js");

const COOKIE = "session=test";

function importBank(options, ownerId = "u1") {
  return importQuestionBankFromCanvas("u1", 1, 10, 9, options, ownerId, COOKIE);
}

beforeEach(() => {
  vi.clearAllMocks();
  prisma.$transaction.mockImplementation(async (fn) =>
    fn({
      questionMetadata: { update: prisma.questionMetadata.update },
      variants: {
        findMany: prisma.variants.findMany,
        update: prisma.variants.update,
        create: prisma.variants.create,
      },
      canvasBankQuestionMapping: {
        update: prisma.canvasBankQuestionMapping.update,
        create: prisma.canvasBankQuestionMapping.create,
      },
    }),
  );
  proxyCoreCanvasGetIntegration.mockResolvedValue({
    data: {
      canvasUrl: "https://canvas.example.edu",
      isTestMode: false,
    },
  });
  proxyCoreGetQuestionBank.mockResolvedValue({ data: { id: 10, title: "Chapter 1" } });
  proxyCoreListQuestionBankQuestions.mockResolvedValue({ data: [] });
  prisma.course.findFirst.mockResolvedValue({
    id: 9,
    coreCourseId: "core_1",
    userId: "owner",
  });
  prisma.canvasCourseMapping.findUnique.mockResolvedValue({
    localCourseId: 9,
    canvasCourseId: 1,
    canvasCourseName: "CS 101",
    userId: "u1",
  });
  prisma.course.findUnique.mockResolvedValue({ id: 9, coreCourseId: "core_1" });
  getCourseFromCore.mockResolvedValue({
    id: "core_1",
    name: "CS 101",
    externalSource: "canvas",
    externalId: "1",
  });
  listBanks.mockResolvedValue([{ id: "bank_default", name: "Course bank" }]);
  prisma.canvasBankMapping.findUnique.mockResolvedValue(null);
  prisma.canvasBankMapping.upsert.mockResolvedValue({ id: 1 });
  prisma.canvasBankMapping.update.mockResolvedValue({
    id: 1,
    lastSyncedAt: new Date("2026-07-29T00:00:00Z"),
  });
  createBank.mockResolvedValue({ id: "bank_new", name: "Chapter 1" });
  addQuestionsToBank.mockResolvedValue({ added: 0 });
});

describe("importQuestionBankFromCanvas", () => {
  it("throws when Canvas is not connected", async () => {
    proxyCoreCanvasGetIntegration.mockResolvedValue({ data: null });
    await expect(importBank({ primaryTopicId: "t1" })).rejects.toThrow(
      /Canvas integration not configured/,
    );
  });

  it("throws 404 when the local course is missing", async () => {
    prisma.course.findFirst.mockResolvedValue(null);
    await expect(importBank({ primaryTopicId: "t1" })).rejects.toMatchObject({
      status: 404,
    });
  });

  it("requires a primary topic", async () => {
    await expect(importBank({})).rejects.toThrow(/Primary topic ID is required/);
  });

  it("rejects a missing targetBankId", async () => {
    await expect(
      importBank({
        primaryTopicId: "t1",
        targetBankId: "missing",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("creates a Core bank and imports convertible questions", async () => {
    proxyCoreListQuestionBankQuestions.mockResolvedValue({
      data: [
        {
          id: 100,
          question_text: "Explain polymorphism",
          question_type: "essay_question",
        },
      ],
    });
    prisma.canvasBankQuestionMapping.findUnique.mockResolvedValue(null);
    createQuestion.mockResolvedValue({ id: 55 });
    prisma.variants.create.mockResolvedValue({});
    prisma.canvasBankQuestionMapping.create.mockResolvedValue({});
    addQuestionsToBank.mockResolvedValue({ added: 1 });

    const result = await importBank({ primaryTopicId: "topic_1" });

    expect(createBank).toHaveBeenCalled();
    expect(createQuestion).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ skipBankAttach: true }),
    );
    expect(addQuestionsToBank).toHaveBeenCalledWith(9, "u1", "bank_new", [55]);
    expect(prisma.canvasBankMapping.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_canvasBankId: {
            userId: "u1",
            canvasBankId: 10,
          },
        },
      }),
    );
    expect(prisma.canvasBankQuestionMapping.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          localCourseId: 9,
          canvasAssessmentQuestionId: 100,
          localQuestionMetadataId: 55,
        }),
      }),
    );
    expect(result).toMatchObject({
      bankId: "bank_new",
      created: 1,
      updated: 0,
      truncated: false,
    });
  });

  it("syncs a Canvas-synced Core course that has no local mapping row", async () => {
    prisma.canvasCourseMapping.findUnique.mockResolvedValue(null);

    const result = await importBank({ primaryTopicId: "topic_1" });

    expect(result.bankId).toBe("bank_new");
  });

  it("rejects when neither the local mapping nor the Core course links to Canvas", async () => {
    prisma.canvasCourseMapping.findUnique.mockResolvedValue(null);
    getCourseFromCore.mockResolvedValue({
      id: "core_1",
      name: "CS 101",
      externalSource: null,
      externalId: null,
    });
    await expect(importBank({ primaryTopicId: "t1" })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("rejects when canvasCourseId does not match the synced course mapping", async () => {
    prisma.canvasCourseMapping.findUnique.mockResolvedValue({
      localCourseId: 9,
      canvasCourseId: 77,
      userId: "u1",
    });
    await expect(importBank({ primaryTopicId: "t1" })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("rejects when the Canvas bank is already synced to a different local course", async () => {
    prisma.canvasBankMapping.findUnique.mockResolvedValue({
      id: 3,
      userId: "u1",
      canvasBankId: 10,
      localCourseId: 2,
      localBankId: "bank_elsewhere",
    });
    await expect(importBank({ primaryTopicId: "t1" })).rejects.toMatchObject({
      status: 400,
    });
    expect(createQuestion).not.toHaveBeenCalled();
  });

  it("does not overwrite another course question when Canvas question id collides", async () => {
    listBanks.mockResolvedValue([{ id: "bank_extra", name: "Extra" }]);
    proxyCoreListQuestionBankQuestions.mockResolvedValue({
      data: [
        {
          id: 100,
          question_text: "Explain polymorphism",
          question_type: "essay_question",
        },
      ],
    });
    prisma.canvasBankQuestionMapping.findUnique.mockResolvedValue(null);
    createQuestion.mockResolvedValue({ id: 99 });
    prisma.variants.create.mockResolvedValue({});
    prisma.canvasBankQuestionMapping.create.mockResolvedValue({});
    addQuestionsToBank.mockResolvedValue({ added: 1 });

    const result = await importBank({
      primaryTopicId: "t1",
      targetBankId: "bank_extra",
    });

    expect(prisma.canvasBankQuestionMapping.findUnique).toHaveBeenCalledWith({
      where: {
        userId_canvasAssessmentQuestionId_localCourseId: {
          userId: "u1",
          canvasAssessmentQuestionId: 100,
          localCourseId: 9,
        },
      },
    });
    expect(prisma.questionMetadata.update).not.toHaveBeenCalled();
    expect(createQuestion).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ courseId: 9, skipBankAttach: true }),
    );
    expect(result.created).toBe(1);
    expect(result.updated).toBe(0);
  });

  it("reuses targetBankId when provided", async () => {
    listBanks.mockResolvedValue([{ id: "bank_extra", name: "Extra" }]);
    const result = await importBank({
      primaryTopicId: "t1",
      targetBankId: "bank_extra",
    });
    expect(createBank).not.toHaveBeenCalled();
    expect(result.bankId).toBe("bank_extra");
  });

  it("skips remote rows without an id", async () => {
    listBanks.mockResolvedValue([{ id: "bank_extra", name: "Extra" }]);
    proxyCoreListQuestionBankQuestions.mockResolvedValue({
      data: [{ question_text: "orphan" }],
    });

    const result = await importBank({
      primaryTopicId: "t1",
      targetBankId: "bank_extra",
    });
    expect(result.skipped).toBe(1);
    expect(createQuestion).not.toHaveBeenCalled();
    expect(addQuestionsToBank).not.toHaveBeenCalled();
  });

  it("rejects non-numeric canvas ids", async () => {
    await expect(
      importQuestionBankFromCanvas(
        "u1",
        "123&context_type=Account",
        10,
        9,
        { primaryTopicId: "t1" },
        "u1",
        COOKIE,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("getCanvasCourseMapping", () => {
  it("returns the local mapping row when one exists", async () => {
    const link = await getCanvasCourseMapping("u1", 9, COOKIE);

    expect(link).toMatchObject({ canvasCourseId: 1, canvasCourseName: "CS 101" });
    expect(getCourseFromCore).not.toHaveBeenCalled();
  });

  it("falls back to the Canvas id on the Core course when no local row exists", async () => {
    prisma.canvasCourseMapping.findUnique.mockResolvedValue(null);

    const link = await getCanvasCourseMapping("u1", 9, COOKIE);

    expect(link).toMatchObject({ canvasCourseId: 1, canvasCourseName: "CS 101" });
  });

  it("returns null when the Core course did not come from Canvas", async () => {
    prisma.canvasCourseMapping.findUnique.mockResolvedValue(null);
    getCourseFromCore.mockResolvedValue({ id: "core_1", name: "CS 101", externalSource: null });

    expect(await getCanvasCourseMapping("u1", 9, COOKIE)).toBeNull();
  });

  it("returns null when the local course is not linked to Core", async () => {
    prisma.canvasCourseMapping.findUnique.mockResolvedValue(null);
    prisma.course.findUnique.mockResolvedValue({ id: 9, coreCourseId: null });

    expect(await getCanvasCourseMapping("u1", 9, COOKIE)).toBeNull();
    expect(getCourseFromCore).not.toHaveBeenCalled();
  });

  /**
   * "Core did not answer" is not "this course has no Canvas link". Callers now
   * hide the Canvas tab and both import entry points on a resolved-unlinked, so
   * returning null here would strip every Canvas affordance from a genuinely
   * linked course on one transient failure (#1652 review).
   */
  it("reports an unresolved link rather than an absent one when Core is unreachable", async () => {
    prisma.canvasCourseMapping.findUnique.mockResolvedValue(null);
    getCourseFromCore.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(getCanvasCourseMapping("u1", 9, COOKIE)).rejects.toMatchObject({
      status: 503,
      body: { error: "CANVAS_LINK_UNRESOLVED" },
    });
  });
});
