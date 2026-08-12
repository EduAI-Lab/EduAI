// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
  enrollment: { findMany: vi.fn(), count: vi.fn() },
  course: { findFirst: vi.fn() },
}));

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

vi.mock("~/lib/bug-reports/server", () => ({
  listBugReports: vi.fn(),
}));

vi.mock("~/lib/auth/course-access.server", () => ({
  resolveCourseAccessGate: vi.fn(),
}));

vi.mock("~/lib/agent-tools/course-context.server", () => ({
  getAccessibleCourse: vi.fn(),
  listAccessibleCourses: vi.fn(),
  listAccessibleCourseTopics: vi.fn(),
  getAccessibleCourseTopic: vi.fn(),
}));

import { listBugReports } from "~/lib/bug-reports/server";
import {
  getAccessibleCourse,
  getAccessibleCourseTopic,
  listAccessibleCourseTopics,
} from "~/lib/agent-tools/course-context.server";
import {
  getAdminCourseTopic,
  listAdminBugReportsForChat,
  listAdminCourseEnrollments,
  listAdminCourseTopics,
  listAdminUsers,
  resolveAdminCourseId,
  resolveAdminUserId,
} from "~/lib/agent-tools/admin-context.server";

const ADMIN = { id: "a1", role: "ADMIN" };
const STUDENT = { id: "s1", role: "STUDENT" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listAdminUsers", () => {
  it("returns 403-shaped error for non-admin", async () => {
    const result = await listAdminUsers(STUDENT);
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns users for admin", async () => {
    prismaMock.user.findMany.mockResolvedValue([{ id: "u1", email: "a@test.com" }]);
    prismaMock.user.count.mockResolvedValue(1);
    const result = await listAdminUsers(ADMIN);
    expect("users" in result && result.users).toHaveLength(1);
    if ("total" in result) {
      expect(result.total).toBe(1);
    }
  });

  it("filters by exact email", async () => {
    prismaMock.user.findMany.mockResolvedValue([
      { id: "u9", email: "perf.pool-enroll-009@perf.local" },
    ]);
    prismaMock.user.count.mockResolvedValue(1);
    const result = await listAdminUsers(ADMIN, {
      email: "perf.pool-enroll-009@perf.local",
    });
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          email: { equals: "perf.pool-enroll-009@perf.local", mode: "insensitive" },
        },
      }),
    );
    if ("filter" in result) {
      expect(result.filter).toEqual({ email: "perf.pool-enroll-009@perf.local" });
    }
  });

  it("filters by query substring on email or name", async () => {
    prismaMock.user.findMany.mockResolvedValue([]);
    prismaMock.user.count.mockResolvedValue(0);
    await listAdminUsers(ADMIN, { query: "enroll-009" });
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [
            { email: { contains: "enroll-009", mode: "insensitive" } },
            { name: { contains: "enroll-009", mode: "insensitive" } },
          ],
        },
      }),
    );
  });
});

