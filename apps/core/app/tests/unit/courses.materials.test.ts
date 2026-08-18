import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({}));

vi.mock("~/lib/auth/course-access.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/auth/course-access.server")>()),
  resolveCourseAccessGate: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => {
  const client: any = {
    courseMaterial: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    materialUploadBlob: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      findUnique: vi.fn(),
    },
    canvasMaterialExclusion: {
      findMany: vi.fn(),
    },
    course: {
      findUnique: vi.fn(),
    },
  };
  // Interactive transaction: hand the callback the same client the assertions
  // read, so a write made inside the reclaim transaction is still observable.
  client.$transaction = vi.fn(async (fn: any) => fn(client));
  return { default: client };
});

vi.mock("~/lib/ai/embedding", () => ({
  processMaterialEmbeddings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/ai/file-processing", () => ({
  processUploadedFile: vi.fn(),
  validateUploadedFile: vi.fn(),
  extractUploadedFileContent: vi.fn(),
}));

// getPolicy resolves to each flag's real code default unless a test overrides it.
vi.mock("~/lib/policy.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/policy.server")>();
  return {
    ...actual,
    getPolicy: vi.fn(
      async (key: keyof typeof actual.POLICY_FLAGS) => actual.POLICY_FLAGS[key].default,
    ),
    logPolicyDenial: vi.fn(),
  };
});

import { loader, action, MATERIAL_UPLOAD_BODY_MAX_BYTES } from "~/routes/api/courses.materials.$";
import { auth } from "~/lib/auth/server";
import { resolveCourseAccessGate } from "~/lib/auth/course-access.server";
import prisma from "~/lib/prisma.server";
import { processMaterialEmbeddings } from "~/lib/ai/embedding";
import {
  extractUploadedFileContent,
  validateUploadedFile,
} from "~/lib/ai/file-processing";
import { getPolicy, POLICY_FLAGS } from "~/lib/policy.server";

const COURSE_ID = "course-1";
const COURSE = { id: COURSE_ID, isPublished: true, department: null };

type Access = { level: string; rank: number } | null;

