import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({
  enforceAdminIfApiKey: vi.fn().mockResolvedValue({ response: null, session: null }),
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    course: { findFirst: vi.fn() },
    courseMaterial: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("~/lib/ai/embedding", () => ({
  processMaterialEmbeddings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/ai/file-processing", () => ({
  processUploadedFile: vi.fn(),
}));

import { loader, action } from "~/routes/api/courses.materials.$";
import { auth } from "~/lib/auth/server";
import { enforceAdminIfApiKey } from "~/lib/auth/guards.server";
import prisma from "~/lib/prisma.server";
import { processUploadedFile } from "~/lib/ai/file-processing";

const COURSE_ID = "course-1";

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

function mockSession(role: string) {
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: "user-1", role },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(enforceAdminIfApiKey).mockResolvedValue({ response: null, session: null });
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

  it("returns 404 when course not found or user not enrolled", async () => {
    mockSession("STUDENT");
    vi.mocked(prisma.course.findFirst).mockResolvedValue(null);
    const res = await loader(makeArgs("GET"));
    expect(res.status).toBe(404);
  });

  it("checks enrollment for non-admin users", async () => {
    mockSession("STUDENT");
    vi.mocked(prisma.course.findFirst).mockResolvedValue({ id: COURSE_ID } as never);
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([]);
    await loader(makeArgs("GET"));
    expect(prisma.course.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          enrollments: { some: { userId: "user-1", isActive: true } },
        }),
      }),
    );
  });

  it("bypasses enrollment check for ADMIN", async () => {
    mockSession("ADMIN");
    vi.mocked(prisma.course.findFirst).mockResolvedValue({ id: COURSE_ID } as never);
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([]);
    await loader(makeArgs("GET"));
    const call = vi.mocked(prisma.course.findFirst).mock.calls[0]?.[0];
    expect(call?.where).not.toHaveProperty("enrollments");
  });

  it("bypasses enrollment check for UNIT_ADMIN", async () => {
    mockSession("UNIT_ADMIN");
    vi.mocked(prisma.course.findFirst).mockResolvedValue({ id: COURSE_ID } as never);
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([]);
    await loader(makeArgs("GET"));
    const call = vi.mocked(prisma.course.findFirst).mock.calls[0]?.[0];
    expect(call?.where).not.toHaveProperty("enrollments");
  });

  it("returns 200 with materials for enrolled user", async () => {
    mockSession("STUDENT");
    vi.mocked(prisma.course.findFirst).mockResolvedValue({ id: COURSE_ID } as never);
    vi.mocked(prisma.courseMaterial.findMany).mockResolvedValue([{ id: "mat-1" }] as never);
    const res = await loader(makeArgs("GET"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.materials).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// action
// ---------------------------------------------------------------------------

describe("POST /api/courses/:courseId/materials action", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    const res = await action(makeArgs("POST"));
    expect(res.status).toBe(401);
  });

  it("returns 404 when course not found or user not enrolled", async () => {
    mockSession("INSTRUCTOR");
    vi.mocked(prisma.course.findFirst).mockResolvedValue(null);
    const res = await action(makeArgs("POST"));
    expect(res.status).toBe(404);
  });

  it("returns 400 when no file provided", async () => {
    mockSession("INSTRUCTOR");
    vi.mocked(prisma.course.findFirst).mockResolvedValue({ id: COURSE_ID } as never);
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

  it("returns 409 when duplicate file checksum exists", async () => {
    mockSession("ADMIN");
    vi.mocked(prisma.course.findFirst).mockResolvedValue({ id: COURSE_ID } as never);
    vi.mocked(processUploadedFile).mockResolvedValue({
      checksum: "abc123", title: "file.pdf", mimeType: "application/pdf",
      fileSize: 100, content: "text",
    } as never);
    vi.mocked(prisma.courseMaterial.findFirst).mockResolvedValue({ id: "existing-mat" } as never);

    const form = new FormData();
    form.append("file", new Blob(["content"]), "file.pdf");
    form.append("apiKeys", "{}");
    const res = await action({
      request: new Request(`http://localhost/api/courses/${COURSE_ID}/materials`, {
        method: "POST",
        body: form,
      }),
      params: { courseId: COURSE_ID },
      context: {} as never,
    });
    expect(res.status).toBe(409);
  });
});
