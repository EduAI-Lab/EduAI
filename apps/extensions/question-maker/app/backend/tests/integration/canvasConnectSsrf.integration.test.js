/**
 * POST /api/canvas/connect now proxies to Core (#1084): QM no longer runs the
 * local SSRF guard. These tests assert the body is forwarded and Core errors
 * are surfaced to the caller.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";

const { canvas, mockCoreCanvas, mockCourseFindOne, mockEnrollments } = vi.hoisted(() => ({
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
    assessments: { findUnique: vi.fn() },
    questionMetadata: {},
    variants: {},
    assessmentSections: {},
    topics: {},
  },
}));

const { default: app } = await import("../../src/app.js");

const INSTRUCTOR = { id: "inst-1", role: "INSTRUCTOR", email: "i@t.co", name: "I" };

function authAsInstructor() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ user: INSTRUCTOR }) }),
  );
  mockEnrollments.mockResolvedValue({
    enrollments: [{ studentId: INSTRUCTOR.id, role: "INSTRUCTOR", isActive: true }],
  });
  mockCourseFindOne.mockResolvedValue({
    id: 1,
    userId: "owner-1",
    coreCourseId: "cuid-core-course",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authAsInstructor();
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/canvas/connect — Core proxy (#1084)", () => {
  it.each([
    ["cloud metadata IP", "https://169.254.169.254/"],
    ["loopback IP", "https://127.0.0.1/"],
    ["private 10/8", "https://10.1.2.3/"],
    ["private 192.168/16", "https://192.168.1.1/"],
    ["non-HTTPS scheme", "http://canvas.example.com/"],
    // Non-canonical bases: QM's own guard used to reject these before the
    // proxy existed, and Core's parseAndValidateCanvasUrl does now (#1509).
    ["embedded credentials", "https://user:pass@canvas.example.com/"],
    ["query string", "https://canvas.example.com/?redirect=http://169.254.169.254"],
    ["fragment", "https://canvas.example.com/#frag"],
  ])("forwards %s (%s) to Core and surfaces Core rejection", async (_label, canvasUrl) => {
    const coreErr = Object.assign(new Error("Canvas URL is not allowed"), {
      status: 400,
      body: { error: "Canvas URL is not allowed" },
    });
    mockCoreCanvas.proxyCoreCanvasConnect.mockRejectedValue(coreErr);

    const body = { canvasUrl, isTestMode: true };
    const res = await request(app)
      .post("/api/canvas/connect")
      .set("Cookie", "session=v")
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, code: "Canvas URL is not allowed" });
    expect(mockCoreCanvas.proxyCoreCanvasConnect).toHaveBeenCalledWith("session=v", body);
  });

  it("accepts a valid https Canvas URL when Core succeeds", async () => {
    const body = { canvasUrl: "https://canvas.example.com", isTestMode: true };
    mockCoreCanvas.proxyCoreCanvasConnect.mockResolvedValue({
      success: true,
      message: "Canvas test mode enabled. You can test exports without a real Canvas account.",
      data: { canvasUrl: body.canvasUrl, isTestMode: true, isConnected: true },
    });

    const res = await request(app)
      .post("/api/canvas/connect")
      .set("Cookie", "session=v")
      .send(body);

    expect(res.status).toBe(200);
    expect(mockCoreCanvas.proxyCoreCanvasConnect).toHaveBeenCalledWith("session=v", body);
  });
});
