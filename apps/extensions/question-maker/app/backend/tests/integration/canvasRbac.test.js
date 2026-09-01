/**
 * Route-level RBAC tests for Canvas (#314, §18):
 *   - canvas_integrations are instructor-and-up own-only (TA/STUDENT rejected),
 *   - canvas_course_mappings + export are course-scoped instructor-only
 *     (TA/STUDENT rejected),
 *   - INSTRUCTOR can read/write their own integration and course mappings,
 *   - UNIT_ADMIN keeps that same personal-integration access end to end: QM's
 *     `CANVAS_ROLES` gate and Core's `canManageCanvasIntegration` must agree, or
 *     the cookie-only proxy turns an allowed QM call into a Core 403 (#1084).
 *
 * No DB / live Core: canvasService, schema, and RBAC Core reads are mocked.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import supertest from "supertest";

const { canvas, mockCoreCanvas, mockCourseFindOne, mockAssessmentFindOne, mockEnrollments } =
  vi.hoisted(() => ({
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
    questionMetadata: {},
    variants: {},
    assessmentSections: {},
    topics: {},
  },
}));

const { default: app } = await import("../../src/app.js");
const request = () => supertest.agent(app).set("Sec-Fetch-Site", "same-origin");

const TA = { id: "ta-1", role: "TA", email: "t@t.co", name: "TA" };
const INSTRUCTOR = { id: "inst-1", role: "INSTRUCTOR", email: "i@t.co", name: "I" };
const UNIT_ADMIN = { id: "ua-1", role: "UNIT_ADMIN", email: "u@t.co", name: "U" };
const STUDENT = { id: "stu-1", role: "STUDENT", email: "s@t.co", name: "S" };
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

describe("canvas_integrations are instructor-and-up own-only (§18)", () => {
  it.each([
    ["get", "/api/canvas/integration", TA],
    ["post", "/api/canvas/connect", TA],
    ["delete", "/api/canvas/disconnect", TA],
    ["get", "/api/canvas/integration", STUDENT],
  ])("%s %s rejected for %s", async (method, path, user) => {
    authAs(user, user.role === "TA" ? "TA" : null);
    const res = await request(app)
      [method](path)
      .set("Cookie", "session=v")
      .send({ canvasUrl: "https://x.test" });
    expect(res.status).toBe(403);
  });

  it("INSTRUCTOR reads own integration → 200", async () => {
    authAs(INSTRUCTOR, "INSTRUCTOR");
    mockCoreCanvas.proxyCoreCanvasGetIntegration.mockResolvedValue({
      success: true,
      data: null,
      message: "Canvas integration not configured",
    });
    const res = await request(app).get("/api/canvas/integration").set("Cookie", "session=v");
    expect(res.status).toBe(200);
    expect(mockCoreCanvas.proxyCoreCanvasGetIntegration).toHaveBeenCalledWith("session=v");
  });

  it("UNIT_ADMIN reads own integration through the Core proxy → 200", async () => {
    authAs(UNIT_ADMIN, null);
    mockCoreCanvas.proxyCoreCanvasGetIntegration.mockResolvedValue({
      success: true,
      data: { canvasUrl: "https://x.test", isTestMode: false, isConnected: true },
    });
    const res = await request(app).get("/api/canvas/integration").set("Cookie", "session=v");
    expect(res.status).toBe(200);
    expect(res.body.data.canvasUrl).toBe("https://x.test");
    // Cookie-only: the caller's own session is what Core authorizes, so a
    // UNIT_ADMIN who passes QM's gate must also pass Core's.
    expect(mockCoreCanvas.proxyCoreCanvasGetIntegration).toHaveBeenCalledWith("session=v");
  });

  it("UNIT_ADMIN connects own integration through the Core proxy → 200", async () => {
    authAs(UNIT_ADMIN, null);
    const body = { canvasUrl: "https://x.test", isTestMode: true };
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

  it("INSTRUCTOR connects own integration → 200", async () => {
    authAs(INSTRUCTOR, "INSTRUCTOR");
    const body = { canvasUrl: "https://x.test", isTestMode: true };
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

describe("canvas_course_mappings + export are instructor-only (§18)", () => {
  it.each([
    ["get", "/api/canvas/mapping/1"],
    ["post", "/api/canvas/export/5"],
  ])("TA %s %s → 403", async (method, path) => {
    authAs(TA, "TA");
    const res = await request(app)
      [method](path)
      .set("Cookie", "session=v")
      .send({ canvasCourseId: "c1" });
    expect(res.status).toBe(403);
  });

  it("INSTRUCTOR reads a course mapping → 200 (owner-keyed lookup)", async () => {
    authAs(INSTRUCTOR, "INSTRUCTOR");
    canvas.getCanvasCourseMapping.mockResolvedValue({ canvasCourseId: "c1" });
    const res = await request(app).get("/api/canvas/mapping/1").set("Cookie", "session=v");
    expect(res.status).toBe(200);
    expect(canvas.getCanvasCourseMapping).toHaveBeenCalledWith("owner-1", 1, "session=v");
  });

  it("INSTRUCTOR exports an assessment → uses caller creds + owner mapping", async () => {
    authAs(INSTRUCTOR, "INSTRUCTOR");
    canvas.exportAssessmentToCanvas.mockResolvedValue({ quizId: 1 });
    const res = await request(app)
      .post("/api/canvas/export/5")
      .set("Cookie", "session=v")
      .send({ canvasCourseId: "c1" });
    expect(res.status).toBe(200);
    // A request that says nothing about publishing gets the published default (#1556).
    expect(canvas.exportAssessmentToCanvas).toHaveBeenCalledWith(
      "5",
      "c1",
      "owner-1",
      "session=v",
      {
        published: true,
      },
    );
  });
});
