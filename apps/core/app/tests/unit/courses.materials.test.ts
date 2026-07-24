import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({}));

vi.mock("~/lib/auth/course-access.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/auth/course-access.server")>()),
  resolveCourseAccessWithCourse: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    courseMaterial: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    canvasMaterialExclusion: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("~/lib/ai/embedding", () => ({
  processMaterialEmbeddings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/ai/file-processing", () => ({
  processUploadedFile: vi.fn(),
}));

// getPolicy resolves to each flag's real code default unless a test overrides it.
vi.mock("~/lib/policy.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/policy.server")>();
  return {
    ...actual,
    getPolicy: vi.fn(async (key: keyof typeof actual.POLICY_FLAGS) => actual.POLICY_FLAGS[key].default),
    logPolicyDenial: vi.fn(),
  };
});

import { loader, action } from "~/routes/api/courses.materials.$";
import { auth } from "~/lib/auth/server";
import { resolveCourseAccessWithCourse } from "~/lib/auth/course-access.server";
import prisma from "~/lib/prisma.server";
import { processMaterialEmbeddings } from "~/lib/ai/embedding";
import { processUploadedFile } from "~/lib/ai/file-processing";
import { getPolicy, POLICY_FLAGS } from "~/lib/policy.server";

const COURSE_ID = "course-1";
const COURSE = { id: COURSE_ID, isPublished: true, department: null };

type Access = { level: string; rank: number } | null;

function mockAccess(access: Access, course: object | null = COURSE) {
  vi.mocked(resolveCourseAccessWithCourse).mockResolvedValue({
    course: course as never,
    access: access as never,
  });
}

function makeRequest(method: string, body?: BodyInit, headers?: Record<string, string>) {
  return new Request(`http://localhost/api/courses/${COURSE_ID}/materials`, {
    method,
    body,
    headers,
  });
}

function makeArgs(method: string, body?: BodyInit, headers?: Record<string, string>) {
  return {
    request: makeRequest(method, body, headers),
    params: { courseId: COURSE_ID },
    context: {} as never,
  } as any;
}

function makePreviewArgs(materialId: string) {
  return {
    request: new Request(
      `http://localhost/api/courses/${COURSE_ID}/materials/${materialId}`,
      { method: "GET" },
    ),
    params: { courseId: COURSE_ID, materialId },
    context: {} as never,
  } as any;
}

function makeDeleteArgs(materialId: string) {
  return {
    request: new Request(
      `http://localhost/api/courses/${COURSE_ID}/materials/${materialId}`,
      { method: "DELETE" },
    ),
    params: { courseId: COURSE_ID, materialId },
    context: {} as never,
  } as any;
}

