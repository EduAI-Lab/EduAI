// @vitest-environment node
/**
 * getCourseTopicNamesCached feeds the course-scope prompt on every course-chat
 * turn. It must only carry topics a human made or approved: an unreviewed
 * suggestion or the "Uncategorized" fallback is not course content, and a small
 * model reads the list as if it were (#1936).
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

  it("drops unreviewed suggestions and the Uncategorized fallback", async () => {
    prismaMock.courseTopic.findMany.mockResolvedValue([
      { name: "Excel", reviewStatus: "ACCEPTED" },
      { name: "Tidy data", reviewStatus: "SUGGESTED" },
      { name: "Uncategorized", reviewStatus: "ACCEPTED" },
      { name: "Python", reviewStatus: "ACCEPTED" },
    ]);

    const { getCourseTopicNamesCached } = await import("~/lib/courses/server");

    expect(await getCourseTopicNamesCached("course-1")).toEqual(["Excel", "Python"]);
  });

  it("re-reads after invalidation so an approved suggestion shows up", async () => {
    prismaMock.courseTopic.findMany.mockResolvedValueOnce([
      { name: "Tidy data", reviewStatus: "SUGGESTED" },
    ]);
    const { getCourseTopicNamesCached, invalidateCourseTopicNamesCache } =
      await import("~/lib/courses/server");
    expect(await getCourseTopicNamesCached("course-1")).toEqual([]);

    prismaMock.courseTopic.findMany.mockResolvedValueOnce([
      { name: "Tidy data", reviewStatus: "ACCEPTED" },
    ]);
    invalidateCourseTopicNamesCache("course-1");
    expect(await getCourseTopicNamesCached("course-1")).toEqual(["Tidy data"]);
  });
});
