// @vitest-environment node
/**
 * #1821: the course-material context source.
 * - an invalid hint degrades the WHOLE context, an empty hint means "nothing";
 * - access is re-derived from the database for this reader (publish gate,
 *   students.canViewMaterials, per-material visibility) — the hint widens nothing;
 * - a course opted out of AI contributes nothing;
 * - secret-bearing fields of a real material row never reach the built block;
 * - nothing in this path throws.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const gateMock = vi.hoisted(() => ({ resolveCourseAccessGate: vi.fn() }));
vi.mock("~/lib/auth/course-access.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/lib/auth/course-access.server")>()),
  resolveCourseAccessGate: gateMock.resolveCourseAccessGate,
}));

const prismaMock = vi.hoisted(() => ({
  course: { findUnique: vi.fn() },
  courseMaterial: { findFirst: vi.fn() },
  canvasMaterialExclusion: { findMany: vi.fn() },
}));
vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

const policyMock = vi.hoisted(() => ({ getPolicy: vi.fn() }));
vi.mock("~/lib/policy.server", () => ({ getPolicy: policyMock.getPolicy }));

const embeddingMock = vi.hoisted(() => ({ findRelevantContent: vi.fn() }));
vi.mock("~/lib/ai/embedding", () => ({ findRelevantContent: embeddingMock.findRelevantContent }));

import { accessLevelFor } from "~/lib/auth/course-access.server";
import {
  buildMaterialContext,
  parsePageContextHint,
  projectMaterialBlock,
  resolvePageContext,
} from "~/lib/assistant/material-context.server";
import { materialSourceAvailable } from "~/lib/assistant/assistant-gate.server";
import { defaultAssistantSettings } from "~/lib/assistant/assistant-settings";

const student = { id: "u-student", role: "STUDENT" };
const COURSE = {
  id: "c1",
  department: "CS",
  isPublished: true,
  instructorId: "u-teacher",
  deletedAt: null,
};

/** A realistic material row, carrying every field a leak would come from. */
const MATERIAL_ROW = {
  id: "m1",
  title: "Week 1 — Recursion",
  mimeType: "application/pdf",
  fileSize: 52_013,
  status: "READY",
  createdAt: new Date("2026-09-01T00:00:00Z"),
  rawText: "Recursion is a function calling itself. Base cases stop it.",
  checksum: "sha256:9f2c1e-secret-checksum",
  uploadedBy: "u-teacher",
  externalId: "canvas-file-77",
  extractionLeaseUntil: null,
  duplicateOfId: null,
  uploader: { email: "teacher.private@ubc.ca" },
};

function setCourse(access: ReturnType<typeof accessLevelFor> | null, overrides = {}) {
  gateMock.resolveCourseAccessGate.mockResolvedValue({
    course: { ...COURSE, ...overrides },
    access,
  });
  prismaMock.course.findUnique.mockResolvedValue({
    code: "CS101",
    name: "Intro to CS",
    aiAssistantEnabled: true,
  });
}

const settings = defaultAssistantSettings();
const availability = { platformEnabled: true, hasEnabledProvider: true, settings };

beforeEach(() => {
  vi.clearAllMocks();
  policyMock.getPolicy.mockResolvedValue(true);
  prismaMock.canvasMaterialExclusion.findMany.mockResolvedValue([]);
});

describe("parsePageContextHint", () => {
  it("accepts a course, or a course and a material", () => {
    expect(parsePageContextHint({ courseId: "c1" })).toEqual({ courseId: "c1", materialId: null });
    expect(parsePageContextHint({ courseId: "c1", materialId: "m1" })).toEqual({
      courseId: "c1",
      materialId: "m1",
    });
  });

  it("treats an empty hint as 'nothing published yet', never 'everything'", () => {
    expect(parsePageContextHint({})).toBeNull();
    expect(parsePageContextHint(null)).toBeNull();
  });

  it("degrades the WHOLE hint when any field is off", () => {
    expect(parsePageContextHint({ courseId: "c1", materialId: "../m1" })).toBeNull();
    expect(parsePageContextHint({ courseId: "c1", lessonId: "x" })).toBeNull();
    expect(parsePageContextHint({ materialId: "m1" })).toBeNull();
    expect(parsePageContextHint({ courseId: "c1; DROP TABLE courses" })).toBeNull();
  });
});

