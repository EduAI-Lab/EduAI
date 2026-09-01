/**
 * Unit tests for exportAssessmentToCanvas (#1556).
 * Canvas LMS egress is mocked via Core proxies (coreApiService).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const proxyCoreCanvasGetIntegration = vi.fn();
const proxyCoreCreateQuiz = vi.fn();
const proxyCoreCreateQuizQuestion = vi.fn();
const proxyCoreDeleteQuiz = vi.fn();

vi.mock("../../src/services/coreApiService.js", () => ({
  proxyCoreCanvasGetIntegration: (...args) => proxyCoreCanvasGetIntegration(...args),
  proxyCoreCreateQuiz: (...args) => proxyCoreCreateQuiz(...args),
  proxyCoreCreateQuizQuestion: (...args) => proxyCoreCreateQuizQuestion(...args),
  proxyCoreDeleteQuiz: (...args) => proxyCoreDeleteQuiz(...args),
  proxyCoreGetQuestionBank: vi.fn(),
  proxyCoreListQuestionBankQuestions: vi.fn(),
  proxyCoreListQuestionBanks: vi.fn(),
  proxyCoreGetQuiz: vi.fn(),
  proxyCoreGetQuizQuestion: vi.fn(),
  proxyCoreListQuizQuestions: vi.fn(),
  proxyCoreListQuizzes: vi.fn(),
  getCourseFromCore: vi.fn(),
}));

const getAssessmentById = vi.fn();

vi.mock("../../src/services/assessmentService.js", () => ({
  getAssessmentById: (...args) => getAssessmentById(...args),
  createAssessment: vi.fn(),
}));

vi.mock("../../src/services/assessmentSectionService.js", () => ({
  createAssessmentSection: vi.fn(),
}));

vi.mock("../../src/services/questionService.js", () => ({
  createQuestion: vi.fn(),
}));

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    course: { findFirst: vi.fn(), findUnique: vi.fn() },
    canvasCourseMapping: { findUnique: vi.fn(), create: vi.fn() },
    canvasBankMapping: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn() },
    canvasBankQuestionMapping: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    questionMetadata: { findUnique: vi.fn(), update: vi.fn() },
    variants: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const { prisma } = await import("../../src/config/database.js");
const { exportAssessmentToCanvas } = await import("../../src/services/canvasService.js");

const COOKIE = "session=test";

/** An assessment with one exportable MCQ variant. */
function assessmentWithOneQuestion() {
  return {
    id: 5,
    name: "Midterm 1",
    type: "Quiz",
    description: null,
    courseId: 9,
    sections: [
      {
        name: "Imported Questions",
        sectionVariants: [
          {
            displayOrder: 0,
            variant: {
              id: 11,
              questionText: "What is 2+2?",
              answer: "4",
              choices: ["3", "4"],
              correctAnswers: ["4"],
              questionMetadata: { id: 21, description: "Arithmetic", type: "MCQ" },
            },
          },
        ],
      },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  proxyCoreCanvasGetIntegration.mockResolvedValue({
    data: { canvasUrl: "https://canvas.example.edu", isTestMode: false },
  });
  proxyCoreCreateQuiz.mockResolvedValue({ data: { id: 77, title: "Midterm 1" } });
  proxyCoreCreateQuizQuestion.mockResolvedValue({ data: { id: 101 } });
  proxyCoreDeleteQuiz.mockResolvedValue({ data: { id: 77 } });
  getAssessmentById.mockResolvedValue(assessmentWithOneQuestion());
  prisma.canvasCourseMapping.findUnique.mockResolvedValue({ localCourseId: 9, canvasCourseId: 1 });
});

it("removes the partial quiz when question creation fails", async () => {
  proxyCoreCreateQuizQuestion.mockRejectedValue(new Error("question failed"));

  await expect(exportAssessmentToCanvas(5, 1, "owner", COOKIE)).rejects.toThrow(/question failed/);

  expect(proxyCoreDeleteQuiz).toHaveBeenCalledWith(COOKIE, 1, 77);
  expect(prisma.canvasCourseMapping.create).not.toHaveBeenCalled();
});

describe("exportAssessmentToCanvas", () => {
  it("publishes the exported quiz so it appears in Canvas (#1556)", async () => {
    await exportAssessmentToCanvas(5, 1, "owner", COOKIE);

    const [, , quizPayload] = proxyCoreCreateQuiz.mock.calls[0];
    expect(quizPayload.published).toBe(true);
  });

  it("leaves the quiz unpublished when the caller opts out", async () => {
    await exportAssessmentToCanvas(5, 1, "owner", COOKIE, { published: false });

    const [, , quizPayload] = proxyCoreCreateQuiz.mock.calls[0];
    expect(quizPayload.published).toBe(false);
  });

  it("reports a missing assessment as 404, not a server error", async () => {
    getAssessmentById.mockResolvedValue(null);

    await expect(exportAssessmentToCanvas(5, 1, "owner", COOKIE)).rejects.toMatchObject({
      status: 404,
    });
  });

  it("reports an assessment with no questions as 400, not a server error", async () => {
    getAssessmentById.mockResolvedValue({ ...assessmentWithOneQuestion(), sections: [] });

    await expect(exportAssessmentToCanvas(5, 1, "owner", COOKIE)).rejects.toMatchObject({
      status: 400,
    });
  });

  it("reports a disconnected Canvas integration as 400, not a server error", async () => {
    proxyCoreCanvasGetIntegration.mockResolvedValue({ data: null });

    await expect(exportAssessmentToCanvas(5, 1, "owner", COOKIE)).rejects.toMatchObject({
      status: 400,
    });
  });

  it("relays the upstream status when Canvas rejects the quiz", async () => {
    const upstream = new Error("Canvas rejected the quiz");
    upstream.status = 422;
    upstream.body = { error: "CANVAS_REJECTED" };
    proxyCoreCreateQuiz.mockRejectedValue(upstream);

    await expect(exportAssessmentToCanvas(5, 1, "owner", COOKIE)).rejects.toMatchObject({
      status: 422,
    });
  });
});
