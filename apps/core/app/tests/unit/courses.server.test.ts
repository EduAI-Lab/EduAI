// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  course: { findFirst: vi.fn() },
  courseTopic: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
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
  createCourseTopic,
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

describe("createCourseTopic", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 404 when course is missing or soft-deleted", async () => {
    prismaMock.course.findFirst.mockResolvedValue(null);
    const result = await createCourseTopic("missing-course", { name: "Heaps" });
    expect(result).toEqual({ status: "404" });
    expect(prismaMock.courseTopic.create).not.toHaveBeenCalled();
  });

  it("creates topic when course exists", async () => {
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1" });
    prismaMock.courseTopic.create.mockResolvedValue({
      id: "t1",
      courseId: "c1",
      name: "Heaps",
      deletedAt: null,
    });
    const result = await createCourseTopic("c1", { name: "Heaps" });
    expect(result.status).toBe("201");
    expect(result).toHaveProperty("topic");
    expect(prismaMock.courseTopic.create).toHaveBeenCalled();
  });
});

describe("deleteCourseTopic", () => {
  beforeEach(() => vi.clearAllMocks());

  it("soft-deletes active topics by setting deletedAt", async () => {
    prismaMock.courseTopic.updateMany.mockResolvedValue({ count: 1 });
    const result = await deleteCourseTopic("c1", { topicId: "t1" });
    expect(result).toEqual({ status: "204" });
    expect(prismaMock.courseTopic.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { courseId: "c1", deletedAt: null, id: "t1" },
        data: { deletedAt: expect.any(Date) },
      }),
    );
  });

  it("returns 404 when no active row matches", async () => {
    prismaMock.courseTopic.updateMany.mockResolvedValue({ count: 0 });
    const result = await deleteCourseTopic("c1", { name: "Missing" });
    expect(result).toEqual({ status: "404" });
  });
});
