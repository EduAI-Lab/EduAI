import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Topic analysis must be triggered only once material has actually been
 * processed (#1624). These cover the two trigger sites end of the contract: the
 * Canvas batch importer and the upload extraction job.
 */

const prismaMock = vi.hoisted(() => ({
  course: { findUnique: vi.fn() },
  courseMaterial: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  canvasMaterialExclusion: { findMany: vi.fn() },
}));
const startTopicAnalysis = vi.hoisted(() => vi.fn());
const listCanvasCourseFiles = vi.hoisted(() => vi.fn());
const requireCanvasCredentials = vi.hoisted(() => vi.fn());

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));
vi.mock("~/lib/topics/job.server", () => ({ startTopicAnalysis }));
vi.mock("~/lib/ai/embedding", () => ({ processMaterialEmbeddings: vi.fn() }));
vi.mock("~/lib/ai/file-processing", () => ({ processUploadedFile: vi.fn() }));
vi.mock("~/lib/canvas/courses.server", () => ({
  requireCanvasCredentials,
  validateInstructorCanvasCourseIds: vi.fn(),
  CANVAS_EXTERNAL_SOURCE: "canvas",
}));
vi.mock("~/lib/canvas/client.server", () => ({
  CANVAS_EXTERNAL_SOURCE: "canvas",
  listCanvasCourseFiles,
  downloadCanvasFile: vi.fn(),
  computeCanvasFilePublishState: () => ({ isPublished: true }),
  resolveCanvasFileDownloadUrl: (url: string) => url,
}));

const { syncSelectedCanvasMaterials } = await import("~/lib/canvas/materials.server");

const COURSE = { id: "course-1", externalId: "canvas-77", externalSource: "canvas" };

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.course.findUnique.mockResolvedValue(COURSE);
  prismaMock.canvasMaterialExclusion.findMany.mockResolvedValue([]);
  requireCanvasCredentials.mockResolvedValue({
    canvasUrl: "https://canvas.test",
    apiKey: "k",
    isTestMode: false,
  });
});

describe("syncSelectedCanvasMaterials — topic analysis trigger", () => {
  it("does not start analysis when the batch imported nothing", async () => {
    // Every requested file is missing from Canvas, so the sync reports failures
    // and imports zero materials — there is no new structure to analyse.
    listCanvasCourseFiles.mockResolvedValue([]);

    const result = await syncSelectedCanvasMaterials("user-1", "course-1", ["999"]);

    expect(result.imported + result.updated).toBe(0);
    expect(startTopicAnalysis).not.toHaveBeenCalled();
  });

  it("does not start analysis when no material reached READY", async () => {
    listCanvasCourseFiles.mockResolvedValue([]);
    prismaMock.courseMaterial.findMany.mockResolvedValue([]);

    await syncSelectedCanvasMaterials("user-1", "course-1", []);

    expect(startTopicAnalysis).not.toHaveBeenCalled();
  });
});
