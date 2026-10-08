// @vitest-environment node
/**
 * getCourseTopicNamesCached feeds the course-scope prompt on every course-chat
 * turn. The prompt must only list topics a human made or approved — a small
 * model reads that list as course content (#1936) — while the scope classifier
 * still gets unreviewed suggestions. The "Uncategorized" fallback is in neither.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  courseTopic: { findMany: vi.fn() },
}));

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));
vi.mock("~/lib/auth/server", () => ({ auth: { api: { getSession: vi.fn() } } }));
vi.mock("~/lib/auth/guards.server", () => ({}));

describe("getCourseTopicNamesCached", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("splits accepted from suggested topics and drops the Uncategorized fallback", async () => {
    prismaMock.courseTopic.findMany.mockResolvedValue([
      { name: "Excel", reviewStatus: "ACCEPTED" },
      { name: "Tidy data", reviewStatus: "SUGGESTED" },
      { name: "Uncategorized", reviewStatus: "ACCEPTED" },
      { name: "Python", reviewStatus: "ACCEPTED" },
    ]);

    const { getCourseTopicNamesCached } = await import("~/lib/courses/server");

    expect(await getCourseTopicNamesCached("course-1")).toEqual({
      accepted: ["Excel", "Python"],
      suggested: ["Tidy data"],
    });
  });

  it("re-reads after invalidation so an approved suggestion shows up", async () => {
    prismaMock.courseTopic.findMany.mockResolvedValueOnce([
      { name: "Tidy data", reviewStatus: "SUGGESTED" },
    ]);
    const { getCourseTopicNamesCached, invalidateCourseTopicNamesCache } =
      await import("~/lib/courses/server");
    expect((await getCourseTopicNamesCached("course-1")).accepted).toEqual([]);

    prismaMock.courseTopic.findMany.mockResolvedValueOnce([
      { name: "Tidy data", reviewStatus: "ACCEPTED" },
    ]);
    invalidateCourseTopicNamesCache("course-1");
    expect((await getCourseTopicNamesCached("course-1")).accepted).toEqual(["Tidy data"]);
  });
});
