// @vitest-environment node
//
// Integration tests for /api/courses/:id/rag-settings.
// Real Postgres; auth mocked at the module level.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import prisma from "~/lib/prisma.server";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { loader, action } from "~/routes/api/courses.id.rag-settings";
import { seedUser, seedCourse, enroll, mockSession, cleanupRbac } from "../helpers/rbac";

let instructorId: string;
let studentId: string;
let courseId: string;

beforeAll(async () => {
  const instructor = await seedUser({ role: "INSTRUCTOR" });
  const student = await seedUser({ role: "STUDENT" });
  instructorId = instructor.id;
  studentId = student.id;

  const course = await seedCourse();
  courseId = course.id;
  await enroll(courseId, instructorId, "INSTRUCTOR");
  await enroll(courseId, studentId, "STUDENT");
});

afterAll(async () => {
  await cleanupRbac({
    userIds: [instructorId, studentId],
    courseIds: [courseId],
  });
  await prisma.$disconnect();
});

beforeEach(() => {
  mockSession(null);
});

function getArgs(id: string) {
  return {
    request: new Request(`http://localhost/api/courses/${id}/rag-settings`),
    params: { id },
    context: {} as never,
  } as any;
}

function patchArgs(id: string, body: unknown, user: { id: string; role: string }) {
  mockSession(user);
  return {
    request: new Request(`http://localhost/api/courses/${id}/rag-settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { id },
    context: {} as never,
  } as any;
}

describe("GET /api/courses/:id/rag-settings", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await loader(getArgs(courseId));
    expect(res.status).toBe(401);
  });

  it("returns null defaults for a course with no overrides", async () => {
    mockSession({ id: instructorId, role: "INSTRUCTOR" });
    const res = await loader(getArgs(courseId));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ragTopK: null,
      ragSimilarityThreshold: null,
    });
  });

  it("returns 403 for a student enrolled in the course", async () => {
    mockSession({ id: studentId, role: "STUDENT" });
    const res = await loader(getArgs(courseId));
    expect(res.status).toBe(403);
  });

  it("returns 403 for an instructor with no relationship to the course (IDOR)", async () => {
    const outsider = await seedUser({ role: "INSTRUCTOR" });
    mockSession({ id: outsider.id, role: "INSTRUCTOR" });
    const res = await loader(getArgs(courseId));
    expect(res.status).toBe(403);
    await cleanupRbac({ userIds: [outsider.id] });
  });

  it("returns 404 for an unknown course", async () => {
    mockSession({ id: instructorId, role: "INSTRUCTOR" });
    const res = await loader(getArgs("nonexistent-course-id"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "COURSE_NOT_FOUND" });
  });
});

describe("PATCH /api/courses/:id/rag-settings", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await action({
      request: new Request(`http://localhost/api/courses/${courseId}/rag-settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ragTopK: 5 }),
      }),
      params: { id: courseId },
      context: {} as never,
    } as any);
    expect(res.status).toBe(401);
  });

  it("returns 403 for students", async () => {
    const res = await action(
      patchArgs(courseId, { ragTopK: 5 }, { id: studentId, role: "STUDENT" }),
    );
    expect(res.status).toBe(403);
  });

  it("returns 403 for an instructor with no relationship to the course (IDOR)", async () => {
    const outsider = await seedUser({ role: "INSTRUCTOR" });
    const res = await action(
      patchArgs(courseId, { ragTopK: 5 }, { id: outsider.id, role: "INSTRUCTOR" }),
    );
    expect(res.status).toBe(403);

    const row = await prisma.course.findUnique({
      where: { id: courseId },
      select: { ragTopK: true },
    });
    expect(row?.ragTopK).not.toBe(5);

    await cleanupRbac({ userIds: [outsider.id] });
  });

  it("persists ragTopK and ragSimilarityThreshold for instructors", async () => {
    const res = await action(
      patchArgs(
        courseId,
        { ragTopK: 8, ragSimilarityThreshold: 0.65 },
        { id: instructorId, role: "INSTRUCTOR" },
      ),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: courseId,
      ragTopK: 8,
      ragSimilarityThreshold: 0.65,
    });

    const row = await prisma.course.findUnique({
      where: { id: courseId },
      select: { ragTopK: true, ragSimilarityThreshold: true },
    });
    expect(row).toEqual({ ragTopK: 8, ragSimilarityThreshold: 0.65 });

    mockSession({ id: instructorId, role: "INSTRUCTOR" });
    const readBack = await loader(getArgs(courseId));
    expect(await readBack.json()).toEqual({
      ragTopK: 8,
      ragSimilarityThreshold: 0.65,
    });
  });

  it("clears overrides when null is sent", async () => {
    const res = await action(
      patchArgs(
        courseId,
        { ragTopK: null, ragSimilarityThreshold: null },
        { id: instructorId, role: "INSTRUCTOR" },
      ),
    );
    expect(res.status).toBe(200);

    const row = await prisma.course.findUnique({
      where: { id: courseId },
      select: { ragTopK: true, ragSimilarityThreshold: true },
    });
    expect(row).toEqual({ ragTopK: null, ragSimilarityThreshold: null });
  });

  it("returns 422 for out-of-range values", async () => {
    const res = await action(
      patchArgs(courseId, { ragTopK: 99 }, { id: instructorId, role: "INSTRUCTOR" }),
    );
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("VALIDATION_ERROR");
  });

  it("returns 404 for an unknown course", async () => {
    const res = await action(
      patchArgs("missing-course", { ragTopK: 4 }, { id: instructorId, role: "INSTRUCTOR" }),
    );
    expect(res.status).toBe(404);
  });
});
