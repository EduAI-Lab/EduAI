import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const prismaMock = vi.hoisted(() => ({
  courseMaterial: { findMany: vi.fn() },
  // update/delete are stubbed even though provisioning must never reach them —
  // that is exactly what the "only ever creates" test asserts, and it can only
  // assert it if calling them would have worked.
  courseTopic: {
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

const listCanvasCourseModules = vi.hoisted(() => vi.fn());
const requireCanvasCredentials = vi.hoisted(() => vi.fn());

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));
vi.mock("~/lib/canvas/client.server", () => ({ listCanvasCourseModules }));
vi.mock("~/lib/canvas/courses.server", () => ({ requireCanvasCredentials }));

const { provisionCourseTopics } = await import("~/lib/topics/provision.server");

const CREDENTIALS = { canvasUrl: "https://canvas.test", apiKey: "k", isTestMode: false };

type MaterialRow = {
  id: string;
  title: string;
  rawText: string | null;
  externalId: string | null;
  externalSource: string | null;
};

function material(overrides: Partial<MaterialRow> = {}): MaterialRow {
  return {
    id: "m1",
    title: "Week 1",
    rawText: null,
    externalId: null,
    externalSource: null,
    ...overrides,
  };
}

type ProvisionArgs = Parameters<typeof provisionCourseTopics>[0];

function baseArgs(overrides: Partial<ProvisionArgs> = {}): ProvisionArgs {
  return {
    courseId: "course-1",
    materialIds: ["m1"],
    canvasCourseId: null,
    userId: "user-1",
    jobId: "job-1",
    runCompletion: vi.fn(async () => null),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.courseTopic.findMany.mockResolvedValue([]);
  prismaMock.courseTopic.create.mockImplementation(
    async ({ data }: { data: { name: string } }) => ({
      name: data.name,
    }),
  );
  requireCanvasCredentials.mockResolvedValue(CREDENTIALS);
});

describe("provisionCourseTopics — source precedence", () => {
  it("prefers Canvas modules over headings in the same material", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue([
      material({ rawText: "Chapter 1 — From The File", externalSource: "canvas", externalId: "9" }),
    ]);
    listCanvasCourseModules.mockResolvedValue([{ id: 1, name: "Week 1 — From Canvas" }]);

    const result = await provisionCourseTopics(baseArgs({ canvasCourseId: "77" }));

    expect(result.usedSource).toBe("canvas-modules");
    expect(result.createdNames).toEqual(["Week 1 — From Canvas"]);
  });

  it("falls back to headings when the course has no Canvas modules", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue([
      material({ rawText: "Chapter 1 — Recursion" }),
    ]);
    listCanvasCourseModules.mockResolvedValue([]);

    const result = await provisionCourseTopics(baseArgs({ canvasCourseId: "77" }));

    expect(result.usedSource).toBe("material-headings");
    expect(result.createdNames).toEqual(["Chapter 1 — Recursion"]);
  });

  it("only asks a model once both deterministic sources come up empty", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue([
      material({ rawText: "unstructured prose with no headings at all" }),
    ]);
    const runCompletion = vi.fn(async () => '{"topics":["Recursion"]}');

    const result = await provisionCourseTopics(baseArgs({ runCompletion }));

    expect(runCompletion).toHaveBeenCalledTimes(1);
    expect(result.usedSource).toBe("ai");
    expect(result.createdNames).toEqual(["Recursion"]);
  });

  it("never calls a model when headings were found", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue([
      material({ rawText: "Chapter 1 — Recursion" }),
    ]);
    const runCompletion = vi.fn(async () => '{"topics":["Hallucinated"]}');

    await provisionCourseTopics(baseArgs({ runCompletion }));

    expect(runCompletion).not.toHaveBeenCalled();
  });

  it("skips Canvas entirely for a course that is not Canvas linked", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue([
      material({ rawText: "Chapter 1 — Recursion" }),
    ]);

    await provisionCourseTopics(baseArgs({ canvasCourseId: null }));

    expect(listCanvasCourseModules).not.toHaveBeenCalled();
  });
});

describe("provisionCourseTopics — resilience", () => {
  it("falls through to headings when the Canvas call fails", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue([
      material({ rawText: "Chapter 1 — Recursion" }),
    ]);
    listCanvasCourseModules.mockRejectedValue(new Error("Canvas 503"));

    const result = await provisionCourseTopics(baseArgs({ canvasCourseId: "77" }));

    expect(result.usedSource).toBe("material-headings");
    expect(result.created).toBe(1);
  });

  it("reports no source when nothing yields a candidate", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue([material({ rawText: "   " })]);

    const result = await provisionCourseTopics(baseArgs());

    expect(result).toMatchObject({ created: 0, usedSource: "none" });
    expect(prismaMock.courseTopic.create).not.toHaveBeenCalled();
  });

  it("keeps going when one create loses the unique-name race", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue([
      material({ rawText: "Chapter 1 — A\nChapter 2 — B" }),
    ]);
    prismaMock.courseTopic.create
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "test" }),
      )
      .mockResolvedValueOnce({ name: "Chapter 2 — B" });

    const result = await provisionCourseTopics(baseArgs());

    expect(result.createdNames).toEqual(["Chapter 2 — B"]);
  });
});

