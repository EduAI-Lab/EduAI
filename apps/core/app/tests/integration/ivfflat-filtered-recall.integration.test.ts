// @vitest-environment node
//
// Filtered-recall regression test for the ivfflat ANN index on
// material_embeddings (#940).
//
// A reviewer reproduced 0 rows returned (vs. 4 via an exact scan) when a
// course filter is applied on top of an approximate nearest-neighbour scan:
// with `ivfflat.probes` low and a large "noise" table, the index can exhaust
// every probed list before it finds any row belonging to the small target
// course, so the post-filter LIMIT comes back short (or empty) even though
// exact search would have found the rows.
//
// This test seeds a skewed real Postgres+pgvector table — many chunks in an
// unrelated "noise" course clustered away from the query vector, plus a
// handful of chunks in a small target course clustered near it — and proves
// findRelevantContent() (the real function, not a SQL-shape assertion) still
// returns the target course's rows when RAG_IVFFLAT_PROBES is deliberately
// set to 1. The fix under test is `ivfflat.iterative_scan = relaxed_order` +
// a bounded `ivfflat.max_probes` (>= the index's `lists`), which lets
// pgvector keep expanding the scan until the filtered LIMIT is satisfied
// instead of returning short.

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";

const EMBEDDING_DIMENSION = 1024;

// Two maximally-different constant directions so the noise cluster and the
// target cluster land in different ivfflat lists.
const NOISE_DIRECTION = Array.from({ length: EMBEDDING_DIMENSION }, (_, i) => (i % 2 === 0 ? 1 : -1));
const TARGET_DIRECTION = Array.from({ length: EMBEDDING_DIMENSION }, (_, i) => (i % 2 === 0 ? -1 : 1));

// generateEmbedding() → embedWithConfiguredProvider() → embed() from "ai".
// Always resolve to the target direction: the test's query text is
// irrelevant, only the fixed query vector and the seeded corpus matter.
const embed = vi.fn(async (..._args: unknown[]) => ({ embedding: TARGET_DIRECTION }));

vi.mock("ai", () => ({
  embed: (...args: unknown[]) => embed(...args),
  embedMany: vi.fn(),
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => ({ embedding: vi.fn(() => ({})) })),
}));
vi.mock("@ai-sdk/google", () => ({ createGoogleGenerativeAI: vi.fn() }));
vi.mock("ollama-ai-provider", () => ({ createOllama: vi.fn() }));

import { Prisma } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import { findRelevantContent } from "~/lib/ai/embedding";
import { formatPgVectorLiteral } from "~/lib/ai/pgvector";
import { generateChecksum } from "~/lib/ai/file-processing";
import { cleanupRbac, seedCourse } from "../helpers/rbac";

// Large enough that a low, non-iterative probe count can plausibly miss the
// target course's cluster entirely (mirrors the reviewer's 10k-row repro at
// a scale that still runs in CI in a reasonable time).
const NOISE_ROW_COUNT = 4000;
const TARGET_ROW_COUNT = 4;

/** A near-unit vector pointing in a consistent "topic" direction, with small per-row jitter. */
function makeVector(direction: number[], jitterSeed: number): number[] {
  return direction.map((v, i) => v + Math.sin(jitterSeed + i) * 0.01);
}

let noiseCourseId: string;
let targetCourseId: string;

