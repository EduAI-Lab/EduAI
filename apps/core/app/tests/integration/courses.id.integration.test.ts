// @vitest-environment node

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import prisma from "~/lib/prisma.server";
import { loader } from "~/routes/api/courses.id";

let courseId: string;
let deletedCourseId: string;

beforeAll(async () => {
  const course = await prisma.course.create({
    data: {
      name: "GET By Id Course",
      code: "GID 101",
      section: "001",
      term: "Fall",
      year: 2025,
      startDate: new Date("2025-09-01"),
    },
  });
  courseId = course.id;

  const deleted = await prisma.course.create({
    data: {
      name: "Deleted Course",
      code: "GID 999",
      section: "001",
      term: "Fall",
      year: 2025,
      startDate: new Date("2025-09-01"),
      deletedAt: new Date(),
    },
  });
  deletedCourseId = deleted.id;
});

afterAll(async () => {
  await prisma.course.deleteMany({
    where: { id: { in: [courseId, deletedCourseId] } },
  });
  await prisma.$disconnect();
});

function makeArgs(id: string) {
  return {
    request: new Request(`http://localhost/api/courses/${id}`),
    params: { id },
    context: {} as never,
  };
}

describe("GET /api/courses/:id", () => {
  it("returns 200 with flat course object for active course", async () => {
    const res = await loader(makeArgs(courseId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(courseId);
    expect(body.name).toBe("GET By Id Course");
    expect(body.deletedAt).toBeNull();
  });

  it("returns 404 COURSE_NOT_FOUND for unknown id", async () => {
    const res = await loader(makeArgs("nonexistent-course-id"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "COURSE_NOT_FOUND" });
  });

  it("returns 404 COURSE_NOT_FOUND for soft-deleted course", async () => {
    const res = await loader(makeArgs(deletedCourseId));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "COURSE_NOT_FOUND" });
  });
});