function makeRenameArgs(materialId: string, body: unknown) {
  return {
    request: new Request(
      `http://localhost/api/courses/${COURSE_ID}/materials/${materialId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    ),
    params: { courseId: COURSE_ID, materialId },
    context: {} as never,
  } as any;
}

function mockSession(role: string, id = "user-1") {
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id, role },
  } as never);
}

/** Stub request whose formData() resolves to a file upload (jsdom-safe). */
function stubUploadArgs() {
  const mockFormData = new FormData();
  mockFormData.append("file", new File(["content"], "file.pdf", { type: "application/pdf" }));
  mockFormData.append("apiKeys", "{}");
  const stubRequest = {
    method: "POST",
    headers: new Headers(),
    formData: () => Promise.resolve(mockFormData),
  } as unknown as Request;
  return { request: stubRequest, params: { courseId: COURSE_ID }, context: {} as never } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(processMaterialEmbeddings).mockResolvedValue(undefined);
  vi.mocked(prisma.canvasMaterialExclusion.findMany).mockResolvedValue([]);
  mockAccess({ level: "instructor", rank: 2 });
  // Reset to code defaults so per-test overrides don't leak across tests.
  vi.mocked(getPolicy).mockImplementation(async (key) => POLICY_FLAGS[key].default);
});

// ---------------------------------------------------------------------------
// loader
// ---------------------------------------------------------------------------

describe("GET /api/courses/:courseId/materials loader", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const res = await loader(makeArgs("GET"));
    expect(res.status).toBe(401);
  });

  it("passes request.headers into getSession (not the raw Request)", async () => {
    mockSession("INSTRUCTOR");
    mockAccess({ level: "instructor", rank: 2 });
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([] as never);
    const args = makeArgs("GET");
    await loader(args);
    expect(auth.api.getSession).toHaveBeenCalledWith({ headers: args.request.headers });
    expect(auth.api.getSession).not.toHaveBeenCalledWith(args.request);
  });

  it("returns 404 when course not found", async () => {
    mockSession("STUDENT");
    mockAccess(null, null);
    const res = await loader(makeArgs("GET"));
    expect(res.status).toBe(404);
  });

  it("returns 403 when user has no course relationship", async () => {
    mockSession("STUDENT");
    mockAccess(null);
    const res = await loader(makeArgs("GET"));
    expect(res.status).toBe(403);
  });

  it("returns 403 for an enrolled student in an unpublished course (§7 publish gate)", async () => {
    mockSession("STUDENT");
    mockAccess({ level: "student", rank: 0 }, { ...COURSE, isPublished: false });
    const res = await loader(makeArgs("GET"));
    expect(res.status).toBe(403);
  });

  it("returns 200 for an enrolled student in a published course", async () => {
    mockSession("STUDENT");
    mockAccess({ level: "student", rank: 0 });
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([{ id: "mat-1" }] as never);
    const res = await loader(makeArgs("GET"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.materials).toHaveLength(1);
  });

  it("returns 200 for a TA even in an unpublished course", async () => {
    mockSession("STUDENT", "ta-user");
    mockAccess({ level: "ta", rank: 1 }, { ...COURSE, isPublished: false });
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([]);
    const res = await loader(makeArgs("GET"));
    expect(res.status).toBe(200);
  });

  it("returns 403 for a student when students.canViewMaterials is off", async () => {
    mockSession("STUDENT");
    mockAccess({ level: "student", rank: 0 });
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await loader(makeArgs("GET"));
    expect(res.status).toBe(403);
    expect(getPolicy).toHaveBeenCalledWith("students.canViewMaterials");
  });

  it("returns 200 for a student when students.canViewMaterials is on (default)", async () => {
    mockSession("STUDENT");
    mockAccess({ level: "student", rank: 0 });
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([]);
    const res = await loader(makeArgs("GET"));
    expect(res.status).toBe(200);
  });

  it("filters out unpublished materials for a student (#777 publish-aware sync)", async () => {
    mockSession("STUDENT");
    mockAccess({ level: "student", rank: 0 });
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([]);
    const res = await loader(makeArgs("GET"));
    expect(res.status).toBe(200);
    expect(prisma.courseMaterial.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ courseId: COURSE_ID, deletedAt: null, unpublishedAt: null }),
      }),
    );
  });

  it("does not filter unpublished materials for an instructor (#777 publish-aware sync)", async () => {
    mockSession("INSTRUCTOR");
    mockAccess({ level: "instructor", rank: 2 });
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([]);
    const res = await loader(makeArgs("GET"));
    expect(res.status).toBe(200);
    const call = vi.mocked(prisma.courseMaterial.findMany).mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(call.where).toEqual({ courseId: COURSE_ID, deletedAt: null });
    expect("unpublishedAt" in call.where).toBe(false);
  });

  it("excludes materials whose externalId is in CanvasMaterialExclusion for a student (retroactive exclusion)", async () => {
    mockSession("STUDENT");
    mockAccess({ level: "student", rank: 0 });
    vi.mocked(prisma.canvasMaterialExclusion.findMany).mockResolvedValue([
      { canvasFileId: "1001" },
    ] as never);
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([]);
    const res = await loader(makeArgs("GET"));
    expect(res.status).toBe(200);
    expect(prisma.courseMaterial.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          unpublishedAt: null,
          visibleToStudents: true,
          AND: [
            { OR: [{ availableAt: null }, { availableAt: { lte: expect.any(Date) } }] },
            { OR: [{ externalId: null }, { externalId: { notIn: ["1001"] } }] },
          ],
        }),
      }),
    );
  });

  it("does not apply the exclusion filter for an instructor read", async () => {
    mockSession("INSTRUCTOR");
    mockAccess({ level: "instructor", rank: 2 });
    vi.mocked(prisma.canvasMaterialExclusion.findMany).mockResolvedValue([
      { canvasFileId: "1001" },
    ] as never);
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([]);
    const res = await loader(makeArgs("GET"));
    expect(res.status).toBe(200);
    const call = vi.mocked(prisma.courseMaterial.findMany).mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect("OR" in call.where).toBe(false);
  });

  it("calls getSession with a plain { headers } object, not the raw Request — better-auth rejects a raw Request (#1049)", async () => {
    mockSession("INSTRUCTOR");
    mockAccess({ level: "instructor", rank: 2 });
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([]);
    const args = makeArgs("GET");
    const res = await loader(args);
    expect(res.status).toBe(200);
    const callArg = vi.mocked(auth.api.getSession).mock.calls[0][0] as { headers: Headers };
    expect(callArg).not.toBeInstanceOf(Request);
    expect(Object.keys(callArg)).toEqual(["headers"]);
    expect(callArg.headers).toBe(args.request.headers);
  });
});

describe("GET /api/courses/:courseId/materials/:materialId loader (preview)", () => {
  it("returns 404 when material not found", async () => {
    mockSession("STUDENT");
    mockAccess({ level: "student", rank: 0 });
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue(null);
    const res = await loader(makePreviewArgs("mat-missing"));
    expect(res.status).toBe(404);
  });

  it("returns 409 when material is not READY", async () => {
    mockSession("STUDENT");
    mockAccess({ level: "student", rank: 0 });
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({
      id: "mat-1",
      title: "Slides",
      mimeType: "application/pdf",
      fileSize: 100,
      status: "PROCESSING",
      createdAt: new Date(),
      rawText: "hello",
    } as never);
    const res = await loader(makePreviewArgs("mat-1"));
    expect(res.status).toBe(409);
  });

  it("returns excerpt for READY material", async () => {
    mockSession("STUDENT");
    mockAccess({ level: "student", rank: 0 });
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({
      id: "mat-1",
      title: "Syllabus",
      mimeType: "application/pdf",
      fileSize: 2048,
      status: "READY",
      createdAt: new Date(),
      rawText: "Course overview text",
    } as never);
    const res = await loader(makePreviewArgs("mat-1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.excerpt).toBe("Course overview text");
    expect(body.truncated).toBe(false);
    expect(body.material.title).toBe("Syllabus");
  });

  it("returns 403 for a student when students.canViewMaterials is off", async () => {
    mockSession("STUDENT");
    mockAccess({ level: "student", rank: 0 });
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await loader(makePreviewArgs("mat-1"));
    expect(res.status).toBe(403);
  });

  it("filters out unpublished materials for a student (#777 publish-aware sync)", async () => {
    mockSession("STUDENT");
    mockAccess({ level: "student", rank: 0 });
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue(null);
    const res = await loader(makePreviewArgs("mat-1"));
    expect(res.status).toBe(404);
    expect(prisma.courseMaterial.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "mat-1",
          courseId: COURSE_ID,
          deletedAt: null,
          unpublishedAt: null,
        }),
      }),
    );
  });

  it("does not filter unpublished materials for an instructor (#777 publish-aware sync)", async () => {
    mockSession("INSTRUCTOR");
    mockAccess({ level: "instructor", rank: 2 });
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({
      id: "mat-1",
      title: "Syllabus",
      mimeType: "application/pdf",
      fileSize: 2048,
      status: "READY",
      createdAt: new Date(),
      rawText: "Course overview text",
    } as never);
    const res = await loader(makePreviewArgs("mat-1"));
    expect(res.status).toBe(200);
    const call = vi.mocked(prisma.courseMaterial.findFirst).mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect(call.where).toEqual({ id: "mat-1", courseId: COURSE_ID, deletedAt: null });
    expect("unpublishedAt" in call.where).toBe(false);
  });

  it("excludes a previewed material whose externalId is in CanvasMaterialExclusion for a student (retroactive exclusion)", async () => {
    mockSession("STUDENT");
    mockAccess({ level: "student", rank: 0 });
    vi.mocked(prisma.canvasMaterialExclusion.findMany).mockResolvedValue([
      { canvasFileId: "1001" },
    ] as never);
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue(null);
    const res = await loader(makePreviewArgs("mat-1"));
    expect(res.status).toBe(404);
    expect(prisma.courseMaterial.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          unpublishedAt: null,
          visibleToStudents: true,
          AND: [
            { OR: [{ availableAt: null }, { availableAt: { lte: expect.any(Date) } }] },
            { OR: [{ externalId: null }, { externalId: { notIn: ["1001"] } }] },
          ],
        }),
      }),
    );
  });

  it("does not apply the exclusion filter for an instructor preview read", async () => {
    mockSession("INSTRUCTOR");
    mockAccess({ level: "instructor", rank: 2 });
    vi.mocked(prisma.canvasMaterialExclusion.findMany).mockResolvedValue([
      { canvasFileId: "1001" },
    ] as never);
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({
      id: "mat-1",
      title: "Syllabus",
      mimeType: "application/pdf",
      fileSize: 2048,
      status: "READY",
      createdAt: new Date(),
      rawText: "Course overview text",
    } as never);
    const res = await loader(makePreviewArgs("mat-1"));
    expect(res.status).toBe(200);
    const call = vi.mocked(prisma.courseMaterial.findFirst).mock.calls[0][0] as {
      where: Record<string, unknown>;
    };
    expect("OR" in call.where).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// action — POST upload
// ---------------------------------------------------------------------------

describe("POST /api/courses/:courseId/materials action", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const res = await action(makeArgs("POST"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when course not found", async () => {
    mockSession("INSTRUCTOR");
    mockAccess(null, null);
    const res = await action(makeArgs("POST"));
    expect(res.status).toBe(404);
  });

  it("returns 403 for an enrolled STUDENT (#300 — students cannot upload)", async () => {
    mockSession("STUDENT");
    mockAccess({ level: "student", rank: 0 });
    const res = await action(makeArgs("POST"));
    expect(res.status).toBe(403);
    expect(prisma.courseMaterial.create).not.toHaveBeenCalled();
  });

  it("admits a TA upload (rank 1)", async () => {
    mockSession("STUDENT", "ta-user");
    mockAccess({ level: "ta", rank: 1 });
    vi.mocked(processUploadedFile).mockResolvedValue({
      checksum: "c1", title: "f.pdf", mimeType: "application/pdf", fileSize: 1, content: "x",
    } as never);
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.courseMaterial.create).mockResolvedValue({ id: "mat-1" } as never);
    vi.mocked(prisma.courseMaterial.update).mockResolvedValue({ id: "mat-1" } as never);
    const res = await action(stubUploadArgs());
    expect(res.status).toBe(200);
  });

  it("returns 403 for a TA upload when tas.canManageMaterials is off", async () => {
    mockSession("STUDENT", "ta-user");
    mockAccess({ level: "ta", rank: 1 });
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await action(makeArgs("POST"));
    expect(res.status).toBe(403);
    expect(getPolicy).toHaveBeenCalledWith("tas.canManageMaterials");
    expect(prisma.courseMaterial.create).not.toHaveBeenCalled();
  });

  it("admits a STUDENT upload when students.canUploadMaterials is on", async () => {
    mockSession("STUDENT");
    mockAccess({ level: "student", rank: 0 });
    vi.mocked(getPolicy).mockResolvedValue(true);
    vi.mocked(processUploadedFile).mockResolvedValue({
      checksum: "c2", title: "f.pdf", mimeType: "application/pdf", fileSize: 1, content: "x",
    } as never);
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.courseMaterial.create).mockResolvedValue({ id: "mat-2" } as never);
    vi.mocked(prisma.courseMaterial.update).mockResolvedValue({ id: "mat-2" } as never);
    const res = await action(stubUploadArgs());
    expect(res.status).toBe(200);
  });

  it("returns 403 for a STUDENT uploading to an UNPUBLISHED course even when students.canUploadMaterials is on (§7/§19 publish gate)", async () => {
    mockSession("STUDENT");
    mockAccess({ level: "student", rank: 0 }, { ...COURSE, isPublished: false });
    vi.mocked(getPolicy).mockResolvedValue(true);
    const res = await action(stubUploadArgs());
    expect(res.status).toBe(403);
    expect(prisma.courseMaterial.create).not.toHaveBeenCalled();
  });

  it("returns 400 when no file provided", async () => {
    mockSession("INSTRUCTOR");
    const form = new FormData();
    form.append("apiKeys", "{}");
    const res = await action({
      request: new Request(`http://localhost/api/courses/${COURSE_ID}/materials`, {
        method: "POST",
        body: form,
      }),
      params: { courseId: COURSE_ID },
      context: {} as never,
    } as any);
    expect(res.status).toBe(400);
  });

  it("returns 500 with a sanitized message when embedding fails with a Prisma error (#54)", async () => {
    mockSession("INSTRUCTOR");
    vi.mocked(processUploadedFile).mockResolvedValue({
      checksum: "prisma-fail",
      title: "file.pdf",
      mimeType: "application/pdf",
      fileSize: 100,
      content: "text",
    } as never);
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.courseMaterial.create).mockResolvedValue({ id: "mat-prisma" } as never);
    vi.mocked(prisma.courseMaterial.update).mockResolvedValue({ id: "mat-prisma" } as never);
    vi.mocked(processMaterialEmbeddings).mockRejectedValue(
      new Error("Invalid `prisma.$executeRaw()` invocation:\nRaw query failed."),
    );

    const res = await action(stubUploadArgs());
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe(
      "Couldn't save this material's search data due to a database error. Please try again or contact support.",
    );
    expect(body.error).not.toMatch(/prisma/i);
  });

  it("persists uploadedBy as the session user on create (#294)", async () => {
    mockSession("INSTRUCTOR");
    vi.mocked(processUploadedFile).mockResolvedValue({
      checksum: "new-checksum", title: "file.pdf", mimeType: "application/pdf",
      fileSize: 100, content: "text",
    } as never);
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.courseMaterial.create).mockResolvedValue({ id: "mat-1" } as never);
    vi.mocked(prisma.courseMaterial.update).mockResolvedValue({ id: "mat-1" } as never);

    const res = await action(stubUploadArgs());
    expect(res.status).toBe(200);
    expect(prisma.courseMaterial.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ uploadedBy: "user-1" }),
      }),
    );
  });

  it("returns 409 when duplicate file checksum exists", async () => {
    mockSession("ADMIN");
    mockAccess({ level: "admin", rank: 4 });
    vi.mocked(processUploadedFile).mockResolvedValue({
      checksum: "abc123", title: "file.pdf", mimeType: "application/pdf",
      fileSize: 100, content: "text",
    } as never);
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({ id: "existing-mat" } as never);

    const res = await action(stubUploadArgs());
    expect(res.status).toBe(409);
  });

  it("restores a soft-deleted material on re-upload instead of 409", async () => {
    mockSession("ADMIN");
    mockAccess({ level: "admin", rank: 4 });
    vi.mocked(processUploadedFile).mockResolvedValue({
      checksum: "abc123", title: "file.pdf", mimeType: "application/pdf",
      fileSize: 100, content: "text",
    } as never);
    // Same-checksum row exists but is soft-deleted → should restore, not 409.
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({
      id: "existing-mat",
      deletedAt: new Date(),
    } as never);
    vi.mocked(prisma.courseMaterial.update).mockResolvedValue({ id: "existing-mat" } as never);

    const res = await action(stubUploadArgs());
    expect(res.status).toBe(200);
    // First update call clears the soft-delete markers and re-queues processing.
    expect(prisma.courseMaterial.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "existing-mat" },
        data: expect.objectContaining({
          deletedAt: null,
          deletedBy: null,
          status: "PROCESSING",
        }),
      }),
    );
    expect(prisma.courseMaterial.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// action — DELETE (#300 new route)
// ---------------------------------------------------------------------------

describe("DELETE /api/courses/:courseId/materials/:materialId action", () => {
  beforeEach(() => {
    mockSession("INSTRUCTOR");
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({
      id: "mat-1",
      uploadedBy: "someone-else",
    } as never);
  });

  it("returns 404 when the material does not exist in the course", async () => {
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue(null);
    const res = await action(makeDeleteArgs("missing"));
    expect(res.status).toBe(404);
    expect(prisma.courseMaterial.update).not.toHaveBeenCalled();
  });

  it("returns 204 for an enrolled INSTRUCTOR (soft-deletes any material)", async () => {
    mockAccess({ level: "instructor", rank: 2 });
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({
      id: "mat-1",
      uploadedBy: "other-user",
    } as never);
    const res = await action(makeDeleteArgs("mat-1"));
    expect(res.status).toBe(204);
    expect(prisma.courseMaterial.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "mat-1" },
        data: { deletedAt: expect.any(Date), deletedBy: expect.any(String) },
      }),
    );
  });

  it("returns 403 for an enrolled STUDENT", async () => {
    mockSession("STUDENT");
    mockAccess({ level: "student", rank: 0 });
    const res = await action(makeDeleteArgs("mat-1"));
    expect(res.status).toBe(403);
    expect(prisma.courseMaterial.update).not.toHaveBeenCalled();
  });

  it("returns 403 for a TA deleting another user's material (§7 own-only)", async () => {
    mockSession("STUDENT", "ta-user");
    mockAccess({ level: "ta", rank: 1 });
    const res = await action(makeDeleteArgs("mat-1"));
    expect(res.status).toBe(403);
  });

  it("returns 204 for a TA deleting their OWN material (§7 own-only)", async () => {
    mockSession("STUDENT", "ta-user");
    mockAccess({ level: "ta", rank: 1 });
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({
      id: "mat-1",
      uploadedBy: "ta-user",
    } as never);
    const res = await action(makeDeleteArgs("mat-1"));
    expect(res.status).toBe(204);
  });

  it("returns 403 for a TA on an ownerless material (null uploadedBy)", async () => {
    mockSession("STUDENT", "ta-user");
    mockAccess({ level: "ta", rank: 1 });
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({
      id: "mat-1",
      uploadedBy: null,
    } as never);
    const res = await action(makeDeleteArgs("mat-1"));
    expect(res.status).toBe(403);
  });

  it("returns 403 for a TA deleting their OWN material when tas.canManageMaterials is off", async () => {
    mockSession("STUDENT", "ta-user");
    mockAccess({ level: "ta", rank: 1 });
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({
      id: "mat-1",
      uploadedBy: "ta-user",
    } as never);
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await action(makeDeleteArgs("mat-1"));
    expect(res.status).toBe(403);
    expect(getPolicy).toHaveBeenCalledWith("tas.canManageMaterials");
    expect(prisma.courseMaterial.delete).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// action — PATCH (rename)
// ---------------------------------------------------------------------------

describe("PATCH /api/courses/:courseId/materials/:materialId action", () => {
  beforeEach(() => {
    mockSession("INSTRUCTOR");
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({
      id: "mat-1",
      uploadedBy: "other-user",
      title: "Old name",
    } as never);
    vi.mocked(prisma.courseMaterial.update).mockResolvedValue({
      id: "mat-1",
      title: "New name",
    } as never);
  });

  it("returns 400 when title is missing/blank", async () => {
    const res = await action(makeRenameArgs("mat-1", { title: "   " }));
    expect(res.status).toBe(400);
    expect(prisma.courseMaterial.update).not.toHaveBeenCalled();
  });

  it("returns 400 when title exceeds 255 chars", async () => {
    const res = await action(makeRenameArgs("mat-1", { title: "x".repeat(256) }));
    expect(res.status).toBe(400);
    expect(prisma.courseMaterial.update).not.toHaveBeenCalled();
  });

  it("returns 404 when the material does not exist in the course", async () => {
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue(null);
    const res = await action(makeRenameArgs("missing", { title: "New name" }));
    expect(res.status).toBe(404);
    expect(prisma.courseMaterial.update).not.toHaveBeenCalled();
  });

  it("returns 200 for an enrolled INSTRUCTOR (renames any material, trims title)", async () => {
    const res = await action(makeRenameArgs("mat-1", { title: "  New name  " }));
    expect(res.status).toBe(200);
    expect(prisma.courseMaterial.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "mat-1" },
        data: { title: "New name" },
      }),
    );
  });

  it("returns 403 for an enrolled STUDENT", async () => {
    mockSession("STUDENT");
    mockAccess({ level: "student", rank: 0 });
    const res = await action(makeRenameArgs("mat-1", { title: "New name" }));
    expect(res.status).toBe(403);
    expect(prisma.courseMaterial.update).not.toHaveBeenCalled();
  });

  it("returns 403 for a TA renaming another user's material (§7 own-only)", async () => {
    mockSession("STUDENT", "ta-user");
    mockAccess({ level: "ta", rank: 1 });
    const res = await action(makeRenameArgs("mat-1", { title: "New name" }));
    expect(res.status).toBe(403);
    expect(prisma.courseMaterial.update).not.toHaveBeenCalled();
  });

  it("returns 200 for a TA renaming their OWN material (§7 own-only)", async () => {
    mockSession("STUDENT", "ta-user");
    mockAccess({ level: "ta", rank: 1 });
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({
      id: "mat-1",
      uploadedBy: "ta-user",
      title: "Old name",
    } as never);
    const res = await action(makeRenameArgs("mat-1", { title: "New name" }));
    expect(res.status).toBe(200);
  });

  it("returns 403 for a TA on an ownerless material (null uploadedBy)", async () => {
    mockSession("STUDENT", "ta-user");
    mockAccess({ level: "ta", rank: 1 });
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({
      id: "mat-1",
      uploadedBy: null,
      title: "Old name",
    } as never);
    const res = await action(makeRenameArgs("mat-1", { title: "New name" }));
    expect(res.status).toBe(403);
  });

  it("returns 403 for a TA changing student visibility on their OWN material (§7 rename-only)", async () => {
    mockSession("STUDENT", "ta-user");
    mockAccess({ level: "ta", rank: 1 });
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({
      id: "mat-1",
      uploadedBy: "ta-user",
      title: "Old name",
      visibleToStudents: true,
      availableAt: null,
    } as never);
    const res = await action(makeRenameArgs("mat-1", { visibleToStudents: false }));
    expect(res.status).toBe(403);
    expect(prisma.courseMaterial.update).not.toHaveBeenCalled();
  });

  it("returns 403 for a TA scheduling availableAt on their OWN material (§7 rename-only)", async () => {
    mockSession("STUDENT", "ta-user");
    mockAccess({ level: "ta", rank: 1 });
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({
      id: "mat-1",
      uploadedBy: "ta-user",
      title: "Old name",
      visibleToStudents: true,
      availableAt: null,
    } as never);
    const res = await action(
      makeRenameArgs("mat-1", { availableAt: "2099-01-01T00:00:00.000Z" }),
    );
    expect(res.status).toBe(403);
    expect(prisma.courseMaterial.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// loader — per-material student visibility gate (#839)
// ---------------------------------------------------------------------------

describe("GET materials — student visibility gate (#839)", () => {
  it("applies the visibility filter to the list query for students", async () => {
    mockSession("STUDENT");
    mockAccess({ level: "student", rank: 0 });
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([]);
    await loader(makeArgs("GET"));
    const where = (vi.mocked(prisma.courseMaterial.findMany).mock.calls[0][0] as any)
      .where;
    expect(where).toEqual(
      expect.objectContaining({
        courseId: COURSE_ID,
        deletedAt: null,
        unpublishedAt: null,
        visibleToStudents: true,
        OR: [{ availableAt: null }, { availableAt: { lte: expect.any(Date) } }],
      }),
    );
  });

  it("does NOT apply the visibility filter for staff (instructor sees everything)", async () => {
    mockSession("INSTRUCTOR");
    mockAccess({ level: "instructor", rank: 2 });
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([]);
    await loader(makeArgs("GET"));
    const where = (vi.mocked(prisma.courseMaterial.findMany).mock.calls[0][0] as any)
      .where;
    expect(where.visibleToStudents).toBeUndefined();
    expect(where.OR).toBeUndefined();
  });

  it("exposes scheduling fields to staff but strips them for students", async () => {
    const row = {
      id: "mat-1",
      title: "Week 5 slides",
      visibleToStudents: false,
      availableAt: new Date("2099-01-01"),
      _count: { chunks: 3 },
    };
    // Staff response
    mockSession("INSTRUCTOR");
    mockAccess({ level: "instructor", rank: 2 });
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([row] as never);
    const staffBody = await (await loader(makeArgs("GET"))).json();
    expect(staffBody.materials[0]).toHaveProperty("visibleToStudents", false);
    expect(staffBody.materials[0]).toHaveProperty("availableAt");

    // Student response — fields omitted
    vi.clearAllMocks();
    vi.mocked(getPolicy).mockImplementation(async (key) => POLICY_FLAGS[key].default);
    mockSession("STUDENT");
    mockAccess({ level: "student", rank: 0 });
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([
      { id: "mat-1", title: "Week 5 slides", _count: { chunks: 3 } },
    ] as never);
    const studentBody = await (await loader(makeArgs("GET"))).json();
    expect(studentBody.materials[0]).not.toHaveProperty("visibleToStudents");
    expect(studentBody.materials[0]).not.toHaveProperty("availableAt");
  });

  it("applies the visibility filter to a single-material preview for students", async () => {
    mockSession("STUDENT");
    mockAccess({ level: "student", rank: 0 });
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue(null);
    await loader(makePreviewArgs("mat-1"));
    const where = (vi.mocked(prisma.courseMaterial.findFirst).mock.calls[0][0] as any)
      .where;
    expect(where).toEqual(
      expect.objectContaining({ visibleToStudents: true }),
    );
  });
});

// ---------------------------------------------------------------------------
// action — PATCH visibility scheduling (#839)
// ---------------------------------------------------------------------------

describe("PATCH materials — visibility scheduling (#839)", () => {
  beforeEach(() => {
    mockSession("INSTRUCTOR");
    mockAccess({ level: "instructor", rank: 2 });
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({
      id: "mat-1",
      uploadedBy: "other-user",
      title: "Slides",
      visibleToStudents: true,
      availableAt: null,
    } as never);
    vi.mocked(prisma.courseMaterial.update).mockResolvedValue({
      id: "mat-1",
      title: "Slides",
      visibleToStudents: false,
      availableAt: null,
    } as never);
  });

  it("hides a material from students (visibleToStudents=false)", async () => {
    const res = await action(makeRenameArgs("mat-1", { visibleToStudents: false }));
    expect(res.status).toBe(200);
    expect(prisma.courseMaterial.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "mat-1" },
        data: { visibleToStudents: false },
      }),
    );
  });

  it("schedules a future reveal (availableAt as ISO string → Date)", async () => {
    const iso = "2099-01-01T00:00:00.000Z";
    const res = await action(makeRenameArgs("mat-1", { availableAt: iso }));
    expect(res.status).toBe(200);
    const data = vi.mocked(prisma.courseMaterial.update).mock.calls[0][0].data;
    expect(data.availableAt).toBeInstanceOf(Date);
    expect((data.availableAt as Date).toISOString()).toBe(iso);
  });

  it("clears a schedule when availableAt is null", async () => {
    const res = await action(makeRenameArgs("mat-1", { availableAt: null }));
    expect(res.status).toBe(200);
    expect(prisma.courseMaterial.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { availableAt: null } }),
    );
  });

  it("returns 400 for an invalid availableAt", async () => {
    const res = await action(makeRenameArgs("mat-1", { availableAt: "not-a-date" }));
    expect(res.status).toBe(400);
    expect(prisma.courseMaterial.update).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-boolean visibleToStudents", async () => {
    const res = await action(makeRenameArgs("mat-1", { visibleToStudents: "yes" }));
    expect(res.status).toBe(400);
    expect(prisma.courseMaterial.update).not.toHaveBeenCalled();
  });

  it("returns 400 when no editable fields are provided", async () => {
    const res = await action(makeRenameArgs("mat-1", {}));
    expect(res.status).toBe(400);
    expect(prisma.courseMaterial.update).not.toHaveBeenCalled();
  });

  it("returns 403 when a STUDENT tries to change visibility", async () => {
    mockSession("STUDENT");
    mockAccess({ level: "student", rank: 0 });
    const res = await action(makeRenameArgs("mat-1", { visibleToStudents: false }));
    expect(res.status).toBe(403);
    expect(prisma.courseMaterial.update).not.toHaveBeenCalled();
  });

  it("updates both title and visibility together", async () => {
    const res = await action(
      makeRenameArgs("mat-1", { title: "New name", visibleToStudents: false }),
    );
    expect(res.status).toBe(200);
    expect(prisma.courseMaterial.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { title: "New name", visibleToStudents: false },
      }),
    );
  });
});
