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

  it("hides a topic hidden from students from a learner's list only (#2002)", async () => {
    prismaMock.courseTopic.findMany.mockResolvedValue([
      { name: "Shown", reviewStatus: "ACCEPTED", visibleToStudents: true },
      { name: "Hidden", reviewStatus: "ACCEPTED", visibleToStudents: false },
      { name: "Tidy data", reviewStatus: "SUGGESTED", visibleToStudents: true },
    ]);
    const { getCourseTopicNamesCached } = await import("~/lib/courses/server");

    // The prompt never lists the hidden topic for a student, but the scope
    // classifier still counts it as the course's.
    expect(await getCourseTopicNamesCached("course-1", true)).toEqual({
      accepted: ["Shown"],
      suggested: ["Hidden", "Tidy data"],
    });
    expect(await getCourseTopicNamesCached("course-1")).toEqual({
      accepted: ["Shown", "Hidden"],
      suggested: ["Tidy data"],
    });
  });

  it("invalidates the learner and staff lists together", async () => {
    prismaMock.courseTopic.findMany.mockResolvedValue([
      { name: "Labs", reviewStatus: "ACCEPTED", visibleToStudents: true },
    ]);
    const { getCourseTopicNamesCached, invalidateCourseTopicNamesCache } =
      await import("~/lib/courses/server");
    await getCourseTopicNamesCached("course-1", true);
    await getCourseTopicNamesCached("course-1");

    prismaMock.courseTopic.findMany.mockResolvedValue([
      { name: "Labs", reviewStatus: "ACCEPTED", visibleToStudents: false },
    ]);
    invalidateCourseTopicNamesCache("course-1");

    expect((await getCourseTopicNamesCached("course-1", true)).accepted).toEqual([]);
    expect((await getCourseTopicNamesCached("course-1")).accepted).toEqual(["Labs"]);
  });

  it("does not cache a read that a topic change overtook (#2002)", async () => {
    // The read starts while the topic is still shown...
    let finishStaleRead!: (
      rows: { name: string; reviewStatus: string; visibleToStudents: boolean }[],
    ) => void;
    prismaMock.courseTopic.findMany.mockReturnValueOnce(
      new Promise((resolve) => {
        finishStaleRead = resolve;
      }),
    );
    const { getCourseTopicNamesCached, invalidateCourseTopicNamesCache } =
      await import("~/lib/courses/server");
    const staleRead = getCourseTopicNamesCached("course-1", true);

    // ...the instructor hides it, and the route invalidates after its commit...
    invalidateCourseTopicNamesCache("course-1");

    // ...and only then does the old read come back.
    finishStaleRead([{ name: "Labs", reviewStatus: "ACCEPTED", visibleToStudents: true }]);
    expect((await staleRead).accepted).toEqual(["Labs"]);

    // The next student turn must not be served that stale list from the cache.
    prismaMock.courseTopic.findMany.mockResolvedValue([
      { name: "Labs", reviewStatus: "ACCEPTED", visibleToStudents: false },
    ]);
    expect((await getCourseTopicNamesCached("course-1", true)).accepted).toEqual([]);
    expect(prismaMock.courseTopic.findMany).toHaveBeenCalledTimes(2);
  });
});