describe("listAdminCourseEnrollments", () => {
  it("returns validation error for bad enrolledSince", async () => {
    const result = await listAdminCourseEnrollments(ADMIN, "c1", {
      enrolledSince: "not-a-date",
    });
    expect(result).toEqual({
      error: "VALIDATION_ERROR",
      fields: { enrolledSince: "invalid ISO date" },
    });
    expect(getAccessibleCourse).not.toHaveBeenCalled();
  });

  it("filters enrollments by date window", async () => {
    vi.mocked(getAccessibleCourse).mockResolvedValue({
      course: { id: "c1", code: "COSC 111" },
    } as never);
    prismaMock.enrollment.findMany.mockResolvedValue([
      {
        id: "e1",
        userId: "u1",
        role: "STUDENT",
        isActive: true,
        enrolledAt: new Date("2026-06-01"),
        user: { email: "s@test.com", name: "Student" },
      },
    ]);
    prismaMock.enrollment.count.mockResolvedValue(1);

    const result = await listAdminCourseEnrollments(ADMIN, "c1", {
      enrolledSince: "2026-06-01T00:00:00.000Z",
    });
    expect("count" in result && result.count).toBe(1);
    expect(prismaMock.enrollment.findMany).toHaveBeenCalled();
  });

  it("applies both enrolledSince and enrolledBefore as a single range", async () => {
    vi.mocked(getAccessibleCourse).mockResolvedValue({
      course: { id: "c1", code: "COSC 111" },
    } as never);
    prismaMock.enrollment.findMany.mockResolvedValue([]);
    prismaMock.enrollment.count.mockResolvedValue(0);

    await listAdminCourseEnrollments(ADMIN, "c1", {
      enrolledSince: "2026-06-01T00:00:00.000Z",
      enrolledBefore: "2026-06-15T00:00:00.000Z",
    });

    expect(prismaMock.enrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          courseId: "c1",
          enrolledAt: {
            gte: new Date("2026-06-01T00:00:00.000Z"),
            lte: new Date("2026-06-15T00:00:00.000Z"),
          },
        },
      }),
    );
  });

  it("filters by exact userId regardless of the page-size limit", async () => {
    vi.mocked(getAccessibleCourse).mockResolvedValue({
      course: { id: "c1", code: "COSC 111" },
    } as never);
    prismaMock.enrollment.findMany.mockResolvedValue([
      {
        id: "e1",
        userId: "u1",
        role: "STUDENT",
        isActive: true,
        enrolledAt: new Date("2020-01-01"),
        user: { email: "old@test.com", name: "Old Student" },
      },
    ]);
    prismaMock.enrollment.count.mockResolvedValue(1);

    // limit is small but should be irrelevant once an exact userId is given —
    // the row could otherwise be outside the newest page and unreachable.
    const result = await listAdminCourseEnrollments(ADMIN, "c1", { userId: "u1", limit: 1 });

    expect(prismaMock.enrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ courseId: "c1", userId: "u1" }) }),
    );
    expect("count" in result && result.count).toBe(1);
  });

  it("filters by exact userEmail (case-insensitive), independent of limit", async () => {
    vi.mocked(getAccessibleCourse).mockResolvedValue({
      course: { id: "c1", code: "COSC 111" },
    } as never);
    prismaMock.enrollment.findMany.mockResolvedValue([
      {
        id: "e1",
        userId: "u1",
        role: "STUDENT",
        isActive: true,
        enrolledAt: new Date("2020-01-01"),
        user: { email: "old@test.com", name: "Old Student" },
      },
    ]);
    prismaMock.enrollment.count.mockResolvedValue(1);

    await listAdminCourseEnrollments(ADMIN, "c1", { userEmail: "OLD@test.com" });

    expect(prismaMock.enrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          courseId: "c1",
          user: { email: { equals: "OLD@test.com", mode: "insensitive" } },
        }),
        take: 1,
      }),
    );
  });
});

describe("listAdminCourseTopics", () => {
  it("returns topics with dataSource envelope for admin", async () => {
    vi.mocked(getAccessibleCourse).mockResolvedValue({
      course: { id: "c1", code: "COSC 111" },
    } as never);
    vi.mocked(listAccessibleCourseTopics).mockResolvedValue({
      topics: [{ id: "t1", courseId: "c1", name: "Loops", createdAt: new Date(), updatedAt: new Date() }],
    });

    const result = await listAdminCourseTopics(ADMIN, "c1");
    expect(result).toMatchObject({
      dataSource: "database",
      courseId: "c1",
      courseCode: "COSC 111",
      count: 1,
      topics: [expect.objectContaining({ id: "t1", name: "Loops" })],
    });
  });
});

describe("resolveAdminCourseId", () => {
  it("resolves by course code", async () => {
    prismaMock.course.findFirst.mockResolvedValue({ id: "c1", code: "COSC 111" });
    vi.mocked(getAccessibleCourse).mockResolvedValue({
      course: { id: "c1", code: "COSC 111" },
    } as never);

    const result = await resolveAdminCourseId(ADMIN, { courseCode: "COSC 111" });
    expect(result).toEqual({ courseId: "c1", courseCode: "COSC 111" });
  });
});