async function seedChunk(materialId: string, index: number, vector: number[]) {
  // #941: content_tsv is an Unsupported("tsvector") generated column on
  // MaterialChunk, so Prisma's client omits create() for this model — insert
  // via raw SQL instead (mirrors app/lib/ai/embedding.ts).
  const chunkId = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO material_chunks (id, "materialId", index, content, "createdAt")
    VALUES (${chunkId}, ${materialId}, ${index}, ${`chunk ${index} for material ${materialId}`}, NOW())
  `;
  const literal = formatPgVectorLiteral(vector);
  await prisma.$executeRaw`
    INSERT INTO material_embeddings (id, "chunkId", embedding, "createdAt")
    VALUES (${randomUUID()}, ${chunkId}, ${literal}::vector, NOW())
  `;
}

async function seedMaterial(courseId: string, title: string) {
  const content = `${title} content`;
  const material = await prisma.courseMaterial.create({
    data: {
      courseId,
      title,
      mimeType: "text/plain",
      fileSize: content.length,
      checksum: generateChecksum(content + randomUUID()),
      rawText: content,
      status: "READY",
    },
  });
  return material.id;
}

beforeAll(async () => {
  process.env.EMBEDDING_PROVIDER = "cloud";
  process.env.OPENAI_API_KEY = "test-key";
  process.env.EMBEDDING_DIMENSION = String(EMBEDDING_DIMENSION);

  const noiseCourse = await seedCourse({ name: "IVFFlat noise course" });
  const targetCourse = await seedCourse({ name: "IVFFlat target course" });
  noiseCourseId = noiseCourse.id;
  targetCourseId = targetCourse.id;

  // Bulk-insert the noise course's chunks/embeddings directly via SQL for
  // speed — this test is about retrieval, not the chunking/upload pipeline.
  // #941: content_tsv is an Unsupported("tsvector") generated column on
  // MaterialChunk, so Prisma's client omits createManyAndReturn() for this
  // model — generate ids client-side and insert both tables via raw SQL.
  const noiseMaterialId = await seedMaterial(noiseCourseId, "Noise material");
  const noiseChunkIds = Array.from({ length: NOISE_ROW_COUNT }, () => randomUUID());
  const BATCH = 500;
  for (let i = 0; i < noiseChunkIds.length; i += BATCH) {
    const batchIds = noiseChunkIds.slice(i, i + BATCH);
    const chunkValues = batchIds
      .map((id, j) => {
        const index = i + j;
        return `('${id}', '${noiseMaterialId}', ${index}, 'noise chunk ${index}', NOW())`;
      })
      .join(",\n");
    await prisma.$executeRawUnsafe(
      `INSERT INTO material_chunks (id, "materialId", index, content, "createdAt") VALUES ${chunkValues}`,
    );
    const embeddingValues = batchIds
      .map((id, j) => {
        const vec = formatPgVectorLiteral(makeVector(NOISE_DIRECTION, i + j));
        return `('${randomUUID()}', '${id}', '${vec}'::vector, NOW())`;
      })
      .join(",\n");
    await prisma.$executeRawUnsafe(
      `INSERT INTO material_embeddings (id, "chunkId", embedding, "createdAt") VALUES ${embeddingValues}`,
    );
  }

  // The small target course's chunks, clustered in the opposite direction —
  // this is what the mocked query embedding above matches.
  const targetMaterialId = await seedMaterial(targetCourseId, "Target material");
  for (let i = 0; i < TARGET_ROW_COUNT; i++) {
    await seedChunk(targetMaterialId, i, makeVector(TARGET_DIRECTION, i));
  }
}, 120_000);

afterAll(async () => {
  await cleanupRbac({ courseIds: [noiseCourseId, targetCourseId] });
  await prisma.$disconnect();
});

describe("findRelevantContent — filtered ANN recall with skewed course data (#940)", () => {
  it("returns the target course's rows via exact search (sanity check)", async () => {
    const literal = formatPgVectorLiteral(TARGET_DIRECTION);
    const rows = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count
      FROM material_embeddings me
      JOIN material_chunks mc ON me."chunkId" = mc.id
      JOIN course_materials cm ON mc."materialId" = cm.id
      WHERE cm."courseId" = ${targetCourseId}
        AND cm."deletedAt" IS NULL
        AND (1 - (me.embedding <=> ${literal}::vector)) > 0.5
    `;
    expect(rows[0]?.count).toBe(TARGET_ROW_COUNT);
  });

  it("still returns all target-course rows through findRelevantContent with probes=1 (relies on iterative scanning)", async () => {
    const previousProbes = process.env.RAG_IVFFLAT_PROBES;
    process.env.RAG_IVFFLAT_PROBES = "1";
    try {
      const results = await findRelevantContent(
        "irrelevant query text — the mocked embed() call always returns the target direction",
        targetCourseId,
        10,
        0.5,
      );
      expect(results).toHaveLength(TARGET_ROW_COUNT);
    } finally {
      if (previousProbes === undefined) delete process.env.RAG_IVFFLAT_PROBES;
      else process.env.RAG_IVFFLAT_PROBES = previousProbes;
    }
  });

  it("returns nothing for an unrelated course even with the same low-probes iterative scan settings", async () => {
    process.env.RAG_IVFFLAT_PROBES = "1";
    try {
      const results = await findRelevantContent(
        "irrelevant query text",
        noiseCourseId,
        10,
        0.5,
      );
      // The noise course's embeddings point the opposite direction from the
      // mocked query vector, so none should clear the similarity threshold —
      // proves the fix does not simply widen the result set indiscriminately.
      expect(results).toHaveLength(0);
    } finally {
      delete process.env.RAG_IVFFLAT_PROBES;
    }
  });
});
