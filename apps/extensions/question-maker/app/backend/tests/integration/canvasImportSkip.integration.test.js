/**
 * DB-backed test for importQuizFromCanvas's per-question skip path (#3).
 *
 * When a question fails to convert (unsupported type) or persist, the loop is meant to
 * record it in `skippedQuestions` and continue. The catch block referenced `canvasQuestion`,
 * which was `let`-declared inside the `try` and therefore out of scope in the `catch` —
 * so any skip threw `ReferenceError: canvasQuestion is not defined`, which escaped the loop
 * and aborted the ENTIRE import with a generic error instead of skipping one question.
 *
 * We force the failure by making prisma.questionMetadata.create reject, which drives the
 * same catch. Before the fix the import rejects with the ReferenceError message; after the
 * fix the question is skipped and the loop ends with its intentional "No questions could be
 * imported" guard (proving the catch ran without throwing on `canvasQuestion`).
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
  proxyCoreGetQuiz: vi.fn(),
  proxyCoreListQuizQuestions: vi.fn(),
  proxyCoreGetQuizQuestion: vi.fn(),
}));

vi.mock("../../src/services/coreApiService.js", () => mockCoreCanvas);

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

const TEST_COOKIE = "session=test";

describeDb("importQuizFromCanvas per-question skip (integration, #3)", () => {
  let connectTestDatabase, truncateTestDatabase, prisma;
  let seedCoursesForNewUser;
  let canvas;

  const USER = {
    id: "cuid-canvas-skip-user",
    email: "canvas-skip@test.com",
    name: "Canvas Skip User",
  };

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
    await seedCoursesForNewUser(USER.id);
    const course = await prisma.course.findFirst({ where: { userId: USER.id } });
    courseId = course.id;
    const topic = await prisma.topics.findFirst({ where: { courseId } });
    topicId = topic.id;

    mockCoreCanvas.proxyCoreCanvasGetIntegration.mockResolvedValue({
      success: true,
      data: { canvasUrl: "https://canvas.test", isTestMode: true, isConnected: true },
    });
    mockCoreCanvas.proxyCoreGetQuiz.mockResolvedValue({
      success: true,
      data: { id: 1, title: "Test Quiz", quiz_type: "assignment" },
    });
    mockCoreCanvas.proxyCoreListQuizQuestions.mockResolvedValue({
      success: true,
      data: [mockQuizQuestion],
    });
    mockCoreCanvas.proxyCoreGetQuizQuestion.mockResolvedValue({
      success: true,
      data: mockQuizQuestion,
    });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    if (prisma) await prisma.$disconnect();
  });

  it("skips a failing question without a ReferenceError in the catch", async () => {
    const spy = vi
      .spyOn(prisma.questionMetadata, "create")
      .mockRejectedValue(new Error("simulated insert failure"));
    try {
      const promise = canvas.importQuizFromCanvas(
        USER.id,
        101,
        1,
        courseId,
        { primaryTopicId: topicId },
        USER.id,
        TEST_COOKIE,
      );
      await expect(promise).rejects.toThrow(/No questions could be imported/);
      await expect(promise).rejects.not.toThrow(/canvasQuestion is not defined/);
    } finally {
      spy.mockRestore();
    }
  });
});
