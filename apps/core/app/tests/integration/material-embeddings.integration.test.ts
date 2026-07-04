// @vitest-environment node
//
// Integration test for material_embeddings vector insert via processMaterialEmbeddings (#54).
// Uses real Postgres + pgvector; mocks only the remote embed API.

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";

const EMBEDDING_DIMENSION = 1024;

function makeEmbedding(seed: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSION }, (_, i) => (seed + i) * 0.0001);
}

const embedMany = vi.fn(async ({ values }: { values: string[] }) => ({
  embeddings: values.map((_, index) => makeEmbedding(index + 1)),
}));

vi.mock("ai", () => ({
  embed: vi.fn(),
  embedMany: (...args: unknown[]) => embedMany(...(args as [Parameters<typeof embedMany>[0]])),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => ({
    embedding: vi.fn(() => ({})),
  })),
}));
vi.mock("@ai-sdk/google", () => ({ createGoogleGenerativeAI: vi.fn() }));
vi.mock("ollama-ai-provider", () => ({ createOllama: vi.fn() }));

import prisma from "~/lib/prisma.server";
import { processMaterialEmbeddings } from "~/lib/ai/embedding";
import { generateChecksum } from "~/lib/ai/file-processing";
import { cleanupRbac, seedCourse } from "../helpers/rbac";

let courseId: string;

beforeAll(async () => {
  const course = await seedCourse({ name: "Vector insert integration" });
  courseId = course.id;
});

afterAll(async () => {
  await cleanupRbac({ courseIds: [courseId] });
  await prisma.$disconnect();
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.EMBEDDING_PROVIDER = "cloud";
  process.env.OPENAI_API_KEY = "test-key";
  process.env.EMBEDDING_DIMENSION = String(EMBEDDING_DIMENSION);
});

describe("processMaterialEmbeddings vector insert (#54)", () => {
  it("persists one embedding row per chunk via $executeRaw", async () => {
    const content =
      "Chapter one covers binary trees and graph traversal. ".repeat(20) +
      "\n\n" +
      "Chapter two covers dynamic programming and memoization. ".repeat(20);

    const material = await prisma.courseMaterial.create({
      data: {
        courseId,
        title: `vector-insert-${Date.now()}`,
        mimeType: "text/plain",
        fileSize: content.length,
        checksum: generateChecksum(content),
        rawText: content,
        status: "PROCESSING",
      },
    });

    await processMaterialEmbeddings(material.id, content);

    const chunkCount = await prisma.materialChunk.count({ where: { materialId: material.id } });
    const embeddingRows = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT count(*)::int AS count
      FROM material_embeddings me
      JOIN material_chunks mc ON me."chunkId" = mc.id
      WHERE mc."materialId" = ${material.id}
    `;
    const embeddingCount = embeddingRows[0]?.count ?? 0;

    expect(chunkCount).toBeGreaterThan(0);
    expect(embeddingCount).toBe(chunkCount);
    expect(embedMany).toHaveBeenCalled();
  });
});