function mockAccess(access: Access, course: object | null = COURSE) {
  vi.mocked(resolveCourseAccessGate).mockResolvedValue({
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
    request: new Request(`http://localhost/api/courses/${COURSE_ID}/materials/${materialId}`, {
      method: "GET",
    }),
    params: { courseId: COURSE_ID, materialId },
    context: {} as never,
  } as any;
}

function makeDeleteArgs(materialId: string) {
  return {
    request: new Request(`http://localhost/api/courses/${COURSE_ID}/materials/${materialId}`, {
      method: "DELETE",
    }),
    params: { courseId: COURSE_ID, materialId },
    context: {} as never,
  } as any;
}

function makeRenameArgs(materialId: string, body: unknown) {
  return {
    request: new Request(`http://localhost/api/courses/${COURSE_ID}/materials/${materialId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
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

/**
 * The upload action starts `processMaterialAsync` with `void` and returns 202
 * immediately (#949). Yielding to the macrotask queue lets the whole chain of
 * already-resolved mock promises settle before assertions run.
 */
async function flushBackgroundWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Standard extracted-content stub for the background half of an upload. */
function mockExtraction(overrides: Record<string, unknown> = {}) {
  vi.mocked(extractUploadedFileContent).mockResolvedValue({
    checksum: "content-checksum",
    title: "file",
    mimeType: "application/pdf",
    fileSize: 100,
    content: "text",
    ...overrides,
  } as never);
}

/**
 * The upload path issues two distinct conditional `updateMany` claims, told
 * apart by their predicate: reclaiming a stranded provisional row asks for
 * anything *not* live-PROCESSING, while taking the extraction lease asks for a
 * PROCESSING row whose lease is absent or expired.
 */
function isReclaimClaim(where: any): boolean {
  return (
    Array.isArray(where?.OR) &&
    // The restore claim carries a `status: { not: 'PROCESSING' }` arm too, but
    // only ever paired with `deletedAt` (#1494 review) — that pairing is what
    // separates the two.
    where.OR.some((c: any) => c?.status?.not === 'PROCESSING' && c?.deletedAt === undefined)
  );
}

/**
 * Restore-claim `updateMany` calls — the conditional un-delete that takes the
 * restore target's lease. Told apart from the reclaim claim by its
 * soft-delete arm (#1494 review).
 */
function restoreClaims(): Array<{ where?: any; data?: any }> {
  return vi
    .mocked(prisma.courseMaterial.updateMany)
    .mock.calls.map(([arg]) => arg as any)
    .filter((arg) =>
      Array.isArray(arg?.where?.OR) &&
      arg.where.OR.some((c: any) => c?.deletedAt?.not === null),
    );
}

/** Reclaim-claim `updateMany` calls only, in call order. */
function reclaimClaims(): Array<{ where?: any; data?: any }> {
  return vi
    .mocked(prisma.courseMaterial.updateMany)
    .mock.calls.map(([arg]) => arg as any)
    .filter((arg) => isReclaimClaim(arg?.where));
}

/**
 * Drive the reclaim claim's outcome per call (1 = won, 0 = lost), leaving the
 * lease claim to always succeed so tests can isolate reclaim contention.
 */
function mockReclaim(...counts: number[]): void {
  let index = 0;
  vi.mocked(prisma.courseMaterial.updateMany).mockImplementation((async (args: any) => {
    if (!isReclaimClaim(args?.where)) return { count: 1 };
    const count = counts[Math.min(index, counts.length - 1)] ?? 1;
    index += 1;
    return { count };
  }) as never);
}

/** Every `courseMaterial.update` argument object, in call order. */
function updateCalls(): Array<{ where?: any; data?: any }> {
  return vi.mocked(prisma.courseMaterial.update).mock.calls.map(([arg]) => arg as any);
}

/** Index of the first `update` matching `predicate`, or -1. */
function updateCallIndex(predicate: (call: { where?: any; data?: any }) => boolean): number {
  return updateCalls().findIndex(predicate);
}

/**
 * Updates that write the duplicate receipt onto *this upload's* provisional row
 * (`mat-restore` in the restore tests) — as opposed to the restored original.
 */
function receiptUpdates(): Array<{ where?: any; data?: any }> {
  return updateCalls().filter((c) => c.where?.id === "mat-restore");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(validateUploadedFile).mockResolvedValue(undefined);
  mockExtraction();
  vi.mocked(processMaterialEmbeddings).mockResolvedValue(undefined);
  // Two different conditional updateMany claims now run per upload: reclaiming a
  // stranded `pending:` row, and taking the extraction lease. Default both to
  // "this caller won"; contention tests override via `mockReclaim`.
  vi.mocked(prisma.courseMaterial.updateMany).mockResolvedValue({ count: 1 } as never);
  vi.mocked(prisma.materialUploadBlob.upsert).mockResolvedValue({} as never);
  vi.mocked(prisma.materialUploadBlob.deleteMany).mockResolvedValue({ count: 1 } as never);
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
        where: expect.objectContaining({
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

  it("returns 403 (not 404) when a student-hidden material actually exists (#1180)", async () => {
    mockSession("STUDENT");
    mockAccess({ level: "student", rank: 0 });
    vi.mocked(prisma.courseMaterial.findFirst)
      .mockResolvedValueOnce(null) // studentGate-filtered read: excluded
      .mockResolvedValueOnce({ id: "mat-1" } as never); // existence check: it's really there
    const res = await loader(makePreviewArgs("mat-1"));
    expect(res.status).toBe(403);
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

  it("returns HTTP 413 for an oversized declared multipart body before formData parsing", async () => {
    mockSession("INSTRUCTOR");
    expect(MATERIAL_UPLOAD_BODY_MAX_BYTES).toBe(52 * 1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("--boundary\r\n"));
        controller.close();
      },
    });
    const oversizedRequest = {
      url: `http://localhost/api/courses/${COURSE_ID}/materials`,
      method: "POST",
      headers: new Headers({
        "Content-Type": "multipart/form-data; boundary=boundary",
        "Content-Length": String(52 * 1024 * 1024 + 1),
      }),
      body,
      signal: new AbortController().signal,
    } as unknown as Request;
    expect(oversizedRequest.headers.get("content-length")).toBe(String(52 * 1024 * 1024 + 1));
    const res = await action({
      request: oversizedRequest,
      params: { courseId: COURSE_ID },
      context: {} as never,
    } as any);
    const responseBody = await res.text();
    expect(responseBody).toContain("PAYLOAD_TOO_LARGE");
    expect(res.status).toBe(413);
    expect(processUploadedFile).not.toHaveBeenCalled();
  });

  it("returns HTTP 413 for chunked overflow, cancels the source, and never double-reads it", async () => {
    mockSession("INSTRUCTOR");
    mockAccess({ level: "instructor", rank: 2 });
    const cancel = vi.fn();
    let index = 0;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          const chunk = index++ === 0 ? "x".repeat(52 * 1024 * 1024) : "y";
          controller.enqueue(new TextEncoder().encode(chunk));
        },
        cancel,
      },
      { highWaterMark: 0 },
    );
    const formData = vi.fn(() => Promise.reject(new Error("formData must not be called")));
    const result = await action({
      request: {
        url: `http://localhost/api/courses/${COURSE_ID}/materials`,
        method: "POST",
        headers: new Headers({ "Content-Type": "multipart/form-data; boundary=boundary" }),
        body,
        signal: new AbortController().signal,
        formData,
      } as unknown as Request,
      params: { courseId: COURSE_ID },
      context: {} as never,
    } as any);
    expect(result.status).toBe(413);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(formData).not.toHaveBeenCalled();
    expect(processUploadedFile).not.toHaveBeenCalled();
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
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.courseMaterial.create).mockResolvedValue({ id: "mat-1" } as never);
    vi.mocked(prisma.courseMaterial.update).mockResolvedValue({ id: "mat-1" } as never);
    const res = await action(stubUploadArgs());
    expect(res.status).toBe(202);
    await flushBackgroundWork();
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
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.courseMaterial.create).mockResolvedValue({ id: "mat-2" } as never);
    vi.mocked(prisma.courseMaterial.update).mockResolvedValue({ id: "mat-2" } as never);
    const res = await action(stubUploadArgs());
    expect(res.status).toBe(202);
    await flushBackgroundWork();
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

  it("returns 400 when the file fails validation or MIME sniffing (stays synchronous)", async () => {
    mockSession("INSTRUCTOR");
    vi.mocked(validateUploadedFile).mockRejectedValueOnce(
      new Error("File type application/zip is not supported. Supported types: PDF, TXT, MD, DOCX, PPTX"),
    );

    const res = await action(stubUploadArgs());
    expect(res.status).toBe(400);
    // Nothing is persisted for a file that never passes the gate.
    expect(prisma.courseMaterial.create).not.toHaveBeenCalled();
    expect(extractUploadedFileContent).not.toHaveBeenCalled();
  });

  it("returns 202 with a PROCESSING row before extraction runs (#949)", async () => {
    mockSession("INSTRUCTOR");
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.courseMaterial.create).mockResolvedValue({ id: "mat-202" } as never);
    vi.mocked(prisma.courseMaterial.update).mockResolvedValue({ id: "mat-202" } as never);

    const res = await action(stubUploadArgs());

    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.materialId).toBe("mat-202");
    expect(body.status).toBe("PROCESSING");
    // The row is persisted with the provisional byte-hash checksum and no text.
    expect(prisma.courseMaterial.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "PROCESSING",
          rawText: null,
          checksum: expect.stringMatching(/^pending:[0-9a-f]{64}$/),
        }),
      }),
    );
    await flushBackgroundWork();
  });

  it("finalizes the checksum and rawText in the background, then marks READY", async () => {
    mockSession("INSTRUCTOR");
    mockExtraction({ checksum: "final-checksum", content: "extracted text", title: "file" });
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.courseMaterial.create).mockResolvedValue({ id: "mat-ok" } as never);
    vi.mocked(prisma.courseMaterial.update).mockResolvedValue({ id: "mat-ok" } as never);

    await action(stubUploadArgs());
    await flushBackgroundWork();

    expect(prisma.courseMaterial.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "mat-ok" },
        data: expect.objectContaining({
          checksum: "final-checksum",
          rawText: "extracted text",
        }),
      }),
    );
    // `replace: true` even on a first run: the embed commits before the READY
    // update, so a resumed row must not append a second set of chunks.
    expect(processMaterialEmbeddings).toHaveBeenCalledWith("mat-ok", "extracted text", {
      replace: true,
    });
    expect(prisma.courseMaterial.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "mat-ok" },
        data: expect.objectContaining({ status: "READY" }),
      }),
    );
  });

  it("marks the row FAILED in the background when extraction dies (#1018)", async () => {
    mockSession("INSTRUCTOR");
    vi.mocked(extractUploadedFileContent).mockRejectedValueOnce(
      new Error("Failed to process file file.pdf: PDF extraction worker was killed (signal SIGABRT)"),
    );
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.courseMaterial.create).mockResolvedValue({ id: "mat-failed" } as never);
    vi.mocked(prisma.courseMaterial.update).mockResolvedValue({ id: "mat-failed" } as never);

    // The caller is already gone by the time extraction dies — the row, not the
    // response, is the auditable record now.
    const res = await action(stubUploadArgs());
    expect(res.status).toBe(202);
    await flushBackgroundWork();

    expect(prisma.courseMaterial.update).toHaveBeenCalledWith({
      where: { id: "mat-failed" },
      // The lease is released alongside the terminal status so the sweeper does
      // not later mistake a settled row for an abandoned one.
      data: { status: "FAILED", extractionLeaseUntil: null },
    });
    expect(processMaterialEmbeddings).not.toHaveBeenCalled();
  });

  it("marks the row FAILED in the background when embedding fails (#54)", async () => {
    mockSession("INSTRUCTOR");
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.courseMaterial.create).mockResolvedValue({ id: "mat-embed" } as never);
    vi.mocked(prisma.courseMaterial.update).mockResolvedValue({ id: "mat-embed" } as never);
    vi.mocked(processMaterialEmbeddings).mockRejectedValue(
      new Error("Invalid `prisma.$executeRaw()` invocation:\nRaw query failed."),
    );

    const res = await action(stubUploadArgs());
    expect(res.status).toBe(202);
    await flushBackgroundWork();

    expect(prisma.courseMaterial.update).toHaveBeenCalledWith({
      where: { id: "mat-embed" },
      // The lease is released alongside the terminal status so the sweeper does
      // not later mistake a settled row for an abandoned one.
      data: { status: "FAILED", extractionLeaseUntil: null },
    });
  });

  it("persists uploadedBy as the session user on create (#294)", async () => {
    mockSession("INSTRUCTOR");
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.courseMaterial.create).mockResolvedValue({ id: "mat-1" } as never);
    vi.mocked(prisma.courseMaterial.update).mockResolvedValue({ id: "mat-1" } as never);

    const res = await action(stubUploadArgs());
    expect(res.status).toBe(202);
    expect(prisma.courseMaterial.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ uploadedBy: "user-1" }),
      }),
    );
    await flushBackgroundWork();
  });

  it("leaves a FAILED receipt pointing at the winner when the content is a late duplicate", async () => {
    mockSession("ADMIN");
    mockAccess({ level: "admin", rank: 4 });
    vi.mocked(prisma.courseMaterial.create).mockResolvedValue({ id: "mat-dupe" } as never);
    // Post-extraction lookup finds an existing, live row with the same content.
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({
      id: "existing-mat",
      deletedAt: null,
    } as never);
    vi.mocked(prisma.courseMaterial.update).mockResolvedValue({ id: "mat-dupe" } as never);

    // The old synchronous 409 is now a 202 whose outcome lands on the row.
    const res = await action(stubUploadArgs());
    expect(res.status).toBe(202);
    await flushBackgroundWork();

    expect(prisma.courseMaterial.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "mat-dupe" },
        data: expect.objectContaining({
          status: "FAILED",
          duplicateOfId: "existing-mat",
        }),
      }),
    );
    // The duplicate's content must never be embedded a second time.
    expect(processMaterialEmbeddings).not.toHaveBeenCalled();
  });

  it("restores a soft-deleted material in the background, re-embedding with replace (#685)", async () => {
    mockSession("ADMIN");
    mockAccess({ level: "admin", rank: 4 });
    mockExtraction({ checksum: "abc123", content: "text" });
    vi.mocked(prisma.courseMaterial.create).mockResolvedValue({ id: "mat-restore" } as never);
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({
      id: "existing-mat",
      deletedAt: new Date(),
    } as never);
    vi.mocked(prisma.courseMaterial.update).mockResolvedValue({ id: "existing-mat" } as never);

    const res = await action(stubUploadArgs());
    expect(res.status).toBe(202);
    await flushBackgroundWork();

    // The soft-deleted original comes back — as a conditional claim that takes a
    // lease in the same write, so a crash mid-restore is recoverable rather than
    // leaving the target PROCESSING with nothing owning it (#1494 review).
    expect(restoreClaims()).toHaveLength(1);
    expect(restoreClaims()[0].data).toEqual(
      expect.objectContaining({
        deletedAt: null,
        deletedBy: null,
        status: "PROCESSING",
        extractionLeaseUntil: expect.any(Date),
      }),
    );
    // ...and its stale chunks are replaced rather than appended (#685 review).
    expect(processMaterialEmbeddings).toHaveBeenCalledWith("existing-mat", "text", {
      replace: true,
    });
    expect(prisma.courseMaterial.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "existing-mat" },
        data: expect.objectContaining({ status: "READY" }),
      }),
    );
    // This upload's own row becomes the receipt pointing at the restored one.
    expect(prisma.courseMaterial.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "mat-restore" },
        data: expect.objectContaining({ duplicateOfId: "existing-mat" }),
      }),
    );
  });

  it("resumes a restore whose worker died instead of resolving the receipt (#1494 review)", async () => {
    mockSession("ADMIN");
    mockAccess({ level: "admin", rank: 4 });
    mockExtraction({ checksum: "abc123", content: "text" });
    vi.mocked(prisma.courseMaterial.create).mockResolvedValue({ id: "mat-restore" } as never);
    // A previous attempt un-deleted the target and then died: it is PROCESSING,
    // no longer soft-deleted, and its lease has lapsed. Reading "not deleted" as
    // "settled" would resolve the receipt and strand the target forever — the
    // receipt is the only thing that can reach it, because the target carries a
    // content checksum the sweeper's `pending:` scan cannot see.
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({
      id: "existing-mat",
      deletedAt: null,
      status: "PROCESSING",
      extractionLeaseUntil: new Date(Date.now() - 60_000),
    } as never);
    vi.mocked(prisma.courseMaterial.update).mockResolvedValue({ id: "existing-mat" } as never);

    await action(stubUploadArgs());
    await flushBackgroundWork();

    expect(restoreClaims()).toHaveLength(1);
    expect(processMaterialEmbeddings).toHaveBeenCalledWith("existing-mat", "text", {
      replace: true,
    });
    expect(prisma.courseMaterial.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "existing-mat" },
        data: expect.objectContaining({ status: "READY" }),
      }),
    );
    // Only now does the receipt resolve.
    expect(receiptUpdates()).toHaveLength(1);
  });

  it("leaves the receipt open while another worker's restore is still live (#1494 review)", async () => {
    mockSession("ADMIN");
    mockAccess({ level: "admin", rank: 4 });
    mockExtraction({ checksum: "abc123", content: "text" });
    vi.mocked(prisma.courseMaterial.create).mockResolvedValue({ id: "mat-restore" } as never);
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({
      id: "existing-mat",
      deletedAt: null,
      status: "PROCESSING",
      extractionLeaseUntil: new Date(Date.now() + 60_000),
    } as never);

    await action(stubUploadArgs());
    await flushBackgroundWork();

    // Pointing the receipt at a target that is still mid-flight would promise a
    // settled winner that is not one. Wait; a later sweep sees the truth.
    expect(restoreClaims()).toHaveLength(0);
    expect(receiptUpdates()).toHaveLength(0);
    expect(processMaterialEmbeddings).not.toHaveBeenCalled();
  });

  it("keeps the receipt PROCESSING until a slow restore settles (#1494 review)", async () => {
    mockSession("ADMIN");
    mockAccess({ level: "admin", rank: 4 });
    mockExtraction({ checksum: "abc123", content: "text" });
    vi.mocked(prisma.courseMaterial.create).mockResolvedValue({ id: "mat-restore" } as never);
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({
      id: "existing-mat",
      deletedAt: new Date(),
    } as never);
    vi.mocked(prisma.courseMaterial.update).mockResolvedValue({ id: "existing-mat" } as never);
    // Re-embedding the restored material is still in flight.
    let finishEmbedding: () => void = () => {};
    vi.mocked(processMaterialEmbeddings).mockImplementation(
      () => new Promise<void>((resolve) => { finishEmbedding = () => resolve(); }),
    );

    const res = await action(stubUploadArgs());
    expect(res.status).toBe(202);
    await flushBackgroundWork();

    // Marking the receipt terminal here would tell a polling client "duplicate,
    // nothing was added" while the restored row is still PROCESSING — and the
    // client deletes the receipt on that outcome, losing the later truth.
    expect(receiptUpdates()).toHaveLength(0);

    finishEmbedding();
    await flushBackgroundWork();
    expect(receiptUpdates()).toHaveLength(1);
    expect(receiptUpdates()[0].data).toEqual(
      expect.objectContaining({ status: "FAILED", duplicateOfId: "existing-mat" }),
    );
  });

  it("resolves the receipt only after a failing restore has landed FAILED (#1494 review)", async () => {
    mockSession("ADMIN");
    mockAccess({ level: "admin", rank: 4 });
    mockExtraction({ checksum: "abc123", content: "text" });
    vi.mocked(prisma.courseMaterial.create).mockResolvedValue({ id: "mat-restore" } as never);
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({
      id: "existing-mat",
      deletedAt: new Date(),
    } as never);
    vi.mocked(prisma.courseMaterial.update).mockResolvedValue({ id: "existing-mat" } as never);
    vi.mocked(processMaterialEmbeddings).mockRejectedValue(new Error("embedding provider down"));

    const res = await action(stubUploadArgs());
    expect(res.status).toBe(202);
    await flushBackgroundWork();

    // The restored row records the failure...
    expect(prisma.courseMaterial.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "existing-mat" },
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
    // ...and only then does the receipt resolve, so the client's poll observes
    // the settled outcome rather than a premature "nothing was added".
    const restoreFailedAt = updateCallIndex(
      (c) => c.where?.id === "existing-mat" && c.data?.status === "FAILED",
    );
    const receiptAt = updateCallIndex((c) => c.where?.id === "mat-restore");
    expect(receiptAt).toBeGreaterThan(restoreFailedAt);
  });

  it("returns 409 when the identical bytes are already being processed", async () => {
    mockSession("INSTRUCTOR");
    vi.mocked(prisma.courseMaterial.create).mockRejectedValue(
      Object.assign(new Error("Unique constraint failed on the fields: (`courseId`,`checksum`)"), {
        code: "P2002",
      }),
    );
    // The colliding `pending:` row is still mid-flight → a genuine concurrent
    // upload of the same file, which still fails fast exactly as before #949.
    // The conditional claim matches nothing because the row is live PROCESSING.
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({
      id: "inflight-mat",
    } as never);
    mockReclaim(0);

    const res = await action(stubUploadArgs());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.materialId).toBe("inflight-mat");
    expect(extractUploadedFileContent).not.toHaveBeenCalled();
  });

  it("reclaims and retries a stranded pending row instead of 409ing", async () => {
    mockSession("INSTRUCTOR");
    vi.mocked(prisma.courseMaterial.create).mockRejectedValue(
      Object.assign(new Error("Unique constraint failed on the fields: (`courseId`,`checksum`)"), {
        code: "P2002",
      }),
    );
    // A previous attempt died and left the row FAILED — re-uploading the same
    // bytes is the recovery path for the fire-and-forget hole.
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValueOnce({
      id: "stranded-mat",
    } as never);
    vi.mocked(prisma.courseMaterial.update).mockResolvedValue({ id: "stranded-mat" } as never);

    const res = await action(stubUploadArgs());
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.materialId).toBe("stranded-mat");
    expect(reclaimClaims()).toHaveLength(1);
    expect(reclaimClaims()[0].data).toEqual(
      expect.objectContaining({
        status: "PROCESSING",
        duplicateOfId: null,
        // The reclaimed row must come back as a fresh job, not one strike from
        // the sweeper abandoning it.
        extractionAttempts: 0,
        extractionLeaseUntil: null,
      }),
    );
    // The bytes are replaced too, so a resume re-runs what this caller uploaded.
    expect(prisma.materialUploadBlob.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { materialId: "stranded-mat" } }),
    );
    await flushBackgroundWork();
    expect(extractUploadedFileContent).toHaveBeenCalled();
  });

  it("commits the reclaim and the replacement bytes together (#1494 review)", async () => {
    // Two statements left a window: fail between the claim and the blob upsert
    // and the row is PROCESSING with no bytes — the sweeper skips it for want of
    // a blob, and an identical retry answers 409. Permanently stranded, with no
    // recovery path at all. Claim and blob now share one transaction.
    mockSession("INSTRUCTOR");
    vi.mocked(prisma.courseMaterial.create).mockRejectedValue(
      Object.assign(new Error("Unique constraint failed on the fields: (`courseId`,`checksum`)"), {
        code: "P2002",
      }),
    );
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValueOnce({
      id: "stranded-mat",
    } as never);
    vi.mocked(prisma.courseMaterial.update).mockResolvedValue({ id: "stranded-mat" } as never);

    const res = await action(stubUploadArgs());

    expect(res.status).toBe(202);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    // Both writes ran against the transaction client, not the base one.
    const tx = vi.mocked(prisma.$transaction).mock.calls[0][0];
    expect(typeof tx).toBe("function");
    expect(prisma.materialUploadBlob.upsert).toHaveBeenCalledTimes(1);
    await flushBackgroundWork();
  });

  it("leaves the loser's bytes alone when the reclaim claim is lost (#1494 review)", async () => {
    // Overwriting the blob after losing the claim would swap the bytes out from
    // under the run the winner just started.
    mockSession("INSTRUCTOR");
    vi.mocked(prisma.courseMaterial.create).mockRejectedValue(
      Object.assign(new Error("Unique constraint failed on the fields: (`courseId`,`checksum`)"), {
        code: "P2002",
      }),
    );
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({
      id: "stranded-mat",
    } as never);
    mockReclaim(0);

    const res = await action(stubUploadArgs());

    expect(res.status).toBe(409);
    expect(prisma.materialUploadBlob.upsert).not.toHaveBeenCalled();
  });

  it("claims a stranded row conditionally, not with a blind update (#1494 review)", async () => {
    mockSession("INSTRUCTOR");
    vi.mocked(prisma.courseMaterial.create).mockRejectedValue(
      Object.assign(new Error("Unique constraint failed on the fields: (`courseId`,`checksum`)"), {
        code: "P2002",
      }),
    );
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValueOnce({
      id: "stranded-mat",
    } as never);

    await action(stubUploadArgs());

    // Every condition that made the row reclaimable must live in the UPDATE's
    // WHERE, so the database — not a stale read — decides who gets the row.
    expect(reclaimClaims()[0].where).toEqual(
      expect.objectContaining({
        id: "stranded-mat",
        // Pins the row to the provisional state the lookup saw it in.
        checksum: expect.stringMatching(/^pending:/),
        OR: [
          { status: { not: "PROCESSING" } },
          { extractionLeaseUntil: { lt: expect.any(Date) } },
        ],
      }),
    );
  });

  it("does not reclaim a row a worker finalized between the read and the write (#1494 review)", async () => {
    mockSession("INSTRUCTOR");
    vi.mocked(prisma.courseMaterial.create).mockRejectedValue(
      Object.assign(new Error("Unique constraint failed on the fields: (`courseId`,`checksum`)"), {
        code: "P2002",
      }),
    );
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({
      id: "finalized-mat",
    } as never);
    // The row's worker finalized it in the gap: its `pending:` checksum is now
    // the real content hash, so the claim's checksum condition matches nothing.
    // Without that condition the UPDATE would reset a READY row to PROCESSING
    // with a null rawText.
    mockReclaim(0);

    const res = await action(stubUploadArgs());

    expect(res.status).toBe(409);
    expect((await res.json()).materialId).toBe("finalized-mat");
    expect(reclaimClaims()[0].where.checksum).toEqual(expect.stringMatching(/^pending:/));
    expect(extractUploadedFileContent).not.toHaveBeenCalled();
  });

  it("does not hand a soft-deleted row to a second worker while the first still holds it (#1494 review)", async () => {
    mockSession("INSTRUCTOR");
    vi.mocked(prisma.courseMaterial.create).mockRejectedValue(
      Object.assign(new Error("Unique constraint failed on the fields: (`courseId`,`checksum`)"), {
        code: "P2002",
      }),
    );
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({
      id: "deleted-inflight-mat",
    } as never);
    mockReclaim(0);

    const res = await action(stubUploadArgs());

    // A DELETE issued mid-processing used to make the row reclaimable on
    // `deletedAt != null` alone, so a re-upload could start a second worker on a
    // row the first was still writing to. Reclaim now requires the lease to have
    // expired, soft-deleted or not — the live case is a 409.
    expect(res.status).toBe(409);
    expect(reclaimClaims()[0].where.OR).toEqual([
      { status: { not: "PROCESSING" } },
      { extractionLeaseUntil: { lt: expect.any(Date) } },
    ]);
    expect(extractUploadedFileContent).not.toHaveBeenCalled();
  });

  it("409s the loser when two identical retries race for the same stranded row (#1494 review)", async () => {
    mockSession("INSTRUCTOR");
    const p2002 = () =>
      Object.assign(new Error("Unique constraint failed on the fields: (`courseId`,`checksum`)"), {
        code: "P2002",
      });
    vi.mocked(prisma.courseMaterial.create).mockRejectedValue(p2002());
    // Both retries read the row as reclaimable...
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({
      id: "stranded-mat",
    } as never);
    // ...but the conditional claim only matches for the first one.
    mockReclaim(1, 0);
    vi.mocked(prisma.courseMaterial.update).mockResolvedValue({ id: "stranded-mat" } as never);

    const [first, second] = await Promise.all([
      action(stubUploadArgs()),
      action(stubUploadArgs()),
    ]);

    expect(first.status).toBe(202);
    expect(second.status).toBe(409);
    expect((await second.json()).materialId).toBe("stranded-mat");
    await flushBackgroundWork();
    // Exactly one background run against the shared row — the whole point of
    // the atomic claim is that the loser never starts a second extraction.
    expect(extractUploadedFileContent).toHaveBeenCalledTimes(1);
  });

  it("returns 500 for a create() failure unrelated to the checksum unique constraint", async () => {
    mockSession("INSTRUCTOR");
    vi.mocked(prisma.courseMaterial.create).mockRejectedValue(new Error("connection refused"));

    const res = await action(stubUploadArgs());
    expect(res.status).toBe(500);
    // Only the checksum-conflict path re-queries; any other create() failure
    // must not trigger the reclaim lookup.
    expect(prisma.courseMaterial.findFirst).not.toHaveBeenCalled();
    expect(extractUploadedFileContent).not.toHaveBeenCalled();
  });

  it("turns a finalize-time unique violation into a receipt (#225 RAG-04, deferred)", async () => {
    mockSession("INSTRUCTOR");
    mockExtraction({ checksum: "race-checksum" });
    vi.mocked(prisma.courseMaterial.create).mockResolvedValue({ id: "loser-mat" } as never);
    vi.mocked(prisma.courseMaterial.findFirst)
      // The duplicate pre-check sees nothing (the race window)...
      .mockResolvedValueOnce(null)
      // ...but a concurrent finalize committed first, so the winner is only
      // visible after our own update is rejected by the unique index.
      .mockResolvedValueOnce({ id: "winner-mat" } as never);
    vi.mocked(prisma.courseMaterial.update)
      .mockRejectedValueOnce(
        Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
      )
      .mockResolvedValue({ id: "loser-mat" } as never);

    await action(stubUploadArgs());
    await flushBackgroundWork();

    expect(prisma.courseMaterial.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "loser-mat" },
        data: expect.objectContaining({
          status: "FAILED",
          duplicateOfId: "winner-mat",
        }),
      }),
    );
    expect(processMaterialEmbeddings).not.toHaveBeenCalled();
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

  it("lets a student clear their own duplicate receipt (#1494 review)", async () => {
    // Students may upload when `students.canUploadMaterials` is on, and a late
    // content-duplicate leaves them a FAILED receipt the client is expected to
    // delete. Rank 0 could not, so every student duplicate left a dead row in
    // the course's material list, one per retry.
    mockSession("STUDENT", "student-user");
    mockAccess({ level: "student", rank: 0 });
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({
      id: "receipt-1",
      uploadedBy: "student-user",
      status: "FAILED",
      duplicateOfId: "winner-1",
    } as never);

    const res = await action(makeDeleteArgs("receipt-1"));

    expect(res.status).toBe(204);
    expect(prisma.courseMaterial.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "receipt-1" } }),
    );
  });

  it("does not let the receipt carve-out reach real material", async () => {
    // The carve-out is scoped to the receipt shape: own row, FAILED, pointing at
    // a winner. A material that merely failed to parse is still material.
    mockSession("STUDENT", "student-user");
    mockAccess({ level: "student", rank: 0 });
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({
      id: "mat-1",
      uploadedBy: "student-user",
      status: "FAILED",
      duplicateOfId: null,
    } as never);

    expect((await action(makeDeleteArgs("mat-1"))).status).toBe(403);

    // Nor another student's receipt.
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({
      id: "receipt-2",
      uploadedBy: "other-student",
      status: "FAILED",
      duplicateOfId: "winner-1",
    } as never);

    expect((await action(makeDeleteArgs("receipt-2"))).status).toBe(403);
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
    const res = await action(makeRenameArgs("mat-1", { availableAt: "2099-01-01T00:00:00.000Z" }));
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
    const where = (vi.mocked(prisma.courseMaterial.findMany).mock.calls[0][0] as any).where;
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
    const where = (vi.mocked(prisma.courseMaterial.findMany).mock.calls[0][0] as any).where;
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
    const where = (vi.mocked(prisma.courseMaterial.findFirst).mock.calls[0][0] as any).where;
    expect(where).toEqual(expect.objectContaining({ visibleToStudents: true }));
  });
});

