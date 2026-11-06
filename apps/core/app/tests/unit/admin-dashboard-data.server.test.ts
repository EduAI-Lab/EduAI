// @vitest-environment node
/**
 * The ADMIN dashboard loader: weekly chat buckets, which cron jobs System
 * health lists, and how each "Needs your attention" row is counted and worded.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/courses/server", () => ({ listCoursesForUser: vi.fn() }));
vi.mock("~/lib/db.cron-jobs.server", () => ({ listCronJobStatuses: vi.fn() }));
vi.mock("~/lib/ai/status/read.server", () => ({ getUbcStatusCached: vi.fn() }));
vi.mock("~/lib/prisma.server", () => ({
  default: {
    user: { groupBy: vi.fn(), count: vi.fn() },
    course: { count: vi.fn() },
    courseMaterial: { count: vi.fn() },
    chat: { count: vi.fn() },
    bugReport: { count: vi.fn() },
    invitation: { count: vi.fn(), findFirst: vi.fn() },
    auditLog: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

import {
  cronHealthItems,
  cronJobDisplayName,
  fillWeeklyChats,
  loadAdminDashboardData,
  startOfUtcWeek,
  USAGE_WEEKS,
} from "~/lib/dashboard/admin-dashboard-data.server";
import { listCoursesForUser } from "~/lib/courses/server";
import { listCronJobStatuses, type CronJobEntry } from "~/lib/db.cron-jobs.server";
import { getUbcStatusCached } from "~/lib/ai/status/read.server";
import prisma from "~/lib/prisma.server";

function job(name: string, status?: "SUCCESS" | "ERROR" | "RUNNING"): CronJobEntry {
  return {
    name,
    description: "",
    schedule: "* * * * *",
    scheduleLabel: "",
    script: "",
    lastRun: status
      ? {
          id: `${name}-run`,
          jobName: name,
          status,
          startedAt: "2026-11-04T10:00:00.000Z",
          finishedAt: status === "RUNNING" ? null : "2026-11-04T10:01:00.000Z",
          message: null,
          exitCode: null,
          triggerSource: "SCHEDULE",
          triggeredByUserId: null,
        }
      : null,
  };
}

describe("weekly chat buckets", () => {
  it("starts weeks on Monday UTC, like Postgres date_trunc('week')", () => {
    // 2026-11-04 is a Wednesday.
    expect(startOfUtcWeek(new Date("2026-11-04T15:00:00Z")).toISOString()).toBe(
      "2026-11-02T00:00:00.000Z",
    );
    // A Sunday belongs to the week that started the Monday before.
    expect(startOfUtcWeek(new Date("2026-11-08T23:59:00Z")).toISOString()).toBe(
      "2026-11-02T00:00:00.000Z",
    );
  });

  it("fills every week in the window, with 0 for weeks that had no chats", () => {
    const now = new Date("2026-11-04T12:00:00Z");
    const out = fillWeeklyChats([{ week: new Date("2026-10-26T00:00:00Z"), count: 7 }], now);

    expect(out).toHaveLength(USAGE_WEEKS);
    expect(out.at(-1)).toEqual({ weekStart: "2026-11-02", count: 0 });
    expect(out.at(-2)).toEqual({ weekStart: "2026-10-26", count: 7 });
    expect(out.filter((w) => w.count > 0)).toHaveLength(1);
  });
});

describe("System health cron rows", () => {
  it("lists the key jobs plus any other job whose last run failed", () => {
    const items = cronHealthItems([
      job("ai-status-probe", "SUCCESS"),
      job("backup-nightly", "ERROR"),
      job("notify-invitation-expiry"),
      job("disk-usage-check", "SUCCESS"),
      job("qm-reconcile", "ERROR"),
    ]);

    expect(items.map((i) => [i.name, i.status])).toEqual([
      ["AI status probe", "ok"],
      ["Nightly backup", "failed"],
      ["Invitation expiry", "not-set"],
      ["QM reconcile", "failed"],
    ]);
    expect(items[2].detail).toBe("Never run");
  });

  it("names unmapped jobs in sentence case with acronyms kept", () => {
    expect(cronJobDisplayName("notify-api-key-expiry")).toBe("Notify API key expiry");
    expect(cronJobDisplayName("help-docs-reindex")).toBe("Help docs reindex");
  });
});

describe("loadAdminDashboardData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.user.groupBy).mockResolvedValue([
      { role: "STUDENT", _count: { _all: 8 } },
      { role: "INSTRUCTOR", _count: { _all: 5 } },
      { role: "ADMIN", _count: { _all: 1 } },
      { role: "UNIT_ADMIN", _count: { _all: 2 } },
    ] as never);
    vi.mocked(prisma.user.count).mockResolvedValue(0);
    vi.mocked(prisma.course.count).mockResolvedValue(0);
    vi.mocked(prisma.courseMaterial.count).mockResolvedValue(0);
    vi.mocked(prisma.chat.count).mockResolvedValue(0);
    vi.mocked(prisma.bugReport.count).mockResolvedValue(0);
    vi.mocked(prisma.invitation.count).mockResolvedValue(0);
    vi.mocked(prisma.invitation.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.auditLog.findMany).mockResolvedValue([]);
    vi.mocked(prisma.$queryRaw).mockResolvedValue([]);
    vi.mocked(listCronJobStatuses).mockResolvedValue([]);
    vi.mocked(getUbcStatusCached).mockResolvedValue({
      status: { state: "operational", detail: "3 of 3 hosts responding." },
      checkedAt: "2026-11-04T10:00:00.000Z",
      stale: false,
    });
    vi.mocked(listCoursesForUser).mockResolvedValue({ courses: [], total: 0 } as never);
  });

  it("totals users by role, with UNIT_ADMIN counted as other", async () => {
    const data = await loadAdminDashboardData({ id: "a1", role: "ADMIN" } as never);
    expect(data.users).toEqual({
      total: 16,
      byRole: { students: 8, instructors: 5, admins: 1, other: 2 },
    });
  });

  it("asks for four courses for the Courses card", async () => {
    await loadAdminDashboardData({ id: "a1", role: "ADMIN" } as never);
    expect(listCoursesForUser).toHaveBeenCalledWith(expect.anything(), { pageSize: 4 });
  });

  it("counts never-signed-in accounts from lastSignInAt and links each row to its page", async () => {
    vi.mocked(prisma.user.count).mockImplementation((async (args: {
      where?: { lastSignInAt?: null };
    }) => (args?.where && "lastSignInAt" in args.where ? 2 : 0)) as never);
    vi.mocked(listCronJobStatuses).mockResolvedValue([job("backup-nightly", "ERROR")]);

    const data = await loadAdminDashboardData({ id: "a1", role: "ADMIN" } as never);
    const byId = Object.fromEntries(data.attention.map((a) => [a.id, a]));

    expect(byId["never-signed-in"]).toMatchObject({
      count: 2,
      description: "2 accounts have not signed in yet.",
      href: "/admin/users",
    });
    expect(byId["failed-cron-jobs"]).toMatchObject({
      count: 1,
      description: "Nightly backup needs attention.",
      href: "/admin/cron-jobs",
    });
    expect(byId["unhandled-bug-reports"]).toMatchObject({
      count: 0,
      href: "/admin/bug-reports",
    });
    expect(data.attention.map((a) => a.id)).toEqual([
      "unit-admins-without-units",
      "failed-materials",
      "failed-cron-jobs",
      "unhandled-bug-reports",
      "pending-invitations",
      "never-signed-in",
      "courses-without-instructor",
    ]);
  });

  it("reports Cloud API as not set when no provider key is configured", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("GOOGLE_GENERATIVE_AI_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const data = await loadAdminDashboardData({ id: "a1", role: "ADMIN" } as never);
    vi.unstubAllEnvs();

    const cloud = data.health.find((h) => h.id === "ai:cloud");
    const ubc = data.health.find((h) => h.id === "ai:ubc");
    expect(cloud).toMatchObject({ status: "not-set", detail: "No provider key set" });
    expect(ubc).toMatchObject({ status: "ok", lastRunAt: "2026-11-04T10:00:00.000Z" });
  });
});
