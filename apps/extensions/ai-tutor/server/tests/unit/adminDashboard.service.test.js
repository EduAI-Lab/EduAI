/**
 * The ADMIN dashboard rollup: weekly tutoring-session buckets, the AI tutor
 * health rows, and how each "Needs your attention" row is counted.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = {
  activity: { count: vi.fn() },
  aiChatSession: { count: vi.fn(), findMany: vi.fn() },
  submission: { count: vi.fn() },
  activityFeedback: { aggregate: vi.fn() },
  aiInteractionTrace: { count: vi.fn() },
  activityAnalytics: { count: vi.fn() },
  courseOffering: { count: vi.fn() },
  $queryRaw: vi.fn(),
};
vi.mock("../../src/config/database.js", () => ({ prisma }));
vi.mock("../../src/services/systemSettings.js", () => ({ getEduAiApiKeyStatus: vi.fn() }));
vi.mock("../../src/services/aiModelPolicy.js", () => ({ getAiModelPolicyState: vi.fn() }));

const { getEduAiApiKeyStatus } = await import("../../src/services/systemSettings.js");
const { getAiModelPolicyState } = await import("../../src/services/aiModelPolicy.js");
const {
  aiHealthItems,
  fillWeeklySessions,
  loadAdminDashboard,
  startOfUtcWeek,
  FAILED_REPLY_OUTCOMES,
  USAGE_WEEKS,
} = await import("../../src/services/adminDashboard.js");

const POLICY_STATE = {
  policy: {
    defaultTutorModelId: "google:gemini-2.5-flash",
    defaultSupervisorModelId: "ubc:qwen",
    dualLoopEnabled: true,
  },
  availableModels: [{ modelId: "google:gemini-2.5-flash" }, { modelId: "ubc:qwen" }],
  availableModelsError: null,
};

describe("weekly tutoring sessions", () => {
  it("starts weeks on Monday UTC, like Postgres date_trunc('week')", () => {
    // 2026-11-04 is a Wednesday; a Sunday belongs to the week before it.
    expect(startOfUtcWeek(new Date("2026-11-04T15:00:00Z")).toISOString()).toBe(
      "2026-11-02T00:00:00.000Z",
    );
    expect(startOfUtcWeek(new Date("2026-11-08T23:00:00Z")).toISOString()).toBe(
      "2026-11-02T00:00:00.000Z",
    );
  });

  it("fills every week in the window, with 0 for weeks without sessions", () => {
    const out = fillWeeklySessions(
      [{ week: new Date("2026-10-26T00:00:00Z"), count: 4 }],
      new Date("2026-11-04T12:00:00Z"),
    );
    expect(out).toHaveLength(USAGE_WEEKS);
    expect(out.at(-1)).toEqual({ weekStart: "2026-11-02", count: 0 });
    expect(out.at(-2)).toEqual({ weekStart: "2026-10-26", count: 4 });
  });
});

describe("AI tutor health", () => {
  it("reports the key, catalog, tutor and reviewer models as OK when all are set", () => {
    const items = aiHealthItems({ configured: true, source: "ENV" }, POLICY_STATE);
    expect(items.map((i) => [i.name, i.status])).toEqual([
      ["EduAI API key", "ok"],
      ["Model catalog (Core)", "ok"],
      ["Tutor model", "ok"],
      ["Reviewer model", "ok"],
    ]);
    expect(items[0].detail).toBe("From the environment");
  });

  it("marks a missing key not set, an unreachable catalog failed, and review off not set", () => {
    const items = aiHealthItems(
      { configured: false, source: "NONE" },
      {
        policy: { ...POLICY_STATE.policy, dualLoopEnabled: false },
        availableModels: [],
        availableModelsError: "AI model catalog unavailable",
      },
    );
    expect(items.map((i) => [i.name, i.status, i.detail])).toEqual([
      ["EduAI API key", "not-set", "No key set"],
      ["Model catalog (Core)", "failed", "AI model catalog unavailable"],
      ["Tutor model", "ok", "google:gemini-2.5-flash"],
      ["Reviewer model", "not-set", "Review is off"],
    ]);
  });

  it("fails a chosen model that has left the catalog", () => {
    const items = aiHealthItems(
      { configured: true, source: "ADMIN" },
      { ...POLICY_STATE, availableModels: [{ modelId: "ubc:qwen" }] },
    );
    expect(items.find((i) => i.id === "tutor-model")).toMatchObject({ status: "failed" });
  });
});

describe("loadAdminDashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.activity.count.mockResolvedValue(40);
    prisma.aiChatSession.count.mockResolvedValueOnce(120).mockResolvedValueOnce(9);
    prisma.aiChatSession.findMany.mockResolvedValue([{ userId: "a" }, { userId: "b" }]);
    prisma.submission.count.mockResolvedValueOnce(300).mockResolvedValueOnce(12);
    prisma.activityFeedback.aggregate.mockResolvedValue({
      _avg: { rating: 3.876 },
      _count: { _all: 25 },
    });
    prisma.aiInteractionTrace.count.mockResolvedValue(2);
    prisma.activityAnalytics.count.mockResolvedValueOnce(3).mockResolvedValueOnce(0);
    prisma.courseOffering.count.mockResolvedValue(1);
    prisma.$queryRaw.mockResolvedValue([]);
    getEduAiApiKeyStatus.mockResolvedValue({ configured: true, source: "ADMIN" });
    getAiModelPolicyState.mockResolvedValue(POLICY_STATE);
  });

  it("totals content, tutoring, submissions and ratings", async () => {
    const data = await loadAdminDashboard(new Date("2026-11-04T12:00:00Z"));
    expect(data.content).toEqual({ activities: 40 });
    expect(data.tutoring).toEqual({ sessions: 120, sessionsThisWeek: 9, learnersThisWeek: 2 });
    expect(data.submissions).toEqual({ total: 300, toReview: 12 });
    expect(data.ratings).toEqual({ average: 3.9, count: 25 });
    expect(data.weeklySessions).toHaveLength(USAGE_WEEKS);
  });

  it("counts failed replies over the last 7 days and words each attention row", async () => {
    const now = new Date("2026-11-04T12:00:00Z");
    const data = await loadAdminDashboard(now);

    expect(prisma.aiInteractionTrace.count).toHaveBeenCalledWith({
      where: {
        finalOutcome: { in: FAILED_REPLY_OUTCOMES },
        createdAt: { gte: new Date("2026-10-28T12:00:00Z") },
      },
    });
    const byId = Object.fromEntries(data.attention.map((a) => [a.id, a]));
    expect(byId["failed-replies"]).toMatchObject({
      count: 2,
      severity: "destructive",
      href: "/admin?tab=ai-oversight",
      description: "2 replies errored or fell back in the last 7 days.",
    });
    expect(byId["low-rated-activities"]).toMatchObject({
      count: 0,
      description: "No activity averages below 2.5 stars.",
    });
    expect(data.attention.map((a) => a.id)).toEqual([
      "failed-replies",
      "hard-activities",
      "low-rated-activities",
      "courses-without-activities",
      "submissions-to-review",
    ]);
  });

  it("leaves the average rating empty when nobody has rated an activity", async () => {
    prisma.activityFeedback.aggregate.mockResolvedValue({
      _avg: { rating: null },
      _count: { _all: 0 },
    });
    const data = await loadAdminDashboard();
    expect(data.ratings).toEqual({ average: null, count: 0 });
  });
});
