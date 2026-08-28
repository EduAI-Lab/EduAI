/**
 * exportAssessmentToCanvas with mocked Core quiz proxies, schema models, and getAssessmentById.
 * No real HTTP or database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getAssessmentById = vi.fn();
const mappingFindOne = vi.fn();
const mappingCreate = vi.fn();
const proxyCoreCanvasGetIntegration = vi.fn();
const proxyCoreCreateQuiz = vi.fn();
const proxyCoreCreateQuizQuestion = vi.fn();

vi.mock("../../src/services/assessmentService.js", () => ({
  getAssessmentById,
  createAssessment: vi.fn(),
}));

vi.mock("../../src/services/assessmentSectionService.js", () => ({
  createAssessmentSection: vi.fn(),
}));

vi.mock("../../src/services/coreApiService.js", () => ({
  proxyCoreCanvasGetIntegration,
  proxyCoreCreateQuiz,
  proxyCoreCreateQuizQuestion,
  proxyCoreGetQuiz: vi.fn(),
  proxyCoreListQuizQuestions: vi.fn(),
  proxyCoreGetQuizQuestion: vi.fn(),
  proxyCoreListQuizzes: vi.fn(),
}));

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    canvasCourseMapping: { findUnique: mappingFindOne, create: mappingCreate },
    questionMetadata: {},
    variants: {},
    assessmentSections: {},
    sectionVariants: {},
    course: {},
  },
}));

const { exportAssessmentToCanvas } = await import("../../src/services/canvasService.js");

const TEST_COOKIE = "session=test";

const sampleAssessment = () => ({
  id: 100,
  name: "Unit export quiz",
  description: "From tests",
  type: "midterm",
  courseId: 5,
  sections: [
    {
      name: "A",
      sectionVariants: [
        {
          displayOrder: 0,
          variant: {
            questionText: "Choose:\nA) one\nB) two",
            answer: "A",
            questionMetadata: { type: "MCQ", description: "pick" },
            choices: [
              { letter: "A", text: "one" },
              { letter: "B", text: "two" },
            ],
          },
        },
      ],
    },
  ],
});

describe("exportAssessmentToCanvas (Core quiz proxies mocked)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    proxyCoreCanvasGetIntegration.mockResolvedValue({
      success: true,
      data: {
        canvasUrl: "https://canvas.example.edu",
        isTestMode: false,
        isConnected: true,
      },
    });
    getAssessmentById.mockResolvedValue(sampleAssessment());
    mappingFindOne.mockResolvedValue(null);
    mappingCreate.mockResolvedValue({ id: 1 });

    proxyCoreCreateQuiz.mockResolvedValue({
      success: true,
      data: { id: 501, title: "Unit export quiz" },
    });
    proxyCoreCreateQuizQuestion.mockResolvedValue({
      success: true,
      data: { id: 9001, position: 1 },
    });
  });

  it("creates quiz then questions via Core and saves course mapping", async () => {
    const result = await exportAssessmentToCanvas(100, 999, 42, TEST_COOKIE);

    expect(proxyCoreCanvasGetIntegration).toHaveBeenCalledWith(TEST_COOKIE);
    expect(getAssessmentById).toHaveBeenCalledWith(100, 42);
    expect(proxyCoreCreateQuiz).toHaveBeenCalledWith(
      TEST_COOKIE,
      999,
      expect.objectContaining({ title: "Unit export quiz", quiz_type: "assignment" }),
    );
    expect(proxyCoreCreateQuizQuestion).toHaveBeenCalledWith(
      TEST_COOKIE,
      999,
      501,
      expect.objectContaining({ question_type: "multiple_choice_question" }),
    );
    expect(result).toEqual({
      quizId: 501,
      quizTitle: "Unit export quiz",
      questionsCreated: 1,
      canvasUrl: "https://canvas.example.edu/courses/999/quizzes/501",
    });
    expect(mappingFindOne).toHaveBeenCalledWith({
      where: { localCourseId: 5 },
    });
    expect(mappingCreate).toHaveBeenCalledWith({
      data: {
        userId: 42,
        localCourseId: 5,
        canvasCourseId: 999,
        canvasCourseName: undefined,
      },
    });
  });

  it("throws when Canvas is not connected on Core", async () => {
    proxyCoreCanvasGetIntegration.mockResolvedValue({ success: true, data: null });
    await expect(exportAssessmentToCanvas(1, 1, 1, TEST_COOKIE)).rejects.toThrow(
      /Canvas integration not configured/i,
    );
    expect(proxyCoreCreateQuiz).not.toHaveBeenCalled();
  });
});
