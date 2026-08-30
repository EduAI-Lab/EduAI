/**
 * exportAssessmentToCanvas with mocked Core quiz proxies, schema models, and getAssessmentById.
 * No real HTTP or database.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getAssessmentById = vi.fn();
const mappingFindOne = vi.fn();
const mappingCreate = vi.fn();
const courseFindOne = vi.fn();
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
    course: { findUnique: courseFindOne },
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
    // Export is pinned to the course's own Canvas link, so the happy path needs
    // one. The mapping row is read twice: once by the link guard, once by the
    // create-if-absent below it — hence the null on the second read.
    mappingFindOne
      .mockResolvedValueOnce({ localCourseId: 5, canvasCourseId: 999, canvasCourseName: null })
      .mockResolvedValue(null);
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

  /**
   * The mapping row below is created-if-absent and never updated, and
   * `getCanvasCourseMapping` prefers it over Core's `externalId`. So an export
   * into an arbitrary Canvas course used to mint a row that shadowed the
   * genuine Core-synced link for every later quiz and bank import — silently
   * and permanently re-pointing the course (#1652 review).
   */
  it("refuses to export into a Canvas course the local course is not linked to", async () => {
    mappingFindOne.mockReset();
    mappingFindOne.mockResolvedValue({
      localCourseId: 5,
      canvasCourseId: 111,
      canvasCourseName: null,
    });

    await expect(exportAssessmentToCanvas(100, 999, 42, TEST_COOKIE)).rejects.toThrow(
      /does not match the Canvas course linked/i,
    );
    expect(proxyCoreCreateQuiz).not.toHaveBeenCalled();
    expect(mappingCreate).not.toHaveBeenCalled();
  });

  it("refuses to export from a course with no Canvas link at all", async () => {
    mappingFindOne.mockReset();
    mappingFindOne.mockResolvedValue(null);
    courseFindOne.mockResolvedValue({ coreCourseId: null });

    await expect(exportAssessmentToCanvas(100, 999, 42, TEST_COOKIE)).rejects.toThrow(
      /not linked to Canvas/i,
    );
    expect(proxyCoreCreateQuiz).not.toHaveBeenCalled();
    expect(mappingCreate).not.toHaveBeenCalled();
  });

  it("throws when Canvas is not connected on Core", async () => {
    proxyCoreCanvasGetIntegration.mockResolvedValue({ success: true, data: null });
    await expect(exportAssessmentToCanvas(1, 1, 1, TEST_COOKIE)).rejects.toThrow(
      /Canvas integration not configured/i,
    );
    expect(proxyCoreCreateQuiz).not.toHaveBeenCalled();
  });
});
