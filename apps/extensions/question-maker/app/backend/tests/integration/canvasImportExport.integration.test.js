/**
 * DB-backed integration tests for canvasService import/export orchestration with
 * Core quiz proxies mocked (no real Canvas or Core HTTP):
 *   - getCanvasQuizzes / getCanvasQuizQuestions / getCanvasQuizQuestionById
 *   - importQuizFromCanvas (creates assessment + section + variant from a Canvas quiz)
 *   - exportAssessmentToCanvas (round-trips the imported assessment back out)
 *   - getCanvasCourseMapping
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("../../src/services/authService.js", () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

const mockQuizQuestion = {
  id: 1,
  question_name: "1. Test Question",
  question_text: "What is 2+2?\nA) 3\nB) 4\nC) 5\nD) 6",
  question_type: "multiple_choice_question",
  position: 1,
  answers: [
    { id: 1, answer_text: "3", answer_weight: 0 },
    { id: 2, answer_text: "4", answer_weight: 100 },
    { id: 3, answer_text: "5", answer_weight: 0 },
    { id: 4, answer_text: "6", answer_weight: 0 },
  ],
};

const mockCoreCanvas = vi.hoisted(() => ({
  proxyCoreCanvasGetIntegration: vi.fn(),
  proxyCoreListQuizzes: vi.fn(),
  proxyCoreGetQuiz: vi.fn(),
  proxyCoreListQuizQuestions: vi.fn(),
  proxyCoreGetQuizQuestion: vi.fn(),
  proxyCoreCreateQuiz: vi.fn(),
  proxyCoreCreateQuizQuestion: vi.fn(),
}));

vi.mock("../../src/services/coreApiService.js", () => mockCoreCanvas);

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

const TEST_COOKIE = "session=test";
const CONNECTED_INTEGRATION = {
  canvasUrl: "https://canvas.test",
  isTestMode: true,
  isConnected: true,
};

describeDb("canvasService import/export (integration, Core proxies mocked)", () => {
  let connectTestDatabase, truncateTestDatabase, prisma;
  let seedCoursesForNewUser;
  let canvas;

  const USER = { id: "cuid-canvas-user", email: "canvas@test.com", name: "Canvas User" };
  const OTHER = { id: "cuid-canvas-other", email: "other@test.com", name: "Other User" };

  beforeAll(async () => {
    const testDb = await import("../helpers/testDb.js");
    ({ connectTestDatabase, truncateTestDatabase, prisma } = testDb);
    await connectTestDatabase();

    ({ seedCoursesForNewUser } = await import("../helpers/seedCoursesFixture.js"));
    canvas = await import("../../src/services/canvasService.js");

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  let courseId, topicId;

  beforeEach(async () => {
    vi.clearAllMocks();
    await truncateTestDatabase();
    await prisma.user.create({ data: { id: USER.id, email: USER.email, name: USER.name } });
    await prisma.user.create({ data: { id: OTHER.id, email: OTHER.email, name: OTHER.name } });
    await seedCoursesForNewUser(USER.id);
    const course = await prisma.course.findFirst({ where: { userId: USER.id } });
    courseId = course.id;
    const topic = await prisma.topics.findFirst({ where: { courseId } });
    topicId = topic.id;

    mockCoreCanvas.proxyCoreCanvasGetIntegration.mockImplementation(async (cookie) => {
      if (cookie === TEST_COOKIE) {
        return { success: true, data: CONNECTED_INTEGRATION };
      }
      return { success: true, data: null };
    });
    mockCoreCanvas.proxyCoreListQuizzes.mockResolvedValue({
      success: true,
      data: [
        { id: 1, title: "Test Quiz 1", quiz_type: "assignment", published: false },
        { id: 2, title: "Test Quiz 2", quiz_type: "assignment", published: true },
      ],
    });
    mockCoreCanvas.proxyCoreGetQuiz.mockResolvedValue({
      success: true,
      data: { id: 1, title: "Test Quiz", quiz_type: "assignment", published: false },
    });
    mockCoreCanvas.proxyCoreListQuizQuestions.mockResolvedValue({
      success: true,
      data: [mockQuizQuestion],
    });
    mockCoreCanvas.proxyCoreGetQuizQuestion.mockImplementation(
      async (_cookie, _courseId, _quizId, questionId) => ({
        success: true,
        data: { ...mockQuizQuestion, id: Number(questionId) },
      }),
    );
    mockCoreCanvas.proxyCoreCreateQuiz.mockResolvedValue({
      success: true,
      data: { id: 501, title: "Exported Quiz" },
    });
    mockCoreCanvas.proxyCoreCreateQuizQuestion.mockResolvedValue({
      success: true,
      data: { id: 9001 },
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (prisma) await prisma.$disconnect();
  });

  describe("Core proxy read endpoints", () => {
    it("lists assignment-type quizzes", async () => {
      const quizzes = await canvas.getCanvasQuizzes(TEST_COOKIE, 101);
      expect(
        quizzes.every((q) => q.quiz_type === "assignment" || q.quiz_type === "graded_survey"),
      ).toBe(true);
    });

    it("throws when Core reports no integration", async () => {
      await expect(canvas.getCanvasQuizzes("no-session", 101)).rejects.toThrow(/not configured/i);
    });

    it("lists quiz questions and fetches one by id", async () => {
      const list = await canvas.getCanvasQuizQuestions(TEST_COOKIE, 101, 1);
      expect(list.length).toBeGreaterThan(0);
      const single = await canvas.getCanvasQuizQuestionById(TEST_COOKIE, 101, 1, 5);
      expect(single.id).toBe(5);
      expect(Array.isArray(single.answers)).toBe(true);
    });
  });

  describe("importQuizFromCanvas", () => {
    it("imports the mock quiz into a new assessment with one variant", async () => {
      const result = await canvas.importQuizFromCanvas(
        USER.id,
        101,
        1,
        courseId,
        {
          primaryTopicId: topicId,
          assessmentName: "Imported Exam",
        },
        USER.id,
        TEST_COOKIE,
      );
      expect(result.questionsImported).toBe(1);
      expect(result.assessmentName).toBe("Imported Exam");

      const variants = await prisma.variants.findMany({
        where: { assessmentId: result.assessmentId },
      });
      expect(variants).toHaveLength(1);
      expect(variants[0].choices).toBeTruthy();

      const mapping = await canvas.getCanvasCourseMapping(USER.id, courseId);
      expect(String(mapping.canvasCourseId)).toBe("101");
    });

    it("requires a primary topic id", async () => {
      await expect(
        canvas.importQuizFromCanvas(USER.id, 101, 1, courseId, {}, USER.id, TEST_COOKIE),
      ).rejects.toThrow(/Primary topic ID is required/);
    });

    it("throws when the local course is not found", async () => {
      await expect(
        canvas.importQuizFromCanvas(
          USER.id,
          101,
          1,
          999999,
          { primaryTopicId: topicId },
          USER.id,
          TEST_COOKIE,
        ),
      ).rejects.toThrow(/Local course not found/);
    });

    it("throws when the integration is not configured", async () => {
      await expect(
        canvas.importQuizFromCanvas(
          OTHER.id,
          101,
          1,
          courseId,
          { primaryTopicId: topicId },
          OTHER.id,
          "no-session",
        ),
      ).rejects.toThrow(/not configured/i);
    });
  });

  describe("exportAssessmentToCanvas", () => {
    it("exports an imported assessment back to Canvas", async () => {
      const imported = await canvas.importQuizFromCanvas(
        USER.id,
        101,
        1,
        courseId,
        {
          primaryTopicId: topicId,
        },
        USER.id,
        TEST_COOKIE,
      );

      const result = await canvas.exportAssessmentToCanvas(
        imported.assessmentId,
        101,
        USER.id,
        TEST_COOKIE,
      );
      expect(result.quizId).toBeDefined();
      expect(result.questionsCreated).toBeGreaterThanOrEqual(1);
      expect(result.canvasUrl).toContain("TEST MODE");
    });

    it("throws when the assessment is not found", async () => {
      await expect(
        canvas.exportAssessmentToCanvas(999999, 101, USER.id, TEST_COOKIE),
      ).rejects.toThrow(/Assessment not found|Failed to export/);
    });

    it("throws when the integration is not configured", async () => {
      await expect(canvas.exportAssessmentToCanvas(1, 101, OTHER.id, "no-session")).rejects.toThrow(
        /not configured/i,
      );
    });
  });
});