describe("provisionCourseTopics — never touches existing topics", () => {
  it("skips a candidate the course already has, whatever its punctuation", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue([
      material({ rawText: "Chapter 1 — Recursion\nChapter 2 — Trees" }),
    ]);
    prismaMock.courseTopic.findMany.mockResolvedValue([{ name: "chapter 1: recursion" }]);

    const result = await provisionCourseTopics(baseArgs());

    expect(result.createdNames).toEqual(["Chapter 2 — Trees"]);
    expect(result.duplicatesSkipped).toBe(1);
  });

  it("reads soft-deleted topics too, so a dismissal is not undone", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue([
      material({ rawText: "Chapter 1 — Recursion" }),
    ]);
    prismaMock.courseTopic.findMany.mockResolvedValue([{ name: "Chapter 1 — Recursion" }]);

    const result = await provisionCourseTopics(baseArgs());

    expect(result.created).toBe(0);
    // The existence query must not filter deletedAt — a dismissed suggestion is
    // a soft delete, and filtering it out would recreate it every resync.
    const where = prismaMock.courseTopic.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ courseId: "course-1" });
  });

  it("only ever creates — no update or delete of an existing row", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue([
      material({ rawText: "Chapter 1 — Recursion" }),
    ]);

    await provisionCourseTopics(baseArgs());

    expect(prismaMock.courseTopic.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.courseTopic.update).not.toHaveBeenCalled();
    expect(prismaMock.courseTopic.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.courseTopic.delete).not.toHaveBeenCalled();
    expect(prismaMock.courseTopic.deleteMany).not.toHaveBeenCalled();
  });

  it("marks everything it creates as an unreviewed suggestion with provenance", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue([
      material({ rawText: "Chapter 1 — Recursion" }),
    ]);

    await provisionCourseTopics(baseArgs());

    expect(prismaMock.courseTopic.create.mock.calls[0][0].data).toMatchObject({
      courseId: "course-1",
      origin: "MATERIAL_HEADING",
      reviewStatus: "SUGGESTED",
      confidence: 0.8,
      generatedByJobId: "job-1",
      createdBy: null,
    });
  });

  it("records the source materials a topic was derived from", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue([
      material({ id: "mat-7", rawText: "Chapter 1 — Recursion" }),
    ]);

    await provisionCourseTopics(baseArgs({ materialIds: ["mat-7"] }));

    expect(prismaMock.courseTopic.create.mock.calls[0][0].data.sources).toEqual({
      create: [{ materialId: "mat-7" }],
    });
  });

  it("only reads materials that finished processing", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue([]);

    await provisionCourseTopics(baseArgs());

    expect(prismaMock.courseMaterial.findMany.mock.calls[0][0].where).toMatchObject({
      status: "READY",
      deletedAt: null,
    });
  });
});

describe("provisionCourseTopics — AI provenance", () => {
  /** Prose with no Chapter/Unit/Week heading, so the AI path is the one reached. */
  function unstructuredCorpus(count: number) {
    return Array.from({ length: count }, (_, index) =>
      material({
        id: `mat-${index}`,
        title: `Reading ${index}`,
        rawText: `Body text for reading ${index}.`,
      }),
    );
  }

  /**
   * The prompt only ever shows the model a bounded sample of the corpus. The
   * sample used to be taken inside prompt building while provenance was recorded
   * over every nonblank material, so `CourseTopicSource` claimed the ninth
   * material onwards as the source of names derived from the first eight.
   */
  it("attributes AI topics only to the materials the model was shown", async () => {
    const materials = unstructuredCorpus(12);
    prismaMock.courseMaterial.findMany.mockResolvedValue(materials);
    const runCompletion = vi.fn(async (_args: { systemPrompt: string; prompt: string }) =>
      JSON.stringify({ topics: ["Recursion"] }),
    );

    await provisionCourseTopics(
      baseArgs({ materialIds: materials.map((m) => m.id), runCompletion }),
    );

    const { sources } = prismaMock.courseTopic.create.mock.calls[0][0].data;
    expect(sources.create).toEqual(
      Array.from({ length: 8 }, (_, index) => ({ materialId: `mat-${index}` })),
    );
    expect(sources.create).not.toContainEqual({ materialId: "mat-8" });
  });

  it("shows the model the same materials it attributes the topic to", async () => {
    const materials = unstructuredCorpus(12);
    prismaMock.courseMaterial.findMany.mockResolvedValue(materials);
    const runCompletion = vi.fn(async (_args: { systemPrompt: string; prompt: string }) =>
      JSON.stringify({ topics: ["Recursion"] }),
    );

    await provisionCourseTopics(
      baseArgs({ materialIds: materials.map((m) => m.id), runCompletion }),
    );

    const { prompt } = runCompletion.mock.calls[0][0];
    expect(prompt).toContain("Reading 7");
    expect(prompt).not.toContain("Reading 8");
  });

  it("propagates a provider failure so the job is recorded as failed", async () => {
    prismaMock.courseMaterial.findMany.mockResolvedValue(unstructuredCorpus(1));
    const runCompletion = vi.fn(async () => {
      throw new Error("provider unreachable");
    });

    await expect(
      provisionCourseTopics(baseArgs({ materialIds: ["mat-0"], runCompletion })),
    ).rejects.toThrow("provider unreachable");
  });
});
