/**
 * Coverage-focused route tests for canvas.js (issue #1217: canvas.js was one
 * of the worst-covered files at 45%). canvasRbac.test.js already covers the
 * role/course-access gates; this file exercises the remaining business-logic
 * branches: integration/connect/disconnect/courses Core proxying, export/import
 * validation and the topic-must-exist-in-course check, and quiz browsing.
 *
 * Same mocked-DB pattern as canvasRbac.test.js — no live Core or test DB required.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";

const {
  canvas,
  mockCoreCanvas,
  mockCourseFindOne,
  mockAssessmentFindOne,
  mockEnrollments,
  mockTopicFindFirst,
} = vi.hoisted(() => ({
  canvas: {
    exportAssessmentToCanvas: vi.fn(),
    getCanvasCourseMapping: vi.fn(),
    getCanvasQuizzes: vi.fn(),
    getCanvasQuizQuestions: vi.fn(),
    importQuizFromCanvas: vi.fn(),
  },
  mockCoreCanvas: {
    proxyCoreCanvasGetIntegration: vi.fn(),
    proxyCoreCanvasConnect: vi.fn(),
    proxyCoreCanvasDisconnect: vi.fn(),
    proxyCoreCanvasListCourses: vi.fn(),
  },
  mockCourseFindOne: vi.fn(),
  mockAssessmentFindOne: vi.fn(),
  mockEnrollments: vi.fn(),
  mockTopicFindFirst: vi.fn(),
}));

vi.mock("../../src/services/authService.js", () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../src/config/settings.js", () => {
  const cfg = {
    coreUrl: "http://core.test",
    eduaiApiKey: "k",
    corsOrigins: ["*"],
    nodeEnv: "test",
    logLevel: "silent",
  };
  return { config: cfg, default: cfg };
});
vi.mock("../../src/services/canvasService.js", () => canvas);
vi.mock("../../src/services/coreApiService.js", () => ({
  getCourseEnrollmentsFromCore: mockEnrollments,
  getCourseFromCore: vi.fn().mockResolvedValue({ id: "cuid-core-course", department: "COSC" }),
  getMyProfileFromCore: vi.fn().mockResolvedValue({ authorizedUnits: [] }),
  ...mockCoreCanvas,
}));
vi.mock("../../src/config/database.js", () => ({
  prisma: {
    course: { findUnique: mockCourseFindOne },
    assessments: { findUnique: mockAssessmentFindOne },
    topics: { findFirst: mockTopicFindFirst },
    questionMetadata: {},
    variants: {},
    assessmentSections: {},
  },
}));

const { default: app } = await import("../../src/app.js");

const INSTRUCTOR = { id: "inst-1", role: "INSTRUCTOR", email: "i@t.co", name: "I" };
const COURSE = { id: 1, userId: "owner-1", coreCourseId: "cuid-core-course" };

function authAs(user, enrollRole) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ user }) }),
  );
  mockEnrollments.mockResolvedValue({
    enrollments: enrollRole ? [{ studentId: user.id, role: enrollRole, isActive: true }] : [],
  });
  mockCourseFindOne.mockResolvedValue(COURSE);
  mockAssessmentFindOne.mockResolvedValue({ id: 5, course: COURSE });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("GET /api/canvas/integration", () => {
  it("returns the connected integration (API key withheld)", async () => {
    authAs(INSTRUCTOR, "INSTRUCTOR");
    mockCoreCanvas.proxyCoreCanvasGetIntegration.mockResolvedValue({
      success: true,
      data: { canvasUrl: "https://x.test", isTestMode: false, isConnected: true },
    });

    const res = await request(app).get("/api/canvas/integration").set("Cookie", "session=v");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      canvasUrl: "https://x.test",
      isTestMode: false,
      isConnected: true,
    });
    expect(res.body.data.apiKey).toBeUndefined();
    expect(mockCoreCanvas.proxyCoreCanvasGetIntegration).toHaveBeenCalledWith("session=v");
  });
});

describe("POST /api/canvas/connect", () => {
  it("forwards the body to Core and returns the saved integration", async () => {
    authAs(INSTRUCTOR, "INSTRUCTOR");
    mockCoreCanvas.proxyCoreCanvasConnect.mockResolvedValue({
      success: true,
      message: "Canvas test mode enabled. You can test exports without a real Canvas account.",
      data: { canvasUrl: "https://canvas.test", isTestMode: true, isConnected: true },
    });

    const body = { canvasUrl: "https://canvas.test", isTestMode: true };
    const res = await request(app)
      .post("/api/canvas/connect")
      .set("Cookie", "session=v")
      .send(body);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/test mode/i);
    expect(mockCoreCanvas.proxyCoreCanvasConnect).toHaveBeenCalledWith("session=v", body);
  });

  it("forwards Core validation errors", async () => {
    authAs(INSTRUCTOR, "INSTRUCTOR");
    const coreErr = Object.assign(new Error("Invalid input"), {
      status: 400,
      body: { error: "Invalid input", details: { fieldErrors: { canvasUrl: ["Required"] } } },
    });
    mockCoreCanvas.proxyCoreCanvasConnect.mockRejectedValue(coreErr);

    const res = await request(app).post("/api/canvas/connect").set("Cookie", "session=v").send({});

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, code: "Invalid input" });
  });
});

describe("DELETE /api/canvas/disconnect", () => {
  it("proxies disconnect to Core", async () => {
    authAs(INSTRUCTOR, "INSTRUCTOR");
    mockCoreCanvas.proxyCoreCanvasDisconnect.mockResolvedValue({
      success: true,
      message: "Canvas integration disconnected",
    });

    const res = await request(app).delete("/api/canvas/disconnect").set("Cookie", "session=v");

    expect(res.status).toBe(200);
    expect(mockCoreCanvas.proxyCoreCanvasDisconnect).toHaveBeenCalledWith("session=v");
  });
});

describe("GET /api/canvas/courses", () => {
  it("lists Canvas courses in the frontend Canvas API shape", async () => {
    authAs(INSTRUCTOR, "INSTRUCTOR");
    mockCoreCanvas.proxyCoreCanvasListCourses.mockResolvedValue({
      success: true,
      data: {
        courses: [{ canvasId: "101", name: "Intro", courseCode: "COSC 101" }],
      },
    });

    const res = await request(app).get("/api/canvas/courses").set("Cookie", "session=v");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: 101, name: "Intro", course_code: "COSC 101" }]);
  });
});

describe("POST /api/canvas/export/:assessmentId", () => {
  it("requires canvasCourseId", async () => {
    authAs(INSTRUCTOR, "INSTRUCTOR");
    const res = await request(app).post("/api/canvas/export/5").set("Cookie", "session=v").send({});
    expect(res.status).toBe(400);
  });
});

describe("GET /api/canvas/courses/:canvasCourseId/quizzes", () => {
  it("lists quizzes for the Canvas course", async () => {
    authAs(INSTRUCTOR, "INSTRUCTOR");
    canvas.getCanvasQuizzes.mockResolvedValue([{ id: "q1" }]);

    const res = await request(app).get("/api/canvas/courses/c1/quizzes").set("Cookie", "session=v");

    expect(res.status).toBe(200);
    expect(canvas.getCanvasQuizzes).toHaveBeenCalledWith("session=v", "c1");
  });
});

describe("GET /api/canvas/courses/:canvasCourseId/quizzes/:quizId/questions", () => {
  it("lists quiz questions", async () => {
    authAs(INSTRUCTOR, "INSTRUCTOR");
    canvas.getCanvasQuizQuestions.mockResolvedValue([{ id: "qq1" }]);

    const res = await request(app)
      .get("/api/canvas/courses/c1/quizzes/z1/questions")
      .set("Cookie", "session=v");

    expect(res.status).toBe(200);
    expect(canvas.getCanvasQuizQuestions).toHaveBeenCalledWith("session=v", "c1", "z1");
  });
});

describe("POST /api/canvas/import/:canvasCourseId/quizzes/:quizId", () => {
  it("requires primaryTopicId", async () => {
    authAs(INSTRUCTOR, "INSTRUCTOR");
    const res = await request(app)
      .post("/api/canvas/import/c1/quizzes/z1")
      .set("Cookie", "session=v")
      .send({ localCourseId: 1 });
    expect(res.status).toBe(400);
  });

  it("returns 404 when the topic does not belong to the course", async () => {
    authAs(INSTRUCTOR, "INSTRUCTOR");
    mockTopicFindFirst.mockResolvedValue(null);

    const res = await request(app)
      .post("/api/canvas/import/c1/quizzes/z1")
      .set("Cookie", "session=v")
      .send({ localCourseId: 1, primaryTopicId: "missing-topic" });

    expect(res.status).toBe(404);
    expect(canvas.importQuizFromCanvas).not.toHaveBeenCalled();
  });

  it("imports the quiz on success", async () => {
    authAs(INSTRUCTOR, "INSTRUCTOR");
    mockTopicFindFirst.mockResolvedValue({ id: "topic-1", courseId: COURSE.id });
    canvas.importQuizFromCanvas.mockResolvedValue({ assessmentId: 9 });

    const res = await request(app)
      .post("/api/canvas/import/c1/quizzes/z1")
      .set("Cookie", "session=v")
      .send({ localCourseId: 1, primaryTopicId: "topic-1", assessmentName: "Imported Quiz" });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ assessmentId: 9 });
    expect(canvas.importQuizFromCanvas).toHaveBeenCalledWith(
      INSTRUCTOR.id,
      "c1",
      "z1",
      COURSE.id,
      expect.objectContaining({ primaryTopicId: "topic-1", assessmentName: "Imported Quiz" }),
      COURSE.userId,
      "session=v",
    );
  });
});
