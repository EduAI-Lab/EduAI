// @vitest-environment node
// #1998: automatic matching records how it filed each material, so the UI can
// label the link ("Matched by name", "AI · 70%") until a person confirms it.
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  topicFindMany: vi.fn(),
  materialFindMany: vi.fn(),
  sourceFindMany: vi.fn(),
  materialFindUnique: vi.fn(),
  upsert: vi.fn(),
  canvasNames: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => {
  const tx = {
    courseMaterial: { findUnique: db.materialFindUnique },
    courseTopicSource: { findMany: db.sourceFindMany, upsert: db.upsert },
  };
  return {
    default: {
      courseTopic: { findMany: db.topicFindMany },
      courseMaterial: { findMany: db.materialFindMany },
      courseTopicSource: { findMany: db.sourceFindMany },
      $transaction: (fn: (client: typeof tx) => Promise<boolean>) => fn(tx),
    },
  };
});
vi.mock("~/lib/topics/canvas-module-names.server", () => ({
  canvasModuleNamesByMaterial: db.canvasNames,
}));

import { matchMaterialsToTopics } from "~/lib/topics/auto-match.server";

const material = (id: string) => ({
  id,
  title: `${id}.pdf`,
  rawText: "Some lecture text",
  externalId: null,
  externalSource: null,
  processedAt: new Date("2026-10-01"),
});

beforeEach(() => {
  vi.clearAllMocks();
  db.topicFindMany.mockResolvedValue([
    { id: "t-loops", name: "Loops" },
    { id: "t-arrays", name: "Arrays" },
  ]);
  db.sourceFindMany.mockResolvedValue([]);
  db.materialFindUnique.mockResolvedValue({ topicsSetManuallyAt: null });
  db.upsert.mockResolvedValue({});
  db.canvasNames.mockResolvedValue(new Map());
});

function run(runCompletion = vi.fn(async () => null as string | null)) {
  return matchMaterialsToTopics({
    courseId: "c1",
    materialIds: ["m1"],
    userId: "u1",
    runCompletion,
  });
}

describe("matchMaterialsToTopics provenance (#1998)", () => {
  it("records a name match with no confidence and no model call", async () => {
    db.materialFindMany.mockResolvedValue([material("m1")]);
    db.canvasNames.mockResolvedValue(new Map([["m1", ["loops"]]]));
    const runCompletion = vi.fn(async () => null as string | null);

    await expect(run(runCompletion)).resolves.toEqual({ matched: 1, unmatched: 0 });

    expect(runCompletion).not.toHaveBeenCalled();
    expect(db.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          topicId: "t-loops",
          matchedBy: "NAME",
          matchConfidence: null,
        }),
      }),
    );
  });

  it("records an AI match with the model's confidence", async () => {
    db.materialFindMany.mockResolvedValue([material("m1")]);
    await run(vi.fn(async () => '{"match": "Arrays", "confidence": 70}'));
    expect(db.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          topicId: "t-arrays",
          matchedBy: "AI",
          matchConfidence: 70,
        }),
        update: expect.objectContaining({ matchedBy: "AI", matchConfidence: 70 }),
      }),
    );
  });

  it("records an AI match without a confidence when the model gives none", async () => {
    db.materialFindMany.mockResolvedValue([material("m1")]);
    await run(vi.fn(async () => '{"match": "Arrays"}'));
    expect(db.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ matchedBy: "AI", matchConfidence: null }),
      }),
    );
  });

  it("writes nothing when the model picks no topic or an unlisted one", async () => {
    db.materialFindMany.mockResolvedValue([material("m1")]);
    await expect(
      run(vi.fn(async () => '{"match": "Pointers", "confidence": 90}')),
    ).resolves.toEqual({
      matched: 0,
      unmatched: 1,
    });
    expect(db.upsert).not.toHaveBeenCalled();
  });
});
