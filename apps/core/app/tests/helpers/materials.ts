/**
 * Course-material seeding helpers for integration tests, extending
 * helpers/rbac.ts (users/courses/enrollments) with the material-level rows
 * needed by both the REST material read gate and the RAG retrieval paths.
 *
 * `seedMaterialChunkWithEmbedding` inserts a real `material_embeddings` vector
 * row without going through an embedding provider — pass the same fixed
 * vector as the mocked query embedding so retrieval tests can assert on the
 * SQL visibility gate alone, independent of similarity ranking.
 */
import { randomUUID } from "node:crypto";
import prisma from "~/lib/prisma.server";
import { formatPgVectorLiteral } from "~/lib/ai/pgvector";

export type SeedMaterialOpts = {
  courseId: string;
  visibleToStudents?: boolean;
  availableAt?: Date | null;
  deletedAt?: Date | null;
  unpublishedAt?: Date | null;
  title?: string;
};

export async function seedMaterial(opts: SeedMaterialOpts) {
  const suffix = randomUUID().slice(0, 8);
  return prisma.courseMaterial.create({
    data: {
      courseId: opts.courseId,
      title: opts.title ?? `Material ${suffix}`,
      mimeType: "text/plain",
      fileSize: 42,
      checksum: `checksum-${suffix}`,
      rawText: "seeded material content",
      status: "READY",
      visibleToStudents: opts.visibleToStudents ?? true,
      availableAt: opts.availableAt ?? null,
      deletedAt: opts.deletedAt ?? null,
      unpublishedAt: opts.unpublishedAt ?? null,
    },
  });
}

export async function seedMaterialChunkWithEmbedding(
  materialId: string,
  embedding: number[],
  content = "seeded chunk content",
) {
  const id = randomUUID();
  await prisma.$executeRaw`
    INSERT INTO material_chunks (id, "materialId", index, content, "createdAt")
    VALUES (${id}, ${materialId}, 0, ${content}, NOW())
  `;
  const chunk = await prisma.materialChunk.findUniqueOrThrow({ where: { id } });
  await prisma.$executeRaw`
    INSERT INTO material_embeddings (id, "chunkId", embedding, "createdAt")
    VALUES (${randomUUID()}, ${chunk.id}, ${formatPgVectorLiteral(embedding)}::vector, NOW())
  `;
  return chunk;
}
