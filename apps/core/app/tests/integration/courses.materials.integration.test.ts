// @vitest-environment node
//
// Integration tests for /api/courses/:courseId/materials (#300).
// Real Postgres; auth + AI processing mocked at the module level.

import type { JsonValue } from "~/lib/json-value";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import prisma from "~/lib/prisma.server";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/ai/embedding", () => ({
  processMaterialEmbeddings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/ai/file-processing", () => ({
  processUploadedFile: vi.fn(),
  validateUploadedFile: vi.fn().mockResolvedValue(undefined),
  extractUploadedFileContent: vi.fn().mockResolvedValue({
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

/**
 * #949: the provisional checksum is a hash of the raw bytes, so every upload in
 * a course needs distinct bytes or it collides on `pending:<hash>` with any
 * sibling still mid-flight. Callers pass a unique marker.
 */
function uploadArgs(user: { id: string; role: string }, marker = "lecture notes content") {
  mockSession(user);
  const form = new FormData();
  form.append("file", new File([marker], "lecture-notes.txt"));
  form.append("apiKeys", "{}");
  const request = {
    method: "POST",
    headers: new Headers(),
    formData: () => Promise.resolve(form),
  } as Request;
  return { request, params: { courseId }, context: {} as never } as any;
}

/**
 * Uploads now return 202 and finish in a fire-and-forget background task
 * (#949), so integration assertions must wait for the row to leave PROCESSING.
 */
async function settleMaterial(materialId: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await prisma.courseMaterial.findUnique({ where: { id: materialId } });
    if (row && row.status !== "PROCESSING") return row;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Material ${materialId} never left PROCESSING`);
}

/** Upload and wait for the background pass to settle. Returns the material id. */
async function uploadAndSettle(user: { id: string; role: string }, marker: string) {
  const res = await action(uploadArgs(user, marker));
  expect(res.status).toBe(202);
  const { materialId } = await res.json();
  await settleMaterial(materialId);
  return materialId as string;
}

describe("materials upload → list → delete cycle (#300)", () => {
  it("INSTRUCTOR uploads, lists, and deletes a material end-to-end", async () => {
    // Upload — 202 up front, READY once the background pass lands (#949).
    const uploaded = await action(uploadArgs(instructor));
    expect(uploaded.status).toBe(202);
    const { materialId } = await uploaded.json();

    const row = await settleMaterial(materialId);
    expect(row?.uploadedBy).toBe(instructorId);
    expect(row?.status).toBe("READY");
    // The provisional byte-hash checksum is replaced by the content checksum.
    expect(row?.checksum).toBe("materials-integration-checksum");
    expect(row?.rawText).toBe("lecture notes content");

    // List (instructor sees it even though the course is unpublished)
    mockSession(instructor);
    const listed = await loader({
      request: new Request(`http://localhost/api/courses/${courseId}/materials`),
      params: { courseId },
      context: {} as never,
    } as any);
    expect(listed.status).toBe(200);
    const body = await listed.json();
    expect(body.materials.some((m: { id: string }) => m.id === materialId)).toBe(true);

    // Delete
    mockSession(instructor);
    const deleted = await action({
      request: new Request(`http://localhost/api/courses/${courseId}/materials/${materialId}`, {
        method: "DELETE",
      }),
      params: { courseId, materialId },
      context: {} as never,
    } as any);
    expect(deleted.status).toBe(204);
    const deletedMaterial = await prisma.courseMaterial.findUnique({ where: { id: materialId } });
    expect(deletedMaterial).not.toBeNull();
    expect(deletedMaterial?.deletedAt).not.toBeNull();
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
    } as any);
    expect(res.status).toBe(403);
  });

  it("TA deletes own upload but not the instructor's (§7 own-only)", async () => {
    // TA uploads (distinct checksum so the unique constraint doesn't collide)
    const { extractUploadedFileContent } = await import("~/lib/ai/file-processing");
    vi.mocked(extractUploadedFileContent).mockResolvedValueOnce({
      title: "ta-notes.txt",
      mimeType: "text/plain",
      fileSize: 10,
      checksum: "ta-upload-checksum",
      content: "ta notes",
    } as never);
    const taMaterialId = await uploadAndSettle(ta, "ta bytes");

    // Instructor uploads another one
    vi.mocked(extractUploadedFileContent).mockResolvedValueOnce({
      title: "prof-notes.txt",
      mimeType: "text/plain",
      fileSize: 10,
      checksum: "prof-upload-checksum",
      content: "prof notes",
    } as never);
    const profMaterialId = await uploadAndSettle(instructor, "prof bytes");

    // TA cannot delete the instructor's material
    mockSession(ta);
    const denied = await action({
      request: new Request(`http://localhost/api/courses/${courseId}/materials/${profMaterialId}`, {
        method: "DELETE",
      }),
      params: { courseId, materialId: profMaterialId },
      context: {} as never,
    } as any);
    expect(denied.status).toBe(403);

    // TA deletes their own
    mockSession(ta);
    const ok = await action({
      request: new Request(`http://localhost/api/courses/${courseId}/materials/${taMaterialId}`, {
        method: "DELETE",
      }),
      params: { courseId, materialId: taMaterialId },
      context: {} as never,
    } as any);
    expect(ok.status).toBe(204);
  });
});

