// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "~/lib/prisma.server";
import { cleanupRbac, seedCourse } from "../helpers/rbac";

let courseId: string;

beforeAll(async () => {
  const course = await seedCourse({ name: "Material chunk FTS integration" });
  courseId = course.id;
});

afterAll(async () => {
  await cleanupRbac({ courseIds: [courseId] });
  await prisma.$disconnect();
});

describe("material_chunks full-text search (#941)", () => {
  it("provisions a stored generated tsvector column and GIN index", async () => {
    const columns = await prisma.$queryRaw<
      Array<{ is_generated: string; generation_expression: string | null }>
    >`
      SELECT is_generated, generation_expression
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'material_chunks'
        AND column_name = 'content_tsv'
    `;
    expect(columns).toHaveLength(1);
    expect(columns[0]?.is_generated).toBe("ALWAYS");
    expect(columns[0]?.generation_expression).toContain("to_tsvector");

    const indexes = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = current_schema()
        AND tablename = 'material_chunks'
        AND indexname = 'material_chunks_content_tsv_idx'
    `;
    expect(indexes[0]?.indexdef).toContain("USING gin");
  });

  it("updates content_tsv automatically and supports indexed @@ lookup", async () => {
    const material = await prisma.courseMaterial.create({
      data: {
        courseId,
        title: "Graph algorithms",
        mimeType: "text/plain",
        fileSize: 64,
        checksum: `fts-${Date.now()}`,
        rawText: "Breadth first search",
        status: "READY",
      },
    });
    const chunkId = `fts-${Date.now()}`;
    await prisma.$executeRaw`
      INSERT INTO material_chunks (id, "materialId", index, content, "createdAt")
      VALUES (${chunkId}, ${material.id}, 0, ${"Assignment four covers breadth first search."}, NOW())
    `;
    const chunk = await prisma.materialChunk.findUniqueOrThrow({ where: { id: chunkId } });

    const matches = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM material_chunks
      WHERE content_tsv @@ plainto_tsquery('english', 'breadth search')
        AND id = ${chunk.id}
    `;
    expect(matches).toEqual([{ id: chunk.id }]);

    const plan = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
      return tx.$queryRaw<Array<{ "QUERY PLAN": unknown }>>`
        EXPLAIN (FORMAT JSON)
        SELECT id
        FROM material_chunks
        WHERE content_tsv @@ plainto_tsquery('english', 'breadth search')
      `;
    });
    expect(JSON.stringify(plan)).toContain("material_chunks_content_tsv_idx");
  });
});