describe("listAdminBugReportsForChat", () => {
  it("returns 403-shaped error for non-admin", async () => {
    const result = await listAdminBugReportsForChat(STUDENT, {});
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("delegates to listBugReports for admin", async () => {
    vi.mocked(listBugReports).mockResolvedValue({
      reports: [{ id: "b1", source: "CORE", status: "UNHANDLED", description: "x" }],
      total: 1,
      limit: 50,
      offset: 0,
    } as never);

    const result = await listAdminBugReportsForChat(ADMIN, { status: "UNHANDLED" });
    expect("total" in result && result.total).toBe(1);
    expect(listBugReports).toHaveBeenCalledWith({
      status: "UNHANDLED",
      source: undefined,
      limit: 50,
      offset: 0,
    });
  });
});

describe("resolveAdminCourseId additional branches", () => {
  it("resolves by courseId directly", async () => {
    vi.mocked(getAccessibleCourse).mockResolvedValue({
      course: { id: "c1", code: "COSC 111" },
    } as never);
    const result = await resolveAdminCourseId(ADMIN, { courseId: "c1" });
    expect(result).toEqual({ courseId: "c1", courseCode: "COSC 111" });
    expect(getAccessibleCourse).toHaveBeenCalledWith(ADMIN, "c1");
  });

  it("returns a gate error when courseId is inaccessible", async () => {
    vi.mocked(getAccessibleCourse).mockResolvedValue({ error: "Forbidden" } as never);
    const result = await resolveAdminCourseId(ADMIN, { courseId: "c1" });
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("falls back to fallbackCourseId when courseId is absent", async () => {
    vi.mocked(getAccessibleCourse).mockResolvedValue({
      course: { id: "c2", code: "COSC 222" },
    } as never);
    const result = await resolveAdminCourseId(ADMIN, { fallbackCourseId: "c2" });
    expect(result).toEqual({ courseId: "c2", courseCode: "COSC 222" });
  });

  it("returns a gate error for an inaccessible fallbackCourseId", async () => {
    vi.mocked(getAccessibleCourse).mockResolvedValue({ error: "Forbidden" } as never);
    const result = await resolveAdminCourseId(ADMIN, { fallbackCourseId: "c2" });
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("returns COURSE_NOT_FOUND when courseCode has no match", async () => {
    prismaMock.course.findFirst.mockResolvedValue(null);
    const result = await resolveAdminCourseId(ADMIN, { courseCode: "NOPE 000" });
    expect(result).toEqual({ error: "COURSE_NOT_FOUND" });
  });

  it("returns a gate error when the resolved courseCode course is inaccessible", async () => {
    prismaMock.course.findFirst.mockResolvedValue({ id: "c3", code: "COSC 333" });
    vi.mocked(getAccessibleCourse).mockResolvedValue({ error: "Forbidden" } as never);
    const result = await resolveAdminCourseId(ADMIN, { courseCode: "COSC 333" });
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("requires courseId or courseCode when nothing usable is provided", async () => {
    const result = await resolveAdminCourseId(ADMIN, {});
    expect(result).toEqual({ error: "courseId or courseCode required" });
    expect(getAccessibleCourse).not.toHaveBeenCalled();
  });
});

describe("listAdminCourseEnrollments additional branches", () => {
  it("returns validation error for bad enrolledBefore", async () => {
    const result = await listAdminCourseEnrollments(ADMIN, "c1", { enrolledBefore: "not-a-date" });
    expect(result).toEqual({
      error: "VALIDATION_ERROR",
      fields: { enrolledBefore: "invalid ISO date" },
    });
    expect(getAccessibleCourse).not.toHaveBeenCalled();
  });

  it("returns a gate error when the course is inaccessible", async () => {
    vi.mocked(getAccessibleCourse).mockResolvedValue({ error: "Forbidden" } as never);
    const result = await listAdminCourseEnrollments(ADMIN, "c1", {});
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("treats a whitespace-only enrolledSince as no filter", async () => {
    vi.mocked(getAccessibleCourse).mockResolvedValue({
      course: { id: "c1", code: "COSC 111" },
    } as never);
    prismaMock.enrollment.findMany.mockResolvedValue([]);
    prismaMock.enrollment.count.mockResolvedValue(0);
    await listAdminCourseEnrollments(ADMIN, "c1", { enrolledSince: "   " });
    expect(prismaMock.enrollment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { courseId: "c1" } }),
    );
  });
});

describe("listAdminCourseTopics additional branches", () => {
  it("returns a gate error when the course is inaccessible", async () => {
    vi.mocked(getAccessibleCourse).mockResolvedValue({ error: "Forbidden" } as never);
    const result = await listAdminCourseTopics(ADMIN, "c1");
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("propagates errors from listAccessibleCourseTopics", async () => {
    vi.mocked(getAccessibleCourse).mockResolvedValue({
      course: { id: "c1", code: "COSC 111" },
    } as never);
    vi.mocked(listAccessibleCourseTopics).mockResolvedValue({ error: "Forbidden" } as never);
    const result = await listAdminCourseTopics(ADMIN, "c1");
    expect(result).toEqual({ error: "Forbidden" });
  });
});

describe("getAdminCourseTopic", () => {
  it("returns a gate error when the course is inaccessible", async () => {
    vi.mocked(getAccessibleCourse).mockResolvedValue({ error: "Forbidden" } as never);
    const result = await getAdminCourseTopic(ADMIN, "c1", "t1");
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("propagates a topic-not-found error", async () => {
    vi.mocked(getAccessibleCourse).mockResolvedValue({
      course: { id: "c1", code: "COSC 111" },
    } as never);
    vi.mocked(getAccessibleCourseTopic).mockResolvedValue({ error: "TOPIC_NOT_FOUND" } as never);
    const result = await getAdminCourseTopic(ADMIN, "c1", "missing");
    expect(result).toEqual({ error: "TOPIC_NOT_FOUND" });
  });

  it("returns the topic with a dataSource envelope", async () => {
    vi.mocked(getAccessibleCourse).mockResolvedValue({
      course: { id: "c1", code: "COSC 111" },
    } as never);
    vi.mocked(getAccessibleCourseTopic).mockResolvedValue({
      topic: { id: "t1", courseId: "c1", name: "Loops" },
    } as never);
    const result = await getAdminCourseTopic(ADMIN, "c1", "t1");
    expect(result).toMatchObject({
      dataSource: "database",
      courseId: "c1",
      courseCode: "COSC 111",
      topic: { id: "t1", name: "Loops" },
    });
  });
});

describe("resolveAdminUserId", () => {
  it("returns Forbidden for non-admin", async () => {
    const result = await resolveAdminUserId(STUDENT, {});
    expect(result).toEqual({ error: "Forbidden" });
  });

  it("resolves by userId", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: "u1", email: "a@test.com", name: "A" });
    const result = await resolveAdminUserId(ADMIN, { userId: "u1" });
    expect(result).toEqual({ userId: "u1", email: "a@test.com", name: "A" });
  });

  it("returns USER_NOT_FOUND for an unknown userId", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);
    const result = await resolveAdminUserId(ADMIN, { userId: "missing" });
    expect(result).toEqual({ error: "USER_NOT_FOUND", fields: { userId: "no user with this id" } });
  });

  it("resolves by userEmail case-insensitively", async () => {
    prismaMock.user.findFirst.mockResolvedValue({ id: "u2", email: "b@test.com", name: "B" });
    const result = await resolveAdminUserId(ADMIN, { userEmail: "B@Test.com" });
    expect(result).toEqual({ userId: "u2", email: "b@test.com", name: "B" });
    expect(prismaMock.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: { equals: "b@test.com", mode: "insensitive" } } }),
    );
  });

  it("returns USER_NOT_FOUND for an unknown userEmail", async () => {
    prismaMock.user.findFirst.mockResolvedValue(null);
    const result = await resolveAdminUserId(ADMIN, { userEmail: "missing@test.com" });
    expect(result).toEqual({
      error: "USER_NOT_FOUND",
      fields: { userEmail: "no user with this email" },
    });
  });

  it("requires userId or userEmail", async () => {
    const result = await resolveAdminUserId(ADMIN, {});
    expect(result).toEqual({
      error: "VALIDATION_ERROR",
      fields: { user: "userId or userEmail required" },
    });
  });
});
