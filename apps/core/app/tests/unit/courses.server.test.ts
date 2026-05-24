// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  course: { findFirst: vi.fn() },
  courseTopic: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock("~/lib/prisma.server", () => ({
  default: prismaMock,
}));

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({
  enforceAdminIfApiKey: vi.fn(),
}));

import {
  getCourse,
  getCourseTopics,
  getCourseTopic,
  deleteCourseTopic,
} from "~/lib/courses/server";

describe("getCourse", () => {
  beforeEach(() => vi.clearAllMocks());

  it("queries only active (non-deleted) courses", async () => {
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1", name: "Active" });
    await getCourse("c1");
    expect(prismaMock.course.findFirst).toHaveBeenCalledWith({
      where: { id: "c1", deletedAt: null },
    });
  });
});

describe("getCourseTopics", () => {
  beforeEach(() => vi.clearAllMocks());

  it("queries only active topics for the course", async () => {
    prismaMock.courseTopic.findMany.mockResolvedValue([]);
    await getCourseTopics("c1");
    expect(prismaMock.courseTopic.findMany).toHaveBeenCalledWith({
      where: { courseId: "c1", deletedAt: null },
      orderBy: { name: "asc" },
    });
  });
});

describe("getCourseTopic", () => {
  beforeEach(() => vi.clearAllMocks());

  it("queries only active topics matching course and id", async () => {
    prismaMock.courseTopic.findFirst.mockResolvedValue(null);
    await getCourseTopic("c1", "t1");
    expect(prismaMock.courseTopic.findFirst).toHaveBeenCalledWith({
      where: { id: "t1", courseId: "c1", deletedAt: null },
    });
  });
});

describe("deleteCourseTopic", () => {
  beforeEach(() => vi.clearAllMocks());

  it("soft-deletes active topics by setting deletedAt", async () => {
    prismaMock.courseTopic.updateMany.mockResolvedValue({ count: 1 });
    const result = await deleteCourseTopic("c1", { topicId: "t1" });
    expect(result).toEqual({ success: true });
    expect(prismaMock.courseTopic.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { courseId: "c1", deletedAt: null, id: "t1" },
        data: { deletedAt: expect.any(Date) },
      }),
    );
  });

  it("returns Topic not found when no active row matches", async () => {
    prismaMock.courseTopic.updateMany.mockResolvedValue({ count: 0 });
    const result = await deleteCourseTopic("c1", { name: "Missing" });
    expect(result).toEqual({ error: "Topic not found" });
  });
});
