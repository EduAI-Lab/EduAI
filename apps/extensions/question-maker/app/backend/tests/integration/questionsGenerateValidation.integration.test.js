/**
 * HTTP validation tests for POST /api/questions/generate (400 responses).
 * Auth and course access are stubbed via Core/DB; no AI provider calls are
 * needed for the request-budget guards.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";

const { mockGenerate } = vi.hoisted(() => ({ mockGenerate: vi.fn() }));

vi.mock("../../src/services/authService.js", () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

const { mockCourseFindOne, mockEnrollments } = vi.hoisted(() => ({
  mockCourseFindOne: vi.fn(),
  mockEnrollments: vi.fn(),
}));

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    course: { findUnique: mockCourseFindOne },
  },
}));

vi.mock("../../src/services/coreApiService.js", () => ({
  getCourseEnrollmentsFromCore: mockEnrollments,
  getCourseFromCore: vi.fn().mockResolvedValue({ id: "cuid-core-course", department: "COSC" }),
  getMyProfileFromCore: vi.fn().mockResolvedValue({ authorizedUnits: [] }),
}));

vi.mock("../../src/config/settings.js", () => {
  const cfg = {
    coreUrl: "http://core.test",
    corsOrigins: ["*"],
    nodeEnv: "test",
    logLevel: "silent",
    maxQuestions: 5,
    qmGeneratePromptMaxChars: 20,
    qmAiRateLimitMax: 100,
  };
  return { config: cfg, default: cfg };
});

vi.mock("../../src/services/aiService.js", () => ({
  generateQuestions: mockGenerate,
  extractQuestionsFromText: vi.fn(),
  AI_PROVIDERS: { GROQ: "groq" },
}));

const { default: app } = await import("../../src/app.js");
const { config } = await import("../../src/config/settings.js");

const TEST_USER = {
  id: "cuid-test-user",
  email: "test@test.com",
  role: "INSTRUCTOR",
  name: "Test User",
};

beforeEach(() => {
  mockGenerate.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ user: TEST_USER }),
    }),
  );
  mockCourseFindOne.mockResolvedValue({
    id: 1,
    userId: TEST_USER.id,
    coreCourseId: "cuid-core-course",
  });
  mockEnrollments.mockResolvedValue({
    enrollments: [{ studentId: TEST_USER.id, role: "INSTRUCTOR", isActive: true }],
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("Questions generate HTTP validation (integration)", () => {
  describe("POST /api/questions/generate", () => {
    it("returns 400 when prompt is missing", async () => {
      const res = await request(app)
        .post("/api/questions/generate")
        .set("Cookie", "session=valid")
        .send({ courseId: 1, numQuestions: 5 });
      expect(res.status).toBe(400);
      expect(String(res.body.error || "")).toMatch(/[Pp]rompt|required/i);
    });

    it("returns 400 when numQuestions exceeds maxQuestions", async () => {
      const res = await request(app)
        .post("/api/questions/generate")
        .set("Cookie", "session=valid")
        .send({ courseId: 1, prompt: "Write many MCQs", numQuestions: config.maxQuestions + 1 });
      expect(res.status).toBe(400);
      expect(String(res.body.error || "")).toMatch(/numQuestions|exceed|max/i);
    });

    it("rejects an oversized prompt before invoking a provider", async () => {
      const res = await request(app)
        .post("/api/questions/generate")
        .set("Cookie", "session=valid")
        .send({
          courseId: 1,
          prompt: "x".repeat(config.qmGeneratePromptMaxChars + 1),
          numQuestions: 1,
        });
      expect(res.status).toBe(413);
      expect(String(res.body.error || "")).toMatch(/prompt|characters|large/i);
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it("rejects non-integer question counts", async () => {
      const res = await request(app)
        .post("/api/questions/generate")
        .set("Cookie", "session=valid")
        .send({ courseId: 1, prompt: "Write one question", numQuestions: 1.5 });
      expect(res.status).toBe(400);
      expect(String(res.body.error || "")).toMatch(/positive integer/i);
      expect(mockGenerate).not.toHaveBeenCalled();
    });

    it("requires a caller-authorized course context", async () => {
      const res = await request(app)
        .post("/api/questions/generate")
        .set("Cookie", "session=valid")
        .send({ prompt: "Write one question", numQuestions: 1 });
      expect(res.status).toBe(404);
    });

    it("rejects a course the caller cannot author in before invoking a provider", async () => {
      mockCourseFindOne.mockResolvedValue({
        id: 1,
        userId: "other-owner",
        coreCourseId: "cuid-core-course",
      });
      mockEnrollments.mockResolvedValue({ enrollments: [] });
      const res = await request(app)
        .post("/api/questions/generate")
        .set("Cookie", "session=valid")
        .send({ courseId: 1, prompt: "Write one question", numQuestions: 1 });
      expect(res.status).toBe(403);
      expect(mockGenerate).not.toHaveBeenCalled();
    });
  });
});
