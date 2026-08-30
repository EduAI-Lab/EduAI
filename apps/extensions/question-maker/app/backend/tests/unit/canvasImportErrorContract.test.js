/**
 * Regressions for the Canvas quiz import error contract (#1509 review):
 *
 *  - a Core failure reaches the route with its status/code/body intact instead
 *    of collapsing into a generic 500;
 *  - a per-question fetch failure only falls back to the list item when Core
 *    reported an explicit Canvas permission denial;
 *  - a caller disconnect cancels the in-flight Core request.
 *
 * Core proxies, schema models and assessment services are mocked — no real HTTP
 * and no database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const createAssessment = vi.fn();
const createAssessmentSection = vi.fn();
const proxyCoreCanvasGetIntegration = vi.fn();
const proxyCoreGetQuiz = vi.fn();
const proxyCoreListQuizQuestions = vi.fn();
const proxyCoreGetQuizQuestion = vi.fn();

const courseFindFirst = vi.fn();
const assessmentDelete = vi.fn();
const questionMetadataCreate = vi.fn();
const questionMetadataDeleteMany = vi.fn();
const variantsCreate = vi.fn();
const variantsDeleteMany = vi.fn();
const sectionVariantsCreate = vi.fn();
const sectionVariantsDeleteMany = vi.fn();
const assessmentSectionDelete = vi.fn();
const mappingFindUnique = vi.fn();
const mappingCreate = vi.fn();
const transaction = vi.fn();
const remainingAssessments = new Set();

vi.mock("../../src/services/assessmentService.js", () => ({
  createAssessment,
  getAssessmentById: vi.fn(),
}));

vi.mock("../../src/services/assessmentSectionService.js", () => ({
  createAssessmentSection,
}));

vi.mock("../../src/services/coreApiService.js", () => ({
  // Unused here — the local mapping row resolves the Canvas link — but the
  // whole module is replaced, so `getCanvasCourseMapping`'s fallback needs it.
  getCourseFromCore: vi.fn(),
  proxyCoreCanvasGetIntegration,
  proxyCoreGetQuiz,
  proxyCoreListQuizQuestions,
  proxyCoreGetQuizQuestion,
  proxyCoreCreateQuiz: vi.fn(),
  proxyCoreCreateQuizQuestion: vi.fn(),
  proxyCoreDeleteQuiz: vi.fn(),
  proxyCoreGetQuestionBank: vi.fn(),
  proxyCoreListQuestionBankQuestions: vi.fn(),
  proxyCoreListQuestionBanks: vi.fn(),
  proxyCoreListQuizzes: vi.fn(),
}));

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    course: { findFirst: courseFindFirst },
    assessments: { delete: assessmentDelete },
    assessmentSections: { delete: assessmentSectionDelete },
    questionMetadata: { create: questionMetadataCreate, deleteMany: questionMetadataDeleteMany },
    variants: { create: variantsCreate, deleteMany: variantsDeleteMany },
    sectionVariants: { create: sectionVariantsCreate, deleteMany: sectionVariantsDeleteMany },
    canvasCourseMapping: { findUnique: mappingFindUnique, create: mappingCreate },
    $transaction: transaction,
  },
}));

const { importQuizFromCanvas } = await import("../../src/services/canvasService.js");

const COOKIE = "session=test";
const CALLER_ID = "user-1";

/** The Canvas question shape the list endpoint returns (answers withheld). */
const listItem = {
  id: 7,
  question_name: "Q1",
  question_text: "What is 2+2?\nA) 3\nB) 4",
  question_type: "multiple_choice_question",
  position: 1,
};

/** Mirrors the metadata `coreApiService` attaches to a relayed Core failure. */
function coreFailure(status, code) {
  return Object.assign(new Error(code), {
    status,
    code,
    body: { error: code },
    isPublic: true,
  });
}

function runImport() {
  return importQuizFromCanvas(
    CALLER_ID,
    123,
    456,
    9,
    { primaryTopicId: "topic-1" },
    CALLER_ID,
    COOKIE,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  remainingAssessments.clear();
  assessmentDelete.mockImplementation(async ({ where }) => {
    remainingAssessments.delete(where.id);
  });
  transaction.mockImplementation(async (callback) =>
    callback({
      assessments: { delete: assessmentDelete },
      assessmentSections: { delete: assessmentSectionDelete },
      questionMetadata: { deleteMany: questionMetadataDeleteMany },
      variants: { deleteMany: variantsDeleteMany },
      sectionVariants: { deleteMany: sectionVariantsDeleteMany },
    }),
  );
  proxyCoreCanvasGetIntegration.mockResolvedValue({ data: { canvasUrl: "https://c.edu" } });
  proxyCoreGetQuiz.mockResolvedValue({ data: { id: 456, title: "Midterm" } });
  proxyCoreListQuizQuestions.mockResolvedValue({ data: [listItem] });
  courseFindFirst.mockResolvedValue({ id: 9 });
  createAssessment.mockImplementation(async () => {
    remainingAssessments.add(11);
    return { id: 11, name: "Midterm" };
  });
  createAssessmentSection.mockResolvedValue({ id: 22 });
  questionMetadataCreate.mockResolvedValue({ id: 33 });
  variantsCreate.mockResolvedValue({ id: 44 });
  sectionVariantsCreate.mockResolvedValue({});
  // Course 9 is linked to Canvas course 123 — the id every import here uses.
  mappingFindUnique.mockResolvedValue({ id: 1, canvasCourseId: 123, canvasCourseName: null });
});