function renameArgs(user: { id: string; role: string }, materialId: string, title: JsonValue) {
  mockSession(user);
  return {
    request: new Request(`http://localhost/api/courses/${courseId}/materials/${materialId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    }),
    params: { courseId, materialId },
    context: {} as never,
  } as any;
}

describe("materials rename (PATCH)", () => {
  it("INSTRUCTOR renames a material end-to-end and persists the new title", async () => {
    const { extractUploadedFileContent } = await import("~/lib/ai/file-processing");
    vi.mocked(extractUploadedFileContent).mockResolvedValueOnce({
      title: "rename-me.txt",
      mimeType: "text/plain",
      fileSize: 10,
      checksum: "rename-instructor-checksum",
      content: "content",
    } as never);
    const materialId = await uploadAndSettle(instructor, "rename-me bytes");

    const res = await action(renameArgs(instructor, materialId, "  Renamed Notes  "));
    expect(res.status).toBe(200);

    const row = await prisma.courseMaterial.findUnique({ where: { id: materialId } });
    expect(row?.title).toBe("Renamed Notes");
  });

  it("rejects a blank title with 400", async () => {
    const { extractUploadedFileContent } = await import("~/lib/ai/file-processing");
    vi.mocked(extractUploadedFileContent).mockResolvedValueOnce({
      title: "keep.txt",
      mimeType: "text/plain",
      fileSize: 10,
      checksum: "rename-blank-checksum",
      content: "content",
    } as never);
    const materialId = await uploadAndSettle(instructor, "keep bytes");

    const res = await action(renameArgs(instructor, materialId, "   "));
    expect(res.status).toBe(400);
    const row = await prisma.courseMaterial.findUnique({ where: { id: materialId } });
    expect(row?.title).toBe("keep.txt");
  });

  it("STUDENT rename is rejected with 403", async () => {
    const { extractUploadedFileContent } = await import("~/lib/ai/file-processing");
    vi.mocked(extractUploadedFileContent).mockResolvedValueOnce({
      title: "student-blocked.txt",
      mimeType: "text/plain",
      fileSize: 10,
      checksum: "rename-student-checksum",
      content: "content",
    } as never);
    const materialId = await uploadAndSettle(instructor, "student-blocked bytes");

    const res = await action(renameArgs(student, materialId, "Hacked"));
    expect(res.status).toBe(403);
    const row = await prisma.courseMaterial.findUnique({ where: { id: materialId } });
    expect(row?.title).toBe("student-blocked.txt");
  });

  it("TA renames own upload but not the instructor's (§7 own-only)", async () => {
    const { extractUploadedFileContent } = await import("~/lib/ai/file-processing");
    vi.mocked(extractUploadedFileContent).mockResolvedValueOnce({
      title: "ta-rename.txt",
      mimeType: "text/plain",
      fileSize: 10,
      checksum: "rename-ta-own-checksum",
      content: "content",
    } as never);
    const taMaterialId = await uploadAndSettle(ta, "ta-rename bytes");

    vi.mocked(extractUploadedFileContent).mockResolvedValueOnce({
      title: "prof-rename.txt",
      mimeType: "text/plain",
      fileSize: 10,
      checksum: "rename-prof-checksum",
      content: "content",
    } as never);
    const profMaterialId = await uploadAndSettle(instructor, "prof-rename bytes");

    // TA cannot rename the instructor's material
    const denied = await action(renameArgs(ta, profMaterialId, "TA was here"));
    expect(denied.status).toBe(403);

    // TA renames their own
    const ok = await action(renameArgs(ta, taMaterialId, "TA Renamed"));
    expect(ok.status).toBe(200);
    const row = await prisma.courseMaterial.findUnique({ where: { id: taMaterialId } });
    expect(row?.title).toBe("TA Renamed");
  });
});
