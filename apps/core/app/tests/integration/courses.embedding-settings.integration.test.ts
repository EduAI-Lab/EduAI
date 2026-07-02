// @vitest-environment node
//
// Integration tests for /api/courses/:courseId/embedding-settings.
// Real Postgres; auth mocked at the module level.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import prisma from "~/lib/prisma.server";
import { DEFAULT_OLLAMA_EMBEDDING_MODEL } from "~/lib/ai/embedding-config";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

import { loader, action } from "~/routes/api/courses.embedding-settings.$";
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
  await cleanupRbac({ userIds: [instructorId, studentId], courseIds: [courseId] });
  await prisma.$disconnect();
});

beforeEach(() => {
  mockSession(null);
});

function getArgs(id: string, user: { id: string; role: string }) {
  mockSession(user);
  return {
    request: new Request(`http://localhost/api/courses/${id}/embedding-settings`),
    params: { courseId: id },
    context: {} as never,
  } as any;
}

function patchArgs(id: string, body: unknown, user: { id: string; role: string }) {
  mockSession(user);
  return {
    request: new Request(`http://localhost/api/courses/${id}/embedding-settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { courseId: id },
    context: {} as never,
  } as any;
}

describe("GET /api/courses/:courseId/embedding-settings", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await loader({
      request: new Request(`http://localhost/api/courses/${courseId}/embedding-settings`),
      params: { courseId },
      context: {} as never,
    } as any);
    expect(res.status).toBe(401);
  });

  it("returns 404 for students without manage access", async () => {
    const res = await loader(getArgs(courseId, { id: studentId, role: "STUDENT" }));
    expect(res.status).toBe(404);
  });

  it("returns effective settings for enrolled instructors", async () => {
    const res = await loader(getArgs(courseId, { id: instructorId, role: "INSTRUCTOR" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.settings).toEqual({
      embeddingProvider: null,
      embeddingModel: null,
      embeddedWithProvider: null,
      embeddedWithModel: null,
      lastEmbeddedAt: null,
    });
    expect(body.effective).toMatchObject({
      provider: expect.any(String),
      model: expect.any(String),
    });
    expect(body.allowedLocalModels.length).toBeGreaterThan(0);
    expect(body.allowedCloudModels.length).toBeGreaterThan(0);
    expect(body.needsReEmbed).toBe(false);
  });
});

describe("PATCH /api/courses/:courseId/embedding-settings", () => {
  it("returns 403-equivalent 404 for students", async () => {
    const res = await action(
      patchArgs(
        courseId,
        { embeddingProvider: "local", embeddingModel: DEFAULT_OLLAMA_EMBEDDING_MODEL },
        { id: studentId, role: "STUDENT" },
      ),
    );
    expect(res.status).toBe(404);
  });

  it("persists provider and model for enrolled instructors", async () => {
    const res = await action(
      patchArgs(
        courseId,
        { embeddingProvider: "local", embeddingModel: DEFAULT_OLLAMA_EMBEDDING_MODEL },
        { id: instructorId, role: "INSTRUCTOR" },
      ),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.settings).toMatchObject({
      embeddingProvider: "local",
      embeddingModel: DEFAULT_OLLAMA_EMBEDDING_MODEL,
    });
    expect(body.effective.provider).toBe("local");
    expect(body.effective.model).toBe(DEFAULT_OLLAMA_EMBEDDING_MODEL);

    const row = await prisma.course.findUnique({
      where: { id: courseId },
      select: { embeddingProvider: true, embeddingModel: true },
    });
    expect(row).toEqual({
      embeddingProvider: "local",
      embeddingModel: DEFAULT_OLLAMA_EMBEDDING_MODEL,
    });
  });

  it("returns 400 for unknown providers", async () => {
    const res = await action(
      patchArgs(
        courseId,
        { embeddingProvider: "gemini" },
        { id: instructorId, role: "INSTRUCTOR" },
      ),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/provider/i);
  });

  it("returns 400 for disallowed models", async () => {
    const res = await action(
      patchArgs(
        courseId,
        { embeddingProvider: "local", embeddingModel: "not-a-real-model" },
        { id: instructorId, role: "INSTRUCTOR" },
      ),
    );
    expect(res.status).toBe(400);
  });

  it("clears overrides when provider is set to env default", async () => {
    const res = await action(
      patchArgs(
        courseId,
        { embeddingProvider: null, embeddingModel: null },
        { id: instructorId, role: "INSTRUCTOR" },
      ),
    );
    expect(res.status).toBe(200);

    const row = await prisma.course.findUnique({
      where: { id: courseId },
      select: { embeddingProvider: true, embeddingModel: true },
    });
    expect(row).toEqual({ embeddingProvider: null, embeddingModel: null });
  });
});
