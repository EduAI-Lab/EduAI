/**
 * Route-level error-contract tests for the Core-proxied Canvas reads (#1084/#1509).
 *
 * Unlike canvasRbac/canvasRouteCoverage, this file does NOT mock canvasService —
 * it exercises the real service wrapper plus the real errorHandler so that the
 * status/code/isPublic metadata `fetchFromCore` attaches to Core failures is
 * asserted end to end. Regression guard: the wrapper used to rethrow a bare
 * `Error`, which collapsed every Core 400/401/502 into a 500 "Request failed".
 *
 * Only coreApiService and the DB are mocked — no live Core or test DB required.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";

const { mockCore, mockCourseFindOne, mockEnrollments } = vi.hoisted(() => ({
  mockCore: {
    proxyCoreCanvasGetIntegration: vi.fn(),
    proxyCoreListQuizzes: vi.fn(),
    proxyCoreListQuizQuestions: vi.fn(),
  },
  mockCourseFindOne: vi.fn(),
  mockEnrollments: vi.fn(),
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
vi.mock("../../src/services/coreApiService.js", () => ({
  getCourseEnrollmentsFromCore: mockEnrollments,
  getCourseFromCore: vi.fn().mockResolvedValue({ id: "cuid-core-course", department: "COSC" }),
  getMyProfileFromCore: vi.fn().mockResolvedValue({ authorizedUnits: [] }),
  proxyCoreCanvasConnect: vi.fn(),
  proxyCoreCanvasDisconnect: vi.fn(),
  proxyCoreCanvasListCourses: vi.fn(),
  proxyCoreCreateQuiz: vi.fn(),
  proxyCoreCreateQuizQuestion: vi.fn(),
  proxyCoreDeleteQuiz: vi.fn(),
  proxyCoreGetQuiz: vi.fn(),
  proxyCoreGetQuizQuestion: vi.fn(),
  proxyCoreGetQuestionBank: vi.fn(),
  proxyCoreListQuestionBankQuestions: vi.fn(),
  proxyCoreListQuestionBanks: vi.fn(),
  ...mockCore,
}));
vi.mock("../../src/config/database.js", () => ({
  prisma: {
    course: { findUnique: mockCourseFindOne },
    assessments: { findUnique: vi.fn() },
    canvasCourseMapping: {},
    topics: {},
    questionMetadata: {},
    variants: {},
    assessmentSections: {},
    sectionVariants: {},
  },
}));

const { default: app } = await import("../../src/app.js");

const INSTRUCTOR = { id: "inst-1", role: "INSTRUCTOR", email: "i@t.co", name: "I" };

function authAs(user, enrollRole = "INSTRUCTOR") {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ user }) }),
  );
  mockEnrollments.mockResolvedValue({
    enrollments: [{ studentId: user.id, role: enrollRole, isActive: true }],
  });
  mockCourseFindOne.mockResolvedValue({ id: 1, userId: user.id, coreCourseId: "cuid-core-course" });
}

/** Mirrors the shape `coreApiService.coreError` builds for a Core failure. */
function coreError(code, status) {
  return Object.assign(new Error(code), {
    status,
    body: { error: code },
    code,
    isPublic: true,
  });
}

const QUIZZES_URL = "/api/canvas/courses/1234/quizzes";

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("Canvas read proxy error contract", () => {
  it("relays a Core 400 CANVAS_NOT_CONNECTED as 400, not 500 Request failed", async () => {
    authAs(INSTRUCTOR);
    mockCore.proxyCoreCanvasGetIntegration.mockResolvedValue({
      success: true,
      data: { canvasUrl: "https://x.test", isConnected: true },
    });
    mockCore.proxyCoreListQuizzes.mockRejectedValue(coreError("CANVAS_NOT_CONNECTED", 400));

    const res = await request(app).get(QUIZZES_URL).set("Cookie", "session=v");

    expect(res.status).toBe(400);
    expect(res.body.error).not.toBe("Request failed");
    expect(res.body.error).toMatch(/Canvas integration not configured/i);
    expect(res.body.code).toBe("CANVAS_NOT_CONNECTED");
  });

  it("relays a Core 502 upstream failure as 502", async () => {
    authAs(INSTRUCTOR);
    mockCore.proxyCoreCanvasGetIntegration.mockResolvedValue({
      success: true,
      data: { canvasUrl: "https://x.test", isConnected: true },
    });
    mockCore.proxyCoreListQuizzes.mockRejectedValue(coreError("CANVAS_API_ERROR", 502));

    const res = await request(app).get(QUIZZES_URL).set("Cookie", "session=v");

    expect(res.status).toBe(502);
    expect(res.body.error).not.toBe("Request failed");
    expect(res.body.code).toBe("CANVAS_API_ERROR");
  });

  it("relays a Core 401 as 401", async () => {
    authAs(INSTRUCTOR);
    mockCore.proxyCoreCanvasGetIntegration.mockResolvedValue({
      success: true,
      data: { canvasUrl: "https://x.test", isConnected: true },
    });
    mockCore.proxyCoreListQuizzes.mockRejectedValue(coreError("CANVAS_UNAUTHORIZED", 401));

    const res = await request(app).get(QUIZZES_URL).set("Cookie", "session=v");

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("CANVAS_UNAUTHORIZED");
  });

  it("answers 400 CANVAS_NOT_CONNECTED when Core reports no integration at all", async () => {
    authAs(INSTRUCTOR);
    mockCore.proxyCoreCanvasGetIntegration.mockResolvedValue({ success: true, data: null });

    const res = await request(app).get(QUIZZES_URL).set("Cookie", "session=v");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Canvas integration not configured/i);
    expect(res.body.code).toBe("CANVAS_NOT_CONNECTED");
    expect(mockCore.proxyCoreListQuizzes).not.toHaveBeenCalled();
  });

  it("keeps a transport failure with no Core status as a 500 with no leaked code", async () => {
    authAs(INSTRUCTOR);
    mockCore.proxyCoreCanvasGetIntegration.mockResolvedValue({
      success: true,
      data: { canvasUrl: "https://x.test", isConnected: true },
    });
    mockCore.proxyCoreListQuizzes.mockRejectedValue(
      Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }),
    );

    const res = await request(app).get(QUIZZES_URL).set("Cookie", "session=v");

    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Request failed");
    expect(res.body.code).toBeUndefined();
  });
});
