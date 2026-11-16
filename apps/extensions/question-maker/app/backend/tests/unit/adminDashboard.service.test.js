/**
 * Unit tests for the ADMIN dashboard rollup (`adminDashboardService.js`) and
 * its route. Prisma, the EduAI service and Core's bug-report endpoint are
 * mocked, so this covers the counting, the attention wording, the health rows
 * and how a failed Core call degrades.
 */
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/settings.js", () => {
  const cfg = { coreUrl: "http://core.test", eduaiApiKey: "key" };
  return { config: cfg, default: cfg };
});

const prismaMock = vi.hoisted(() => ({
  questionMetadata: { count: vi.fn(), findMany: vi.fn() },
  variants: { count: vi.fn() },
  course: { count: vi.fn() },
  canvasCourseMapping: { count: vi.fn() },
  canvasBankMapping: { count: vi.fn() },
  assessments: { groupBy: vi.fn(), count: vi.fn(), findMany: vi.fn() },
  $queryRaw: vi.fn(),
}));
vi.mock("../../src/config/database.js", () => ({ prisma: prismaMock }));

const eduaiMock = vi.hoisted(() => ({
  listAIModels: vi.fn(),
  getAiStatus: vi.fn(),
  hasApiKey: vi.fn(),
}));
vi.mock("../../src/services/eduaiService.js", () => ({ eduaiService: eduaiMock }));

const authState = vi.hoisted(() => ({ role: "ADMIN" }));
vi.mock("../../src/middleware/auth.js", () => ({
  requireAuth: (req, _res, next) => {
    req.user = { id: "u1", role: authState.role };
    next();
  },
  requireRole: (role) => (req, res, next) =>
    req.user.role === role ? next() : res.status(403).json({ success: false }),
}));

const {
  aiServiceHealthItems,
  connectionHealthItems,
  fillWeeklyVersions,
  loadAdminDashboard,
  startOfUtcWeek,
  USAGE_WEEKS,
} = await import("../../src/services/adminDashboardService.js");
const { default: adminDashboardRoutes } = await import("../../src/routes/admin-dashboard.js");

const NOW = new Date("2026-11-11T15:00:00Z"); // a Wednesday

const MODELS = [
  { modelId: "qwen3.5-9b-instruct", name: "Qwen 9B", provider: "vllm", isActive: true },
  { modelId: "qwen3.5-2b-instruct", name: "Qwen 2B", provider: "vllm", isActive: true },
];

function mockCounts() {
  // Order matches the count() calls in loadAdminDashboard.
  prismaMock.questionMetadata.count
    .mockResolvedValueOnce(40) // questions
    .mockResolvedValueOnce(3); // questions with no versions
  prismaMock.variants.count
    .mockResolvedValueOnce(120) // versions
    .mockResolvedValueOnce(30) // drafts
    .mockResolvedValueOnce(70) // AI-generated
    .mockResolvedValueOnce(12) // shared
    .mockResolvedValueOnce(5); // stale AI drafts
  prismaMock.course.count.mockResolvedValueOnce(9).mockResolvedValueOnce(6);
  prismaMock.canvasCourseMapping.count.mockResolvedValue(4);
  prismaMock.assessments.groupBy.mockResolvedValue([
    { type: "Quiz", _count: { _all: 7 } },
    { type: "Final", _count: { _all: 2 } },
  ]);
  prismaMock.assessments.count.mockResolvedValue(1);
  prismaMock.canvasBankMapping.count.mockResolvedValue(0);
  prismaMock.$queryRaw.mockResolvedValue([
    { week: "2026-11-09T00:00:00Z", isAiGenerated: true, count: 4 },
    { week: "2026-11-09T00:00:00Z", isAiGenerated: false, count: 2 },
  ]);
  prismaMock.questionMetadata.findMany.mockResolvedValue([
    {
      id: 1,
      description: "Define entropy",
      type: "SA",
      courseId: 3,
      updatedAt: new Date("2026-11-10T10:00:00Z"),
      creator: { name: "Ada" },
    },
  ]);
  prismaMock.assessments.findMany.mockResolvedValue([
    { id: 8, name: "Midterm 1", courseId: 3, updatedAt: new Date("2026-11-11T09:00:00Z") },
  ]);
}