// ---------------------------------------------------------------------------
// loader — list payload excludes rawText (#948)
// ---------------------------------------------------------------------------

describe("GET materials — list payload excludes rawText (#948)", () => {
  /** Every column list responses are contracted to carry. */
  const EXPECTED_LIST_COLUMNS = [
    "id",
    "courseId",
    "title",
    "mimeType",
    "fileSize",
    "checksum",
    "status",
    "externalId",
    "externalSource",
    "canvasUpdatedAt",
    "uploadedBy",
    "visibleToStudents",
    "availableAt",
    "deletedAt",
    "deletedBy",
    "unpublishedAt",
    "createdAt",
    "updatedAt",
    "processedAt",
  ];

  function listSelect() {
    return (vi.mocked(prisma.courseMaterial.findMany).mock.calls[0][0] as any).select;
  }

  it("selects an explicit column set with rawText omitted (student/staff loader path)", async () => {
    mockSession("INSTRUCTOR");
    mockAccess({ level: "instructor", rank: 2 });
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([]);
    await loader(makeArgs("GET"));

    const args = vi.mocked(prisma.courseMaterial.findMany).mock.calls[0][0] as any;
    // `include` and `select` cannot coexist at the same level in Prisma.
    expect(args.include).toBeUndefined();
    expect(listSelect()).toBeDefined();
    expect(listSelect().rawText).toBeUndefined();
    for (const col of EXPECTED_LIST_COLUMNS) {
      expect(listSelect()[col]).toBe(true);
    }
    expect(listSelect()._count).toEqual({ select: { chunks: true } });
  });

  it("keeps visibleToStudents/availableAt selected so the staff branch does not emit undefined", async () => {
    mockSession("INSTRUCTOR");
    mockAccess({ level: "instructor", rank: 2 });
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([]);
    await loader(makeArgs("GET"));
    expect(listSelect().visibleToStudents).toBe(true);
    expect(listSelect().availableAt).toBe(true);
  });

  it("uses the same select on the ADMIN includeDeleted list path (no drift)", async () => {
    mockSession("ADMIN");
    vi.mocked(prisma.course.findUnique).mockResolvedValue({ id: COURSE_ID } as never);
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([]);
    await loader({
      request: new Request(
        `http://localhost/api/courses/${COURSE_ID}/materials?includeDeleted=true`,
        { method: "GET" },
      ),
      params: { courseId: COURSE_ID },
      context: {} as never,
    } as any);

    const args = vi.mocked(prisma.courseMaterial.findMany).mock.calls[0][0] as any;
    expect(args.include).toBeUndefined();
    expect(args.select.rawText).toBeUndefined();
    for (const col of EXPECTED_LIST_COLUMNS) {
      expect(args.select[col]).toBe(true);
    }
  });

  it("never serializes rawText into the list response body", async () => {
    mockSession("INSTRUCTOR");
    mockAccess({ level: "instructor", rank: 2 });
    // Simulate a driver that ignored the select and handed back rawText anyway:
    // the response must still not carry it for a staff caller.
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([
      { id: "mat-1", title: "Slides", _count: { chunks: 2 } },
    ] as never);
    const body = await (await loader(makeArgs("GET"))).json();
    expect(body.materials[0]).not.toHaveProperty("rawText");
    expect(body.materials[0].chunkCount).toBe(2);
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
