// @vitest-environment node
//
// Integration tests for /api/courses/:courseId/materials (#300).
// Real Postgres; auth + AI processing mocked at the module level.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import prisma from "~/lib/prisma.server";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/ai/embedding", () => ({
  processMaterialEmbeddings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/ai/file-processing", () => ({
  processUploadedFile: vi.fn().mockResolvedValue({
    title: "lecture-notes.txt",
    mimeType: "text/plain",
    fileSize: 42,
    checksum: "materials-integration-checksum",
    content: "lecture notes content",
  }),
}));

import { loader, action } from "~/routes/api/courses.materials.$";
import { seedUser, seedCourse, enroll, mockSession, cleanupRbac } from "../helpers/rbac";

let instructorId: string;
let studentId: string;
let taId: string;
let courseId: string;

let instructor: Awaited<ReturnType<typeof seedUser>>;
let student: Awaited<ReturnType<typeof seedUser>>;
let ta: Awaited<ReturnType<typeof seedUser>>;

beforeAll(async () => {
  instructor = await seedUser({ role: "INSTRUCTOR" });
  student = await seedUser({ role: "STUDENT" });
  ta = await seedUser({ role: "STUDENT" });
  instructorId = instructor.id;
  studentId = student.id;
  taId = ta.id;

  const course = await seedCourse({ isPublished: false });
  courseId = course.id;

  await enroll(courseId, instructorId, "INSTRUCTOR");
  await enroll(courseId, studentId, "STUDENT");
  await enroll(courseId, taId, "TA");
});

afterAll(async () => {
  await prisma.courseMaterial.deleteMany({ where: { courseId } });
  await cleanupRbac({ userIds: [instructorId, studentId, taId], courseIds: [courseId] });
  await prisma.$disconnect();
});

beforeEach(() => {
  mockSession(null);
});

function uploadArgs(user: { id: string; role: string }) {
  mockSession(user);
  const form = new FormData();
  form.append("file", new File(["lecture notes content"], "lecture-notes.txt"));
  form.append("apiKeys", "{}");
  const request = {
    method: "POST",
    headers: new Headers(),
    formData: () => Promise.resolve(form),
  } as unknown as Request;
  return { request, params: { courseId }, context: {} as never };
}

describe("materials upload → list → delete cycle (#300)", () => {
  it("INSTRUCTOR uploads, lists, and deletes a material end-to-end", async () => {
    // Upload
    const uploaded = await action(uploadArgs(instructor));
    expect(uploaded.status).toBe(200);
    const { materialId } = await uploaded.json();

    const row = await prisma.courseMaterial.findUnique({ where: { id: materialId } });
    expect(row?.uploadedBy).toBe(instructorId);
    expect(row?.status).toBe("READY");

    // List (instructor sees it even though the course is unpublished)
    mockSession(instructor);
    const listed = await loader({
      request: new Request(`http://localhost/api/courses/${courseId}/materials`),
      params: { courseId },
      context: {} as never,
    });
    expect(listed.status).toBe(200);
    const body = await listed.json();
    expect(body.materials.some((m: { id: string }) => m.id === materialId)).toBe(true);

    // Delete
    mockSession(instructor);
    const deleted = await action({
      request: new Request(
        `http://localhost/api/courses/${courseId}/materials/${materialId}`,
        { method: "DELETE" },
      ),
      params: { courseId, materialId },
      context: {} as never,
    });
    expect(deleted.status).toBe(204);
    expect(await prisma.courseMaterial.findUnique({ where: { id: materialId } })).toBeNull();
  });

  it("STUDENT upload is rejected with 403 (#300)", async () => {
    const res = await action(uploadArgs(student));
    expect(res.status).toBe(403);
  });

  it("STUDENT list is rejected on the unpublished course (§7 publish gate)", async () => {
    mockSession(student);
    const res = await loader({
      request: new Request(`http://localhost/api/courses/${courseId}/materials`),
      params: { courseId },
      context: {} as never,
    });
    expect(res.status).toBe(403);
  });

  it("TA deletes own upload but not the instructor's (§7 own-only)", async () => {
    // TA uploads (distinct checksum so the unique constraint doesn't collide)
    const { processUploadedFile } = await import("~/lib/ai/file-processing");
    vi.mocked(processUploadedFile).mockResolvedValueOnce({
      title: "ta-notes.txt",
      mimeType: "text/plain",
      fileSize: 10,
      checksum: "ta-upload-checksum",
      content: "ta notes",
    } as never);
    const uploaded = await action(uploadArgs(ta));
    expect(uploaded.status).toBe(200);
    const { materialId: taMaterialId } = await uploaded.json();

    // Instructor uploads another one
    vi.mocked(processUploadedFile).mockResolvedValueOnce({
      title: "prof-notes.txt",
      mimeType: "text/plain",
      fileSize: 10,
      checksum: "prof-upload-checksum",
      content: "prof notes",
    } as never);
    const profUploaded = await action(uploadArgs(instructor));
    expect(profUploaded.status).toBe(200);
    const { materialId: profMaterialId } = await profUploaded.json();

    // TA cannot delete the instructor's material
    mockSession(ta);
    const denied = await action({
      request: new Request(
        `http://localhost/api/courses/${courseId}/materials/${profMaterialId}`,
        { method: "DELETE" },
      ),
      params: { courseId, materialId: profMaterialId },
      context: {} as never,
    });
    expect(denied.status).toBe(403);

    // TA deletes their own
    mockSession(ta);
    const ok = await action({
      request: new Request(
        `http://localhost/api/courses/${courseId}/materials/${taMaterialId}`,
        { method: "DELETE" },
      ),
      params: { courseId, materialId: taMaterialId },
      context: {} as never,
    });
    expect(ok.status).toBe(204);
  });
});