beforeEach(() => {
  vi.resetAllMocks();
  authState.role = "ADMIN";
  eduaiMock.hasApiKey.mockReturnValue(true);
  eduaiMock.listAIModels.mockResolvedValue(MODELS);
  eduaiMock.getAiStatus.mockResolvedValue({
    status: 200,
    body: {
      ubc: { state: "operational", detail: "UBC-hosted inference is reachable." },
      cloud: { state: "degraded", detail: "Slow" },
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => ({ total: 2, reports: [] }) }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("startOfUtcWeek / fillWeeklyVersions", () => {
  it("starts weeks on Monday UTC", () => {
    expect(startOfUtcWeek(NOW).toISOString()).toBe("2026-11-09T00:00:00.000Z");
  });

  it("fills every week, oldest first, splitting AI and hand-written", () => {
    const weeks = fillWeeklyVersions(
      [
        { week: "2026-11-09T00:00:00Z", isAiGenerated: true, count: 4 },
        { week: "2026-11-09T00:00:00Z", isAiGenerated: false, count: 2 },
        { week: "2026-11-02T00:00:00Z", isAiGenerated: false, count: 1 },
      ],
      NOW,
    );
    expect(weeks).toHaveLength(USAGE_WEEKS);
    expect(weeks.at(-1)).toEqual({ weekStart: "2026-11-09", ai: 4, manual: 2 });
    expect(weeks.at(-2)).toEqual({ weekStart: "2026-11-02", ai: 0, manual: 1 });
    expect(weeks[0]).toEqual({ weekStart: "2026-05-18", ai: 0, manual: 0 });
  });
});

describe("health rows", () => {
  it("maps Core's service states onto health statuses", () => {
    const rows = aiServiceHealthItems({
      status: 200,
      body: {
        ubc: { state: "outage", detail: "Down" },
        cloud: { state: "operational", detail: "" },
      },
    });
    expect(rows.map((r) => [r.id, r.status])).toEqual([
      ["ubc-ai", "failed"],
      ["cloud-ai", "ok"],
    ]);
  });

  it("marks both AI rows failed when Core's status can't be read", () => {
    const rows = aiServiceHealthItems({ status: 502, body: { error: "x" } });
    expect(rows.every((r) => r.status === "failed")).toBe(true);
  });

  it("reports the generation model QM will pick from the catalog", () => {
    const rows = connectionHealthItems({ hasApiKey: true, models: MODELS, modelsError: null });
    expect(rows).toEqual([
      expect.objectContaining({ id: "eduai-api-key", status: "ok" }),
      expect.objectContaining({ id: "model-catalog", status: "ok", detail: "2 models available" }),
      expect.objectContaining({ id: "generation-model", status: "ok", detail: "Qwen 9B" }),
    ]);
  });

  it("flags a missing key, an empty catalog and no model to generate with", () => {
    const rows = connectionHealthItems({ hasApiKey: false, models: [], modelsError: null });
    expect(rows.map((r) => r.status)).toEqual(["not-set", "failed", "failed"]);
  });

  it("fails the catalog and model rows when the catalog call errors", () => {
    const rows = connectionHealthItems({ hasApiKey: true, models: [], modelsError: "Timeout" });
    expect(rows[1]).toMatchObject({ status: "failed", detail: "Timeout" });
    expect(rows[2]).toMatchObject({ status: "failed" });
  });
});

describe("loadAdminDashboard", () => {
  it("returns content, course, assessment, attention, health and usage data", async () => {
    mockCounts();
    const data = await loadAdminDashboard({ cookie: "session=abc", now: NOW });

    expect(data.content).toEqual({
      questions: 40,
      versions: 120,
      drafts: 30,
      reviewed: 90,
      aiGenerated: 70,
      shared: 12,
    });
    expect(data.courses).toEqual({ total: 9, withQuestions: 6, canvasLinked: 4 });
    expect(data.assessments.total).toBe(9);
    expect(data.assessments.byType).toContainEqual({ type: "Quiz", count: 7 });
    expect(data.assessments.byType).toContainEqual({ type: "Lab", count: 0 });

    expect(data.attention.map((a) => [a.id, a.count])).toEqual([
      ["open-bug-reports", 2],
      ["stale-ai-drafts", 5],
      ["questions-without-versions", 3],
      ["empty-assessments", 1],
      ["stale-canvas-banks", 0],
    ]);
    expect(data.attention[0].description).toBe("2 reports need triage.");
    expect(data.attention[4].description).toBe("Every Canvas bank synced in the last 30 days.");

    expect(data.health.map((h) => h.id)).toEqual([
      "ubc-ai",
      "cloud-ai",
      "eduai-api-key",
      "model-catalog",
      "generation-model",
    ]);
    expect(data.weeklyVersions.at(-1)).toEqual({ weekStart: "2026-11-09", ai: 4, manual: 2 });

    expect(data.recentActivity.map((r) => r.id)).toEqual(["assessment-8", "question-1"]);
    expect(data.recentActivity[1]).toMatchObject({
      label: "Define entropy",
      by: "Ada",
      href: "/courses/3?tab=questions",
    });
  });

  it("asks Core for unhandled Question Maker reports with the admin's cookie", async () => {
    mockCounts();
    await loadAdminDashboard({ cookie: "session=abc", now: NOW });

    const [url, init] = fetch.mock.calls[0];
    const parsed = new URL(url);
    expect(parsed.pathname).toBe("/api/admin/bug-reports");
    expect(parsed.searchParams.get("source")).toBe("QUESTION_MAKER");
    expect(parsed.searchParams.get("status")).toBe("UNHANDLED");
    expect(init.headers).toEqual({ cookie: "session=abc" });
    expect(eduaiMock.listAIModels).toHaveBeenCalledWith({ cookie: "session=abc" });
  });

  it("drops the bug-report row when Core can't be reached, keeping the rest", async () => {
    mockCounts();
    fetch.mockRejectedValue(new Error("ECONNREFUSED"));
    const data = await loadAdminDashboard({ now: NOW });
    expect(data.attention.map((a) => a.id)).not.toContain("open-bug-reports");
    expect(data.attention).toHaveLength(4);
  });
});

describe("GET /api/admin/dashboard", () => {
  function app() {
    const server = express();
    server.use("/api", adminDashboardRoutes);
    server.use((err, _req, res, _next) => res.status(500).json({ success: false }));
    return server;
  }

  it("returns the rollup to an admin", async () => {
    mockCounts();
    const res = await request(app()).get("/api/admin/dashboard").set("Cookie", "session=abc");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.content.questions).toBe(40);
  });

  it("refuses anyone who isn't an admin", async () => {
    authState.role = "INSTRUCTOR";
    const res = await request(app()).get("/api/admin/dashboard");
    expect(res.status).toBe(403);
    expect(prismaMock.questionMetadata.count).not.toHaveBeenCalled();
  });
});
