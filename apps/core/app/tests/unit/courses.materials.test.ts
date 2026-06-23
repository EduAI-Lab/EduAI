import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({}));

vi.mock("~/lib/auth/course-access.server", () => ({
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
  };
}

function makeDeleteArgs(materialId: string) {
  return {
    request: new Request(
      `http://localhost/api/courses/${COURSE_ID}/materials/${materialId}`,
      { method: "DELETE" },
    ),
    params: { courseId: COURSE_ID, materialId },
    context: {} as never,
  };
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
  };
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
  return { request: stubRequest, params: { courseId: COURSE_ID }, context: {} as never };
}

beforeEach(() => {
  vi.clearAllMocks();
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
    });
    expect(res.status).toBe(400);
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
});
