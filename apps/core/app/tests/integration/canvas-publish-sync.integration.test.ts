// @vitest-environment node
//
// Integration coverage for Task 12: real-Postgres cross-check of Canvas
// publish-state detection and file exclusion, exercised directly against
// `materials.server.ts` (no HTTP route exists yet for this feature).

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import prisma from "~/lib/prisma.server";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/ai/embedding", () => ({
  processMaterialEmbeddings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/ai/file-processing", () => ({
  processUploadedFile: vi.fn().mockImplementation(async (file: File) => ({
    title: file.name,
    mimeType: file.type || "text/plain",
    fileSize: file.size,
    checksum: `checksum-${file.name}-${Math.random()}`,
    content: "mock canvas file content",
  })),
}));

vi.mock("~/lib/canvas/client.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/canvas/client.server")>();
  return {
    ...actual,
    listCanvasCourseFiles: vi.fn(),
  };
});

import { loader, action } from "~/routes/api/canvas.$";
import { auth } from "~/lib/auth/server";
import { listCanvasCourseFiles, type CanvasFileApi } from "~/lib/canvas/client.server";
import {
  discoverCanvasMaterialsForCourse,
  syncSelectedCanvasMaterials,
  excludeCanvasMaterial,
  unexcludeCanvasMaterial,
} from "~/lib/canvas/materials.server";

const TEST_ENCRYPTION_KEY = "canvas-publish-sync-test-key!!";

let instructorId: string;
let courseId: string;

function sessionFor(userId: string, role: string) {
  vi.mocked(auth.api.getSession).mockResolvedValue({
    user: { id: userId, role },
  } as never);
}

function makeArgs(method: string, subpath: string, body?: unknown) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const args = {
    request: new Request(`http://localhost/api/canvas/${subpath}`, init),
    params: {} as Record<string, string>,
    context: {} as never,
  } as any;
  return args;
}

async function call(method: string, subpath: string, body?: unknown) {
  const args = makeArgs(method, subpath, body);
  if (method === "GET") {
    return loader(args);
  }
  return action(args);
}

async function connectTestMode() {
  sessionFor(instructorId, "INSTRUCTOR");
  const res = await call("POST", "connect", {
    canvasUrl: "http://localhost:8080",
    isTestMode: true,
  });
  expect(res.status).toBe(200);
}

function mockFile(overrides: Partial<CanvasFileApi> & { id: number }): CanvasFileApi {
  return {
    display_name: `File ${overrides.id}.txt`,
    filename: `file-${overrides.id}.txt`,
    "content-type": "text/plain",
    size: 128,
    updated_at: "2025-01-10T12:00:00.000Z",
    url: `mock://canvas/files/${overrides.id}`,
    ...overrides,
  };
}

async function cleanupPublishSyncData() {
  const instructorCourses = await prisma.enrollment.findMany({
    where: { userId: instructorId, role: "INSTRUCTOR" },
    select: { courseId: true },
  });
  const courseIds = instructorCourses.map((enrollment) => enrollment.courseId);

  if (courseIds.length > 0) {
    await prisma.courseMaterial.deleteMany({ where: { courseId: { in: courseIds } } });
    await prisma.canvasMaterialExclusion.deleteMany({ where: { courseId: { in: courseIds } } });
    await prisma.canvasRosterMember.deleteMany({ where: { courseId: { in: courseIds } } });
    await prisma.enrollment.deleteMany({ where: { courseId: { in: courseIds } } });
    await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
  }
}

beforeAll(async () => {
  vi.stubEnv("ENCRYPTION_KEY", TEST_ENCRYPTION_KEY);

  const instructor = await prisma.user.create({
    data: {
      email: "canvas-pubsync-instructor@test.com",
      name: "Canvas Publish Sync Instructor",
      role: "INSTRUCTOR",
      emailVerified: true,
    },
  });
  instructorId = instructor.id;

  await connectTestMode();
  sessionFor(instructorId, "INSTRUCTOR");
  const syncRes = await call("POST", "sync", { canvasCourseIds: ["1"] });
  expect(syncRes.status).toBe(200);

  const course = await prisma.course.findFirst({
    where: { externalSource: "canvas", externalId: "1" },
  });
  expect(course).not.toBeNull();
  courseId = course!.id;
});

afterAll(async () => {
  await cleanupPublishSyncData();
  await prisma.canvasIntegration.deleteMany({ where: { userId: instructorId } });
  await prisma.user.deleteMany({
    where: { email: { startsWith: "canvas-pubsync-", endsWith: "@test.com" } },
  });
  vi.unstubAllEnvs();
  await prisma.$disconnect();
});

beforeEach(async () => {
  vi.mocked(listCanvasCourseFiles).mockReset();
});

describe("Canvas materials — publish-state re-sync and exclusion (real DB)", () => {
  it("flips unpublishedAt on re-discovery when a Canvas file becomes unpublished, then clears it when republished", async () => {
    const canvasFileId = "500001";
    const file = mockFile({ id: 500001 });
    vi.mocked(listCanvasCourseFiles).mockResolvedValue([file]);

    const syncResult = await syncSelectedCanvasMaterials(instructorId, courseId, [canvasFileId]);
    expect(syncResult.imported).toBe(1);

    const importedMaterial = await prisma.courseMaterial.findFirst({
      where: { courseId, externalSource: "canvas", externalId: canvasFileId },
    });
    expect(importedMaterial).not.toBeNull();
    expect(importedMaterial!.unpublishedAt).toBeNull();

    // Canvas file becomes hidden (unpublished).
    vi.mocked(listCanvasCourseFiles).mockResolvedValue([mockFile({ id: 500001, hidden: true })]);
    await discoverCanvasMaterialsForCourse(instructorId, courseId);

    const afterUnpublish = await prisma.courseMaterial.findFirst({
      where: { id: importedMaterial!.id },
    });
    expect(afterUnpublish!.unpublishedAt).not.toBeNull();

    // Canvas file is republished.
    vi.mocked(listCanvasCourseFiles).mockResolvedValue([mockFile({ id: 500001 })]);
    await discoverCanvasMaterialsForCourse(instructorId, courseId);

    const afterRepublish = await prisma.courseMaterial.findFirst({
      where: { id: importedMaterial!.id },
    });
    expect(afterRepublish!.unpublishedAt).toBeNull();
  });

  it("excludes a file from import and prevents re-import until un-excluded", async () => {
    const canvasFileId = "500002";
    const file = mockFile({ id: 500002 });
    vi.mocked(listCanvasCourseFiles).mockResolvedValue([file]);

    await excludeCanvasMaterial(instructorId, courseId, canvasFileId);

    const result = await syncSelectedCanvasMaterials(instructorId, courseId, [canvasFileId]);
    expect(result.imported).toBe(0);
    expect(result.skippedItems).toContainEqual({ canvasFileId, reason: "excluded" });

    const materialAfterExcludedSync = await prisma.courseMaterial.findFirst({
      where: { courseId, externalSource: "canvas", externalId: canvasFileId },
    });
    expect(materialAfterExcludedSync).toBeNull();

    await unexcludeCanvasMaterial(instructorId, courseId, canvasFileId);

    const result2 = await syncSelectedCanvasMaterials(instructorId, courseId, [canvasFileId]);
    expect(result2.imported).toBe(1);

    const materialAfterReimport = await prisma.courseMaterial.findFirst({
      where: { courseId, externalSource: "canvas", externalId: canvasFileId },
    });
    expect(materialAfterReimport).not.toBeNull();
  });
});