describe("resolvePageContext — re-derived for this reader", () => {
  it("a course that does not exist fails closed as missing", async () => {
    gateMock.resolveCourseAccessGate.mockResolvedValue({ course: null, access: null });
    await expect(
      resolvePageContext(student, { courseId: "nope", materialId: null }),
    ).resolves.toEqual({
      kind: "missing",
    });
  });

  it("a reader with no access to the course gets no material", async () => {
    setCourse(null);
    const resolution = await resolvePageContext(student, { courseId: "c1", materialId: null });
    expect(resolution).toMatchObject({ kind: "resolved", canView: false });
    expect(materialSourceAvailable(availability, resolution)).toBe(false);
  });

  it("a student in an unpublished course gets no material", async () => {
    setCourse(accessLevelFor("student"), { isPublished: false });
    const resolution = await resolvePageContext(student, { courseId: "c1", materialId: null });
    expect(materialSourceAvailable(availability, resolution)).toBe(false);
  });

  it("a student gets no material when students.canViewMaterials is off", async () => {
    setCourse(accessLevelFor("student"));
    policyMock.getPolicy.mockResolvedValue(false);
    const resolution = await resolvePageContext(student, { courseId: "c1", materialId: null });
    expect(materialSourceAvailable(availability, resolution)).toBe(false);
  });

  it("a course opted out of AI contributes no material", async () => {
    setCourse(accessLevelFor("student"));
    prismaMock.course.findUnique.mockResolvedValue({
      code: "CS101",
      name: "Intro to CS",
      aiAssistantEnabled: false,
    });
    const resolution = await resolvePageContext(student, { courseId: "c1", materialId: null });
    expect(materialSourceAvailable(availability, resolution)).toBe(false);
  });

  it("a hidden material reports nothing to a student — the hint does not widen access", async () => {
    setCourse(accessLevelFor("student"));
    prismaMock.courseMaterial.findFirst
      .mockResolvedValueOnce(null) // gated read
      .mockResolvedValueOnce({ id: "m1" }); // existence check
    const resolution = await resolvePageContext(student, { courseId: "c1", materialId: "m1" });
    expect(resolution).toMatchObject({ kind: "resolved", canView: false, material: null });
    expect(materialSourceAvailable(availability, resolution)).toBe(false);
  });

  it("a material that does not exist fails closed as missing", async () => {
    setCourse(accessLevelFor("student"));
    prismaMock.courseMaterial.findFirst.mockResolvedValue(null);
    await expect(
      resolvePageContext(student, { courseId: "c1", materialId: "ghost" }),
    ).resolves.toEqual({ kind: "missing" });
  });

  it("applies the student visibility gate when reading the material", async () => {
    setCourse(accessLevelFor("student"));
    prismaMock.courseMaterial.findFirst.mockResolvedValue(MATERIAL_ROW);
    await resolvePageContext(student, { courseId: "c1", materialId: "m1" });
    const where = prismaMock.courseMaterial.findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({
      id: "m1",
      courseId: "c1",
      visibleToStudents: true,
      unpublishedAt: null,
    });
  });
});

describe("the built context", () => {
  it("contains the title and preview text and none of the row's secret-bearing fields", async () => {
    setCourse(accessLevelFor("student"));
    prismaMock.courseMaterial.findFirst.mockResolvedValue(MATERIAL_ROW);
    const resolution = await resolvePageContext(student, { courseId: "c1", materialId: "m1" });
    if (resolution.kind !== "resolved") throw new Error("expected a resolved context");
    const context = await buildMaterialContext({ resolution, query: "what is recursion" });

    expect(context.status).toBe("ok");
    const block = context.status === "ok" ? context.block : "";
    expect(block).toContain("Week 1 — Recursion");
    expect(block).toContain("Base cases stop it.");
    for (const secret of [
      MATERIAL_ROW.checksum,
      MATERIAL_ROW.uploadedBy,
      MATERIAL_ROW.externalId,
      MATERIAL_ROW.uploader.email,
      String(MATERIAL_ROW.fileSize),
    ]) {
      expect(block).not.toContain(secret);
    }
  });

  it("projects only the preview excerpt and marks a cut one", () => {
    const block = projectMaterialBlock({ title: "Long", rawText: "x".repeat(10_000) });
    expect(block.length).toBeLessThan(4_200);
    expect(block).toContain("[truncated]");
  });

  it("a course-level question uses the student-filtered course retrieval", async () => {
    setCourse(accessLevelFor("student"));
    embeddingMock.findRelevantContent.mockResolvedValue([
      { content: "Lists are ordered.", similarity: 0.8, materialTitle: "Week 2" },
    ]);
    const resolution = await resolvePageContext(student, { courseId: "c1", materialId: null });
    if (resolution.kind !== "resolved") throw new Error("expected a resolved context");
    const context = await buildMaterialContext({ resolution, query: "lists" });
    expect(context.status).toBe("ok");
    // restrictToStudentVisible is the fifth argument.
    expect(embeddingMock.findRelevantContent.mock.calls[0][4]).toBe(true);
  });

  it("never throws: an unreadable material degrades to 'failed'", async () => {
    setCourse(accessLevelFor("student"));
    embeddingMock.findRelevantContent.mockRejectedValue(new Error("vector dimension mismatch"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const resolution = await resolvePageContext(student, { courseId: "c1", materialId: null });
    if (resolution.kind !== "resolved") throw new Error("expected a resolved context");
    await expect(buildMaterialContext({ resolution, query: "q" })).resolves.toMatchObject({
      status: "failed",
    });
  });
});