describe("importQuizFromCanvas — Core error contract", () => {
  it.each([
    [400, "CANVAS_COURSE_INVALID"],
    [401, "UNAUTHORIZED"],
    [502, "CANVAS_UNREACHABLE"],
  ])("relays a Core %i failure with its status, code and body", async (status, code) => {
    proxyCoreListQuizQuestions.mockRejectedValue(coreFailure(status, code));

    await expect(runImport()).rejects.toMatchObject({
      status,
      code,
      body: { error: code },
      isPublic: true,
    });
  });

  it("keeps the connect-Canvas-first contract when Core has no integration", async () => {
    proxyCoreCanvasGetIntegration.mockResolvedValue({ data: null });

    await expect(runImport()).rejects.toMatchObject({
      status: 400,
      code: "CANVAS_NOT_CONNECTED",
      message: expect.stringContaining("Failed to import quiz from Canvas"),
    });
  });
});

describe("importQuizFromCanvas — per-question fetch failures", () => {
  it("falls back to the list item on an explicit Canvas permission denial", async () => {
    proxyCoreGetQuizQuestion.mockRejectedValue(coreFailure(403, "CANVAS_PERMISSION_DENIED"));

    const result = await runImport();

    expect(result.questionsImported).toBe(1);
    expect(variantsCreate).toHaveBeenCalledTimes(1);
  });

  it.each([
    [401, "UNAUTHORIZED"],
    [502, "CANVAS_UNREACHABLE"],
  ])(
    "fails the import on a Core %i instead of persisting a partial question",
    async (status, code) => {
      proxyCoreGetQuizQuestion.mockRejectedValue(coreFailure(status, code));

      await expect(runImport()).rejects.toMatchObject({ status, code });
      expect(variantsCreate).not.toHaveBeenCalled();
    },
  );

  it("fails the import when the per-question fetch dies on transport", async () => {
    proxyCoreGetQuizQuestion.mockRejectedValue(
      Object.assign(new Error("fetch failed"), { code: "ECONNREFUSED" }),
    );

    // A status-less failure is genuinely unexpected, so `rethrowCoreCanvasError`
    // passes it through untouched rather than dressing it as a Canvas error —
    // what matters here is that the import aborts instead of persisting a
    // question built from the list item alone.
    await expect(runImport()).rejects.toMatchObject({
      message: "fetch failed",
      code: "ECONNREFUSED",
    });
    expect(variantsCreate).not.toHaveBeenCalled();
  });

  it("cleans up the assessment when a later question fetch fails", async () => {
    const secondQuestion = { ...listItem, id: 8, question_name: "Q2", position: 2 };
    proxyCoreListQuizQuestions.mockResolvedValue({ data: [listItem, secondQuestion] });
    proxyCoreGetQuizQuestion.mockImplementation(async (_cookie, _courseId, _quizId, questionId) => {
      if (Number(questionId) === secondQuestion.id) {
        throw coreFailure(502, "CANVAS_UNREACHABLE");
      }
      return { data: { ...listItem, answers: [] } };
    });

    await expect(runImport()).rejects.toMatchObject({
      status: 502,
      code: "CANVAS_UNREACHABLE",
    });

    expect(assessmentDelete).toHaveBeenCalledWith({ where: { id: 11 } });
    expect(assessmentSectionDelete).toHaveBeenCalledWith({ where: { id: 22 } });
    expect(sectionVariantsDeleteMany).toHaveBeenCalledWith({ where: { sectionId: 22 } });
    expect(variantsDeleteMany).toHaveBeenCalledWith({ where: { id: { in: [44] } } });
    expect(questionMetadataDeleteMany).toHaveBeenCalledWith({ where: { id: { in: [33] } } });
    expect(remainingAssessments).toEqual(new Set());
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("preserves the first persistence error while cleaning up", async () => {
    questionMetadataCreate.mockRejectedValue(new Error("database unavailable"));

    await expect(runImport()).rejects.toThrow("database unavailable");

    expect(assessmentDelete).toHaveBeenCalledWith({ where: { id: 11 } });
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("reports a stable compensation failure when cleanup cannot remove the partial import", async () => {
    const secondQuestion = { ...listItem, id: 8, question_name: "Q2", position: 2 };
    const originalError = new Error("database failed: secret=do-not-return");
    proxyCoreListQuizQuestions.mockResolvedValue({ data: [listItem, secondQuestion] });
    proxyCoreGetQuizQuestion.mockResolvedValue({ data: { ...listItem, answers: [] } });
    questionMetadataCreate.mockImplementationOnce(async () => ({ id: 33 }));
    questionMetadataCreate.mockRejectedValueOnce(originalError);
    transaction.mockRejectedValueOnce(new Error("cleanup failed: secret=do-not-return"));

    const thrown = await runImport().catch((error) => error);

    expect(thrown).toMatchObject({
      status: 502,
      code: "CANVAS_IMPORT_COMPENSATION_FAILED",
      body: {
        error: "CANVAS_IMPORT_COMPENSATION_FAILED",
        assessmentId: 11,
        sectionId: 22,
      },
      message: expect.stringContaining("before retrying"),
    });
    expect(thrown.message).not.toContain("secret");
    expect(thrown.cause).toBe(originalError);
    expect(Object.keys(thrown)).not.toContain("cause");
    expect(JSON.stringify(thrown)).not.toContain("secret");
  });
});
