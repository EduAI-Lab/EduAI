// @vitest-environment node
//
// #1963: what a student's course chat may say about where an answer came from.
// Real Postgres + pgvector; only the embedding provider call is mocked, with one
// fixed vector for the seeded chunk and every query (similarity is always 1).

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import prisma from "~/lib/prisma.server";

const FIXED_EMBEDDING = vi.hoisted(() => Array.from({ length: 1024 }, (_, i) => (i + 1) * 0.0001));

vi.mock("ai", () => ({
  embed: vi.fn().mockResolvedValue({ embedding: FIXED_EMBEDDING }),
  embedMany: vi.fn(),
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: vi.fn(() => ({ embedding: vi.fn(() => ({})) })),
}));
vi.mock("@ai-sdk/google", () => ({ createGoogleGenerativeAI: vi.fn() }));
vi.mock("ollama-ai-provider", () => ({ createOllama: vi.fn() }));

import { findRelevantContent } from "~/lib/ai/embedding";
import { seedCourse, cleanupRbac } from "../helpers/rbac";
import { seedMaterial, seedMaterialChunkWithEmbedding } from "../helpers/materials";
import { seedTestDisciplines } from "../helpers/disciplines";

const seededCourseIds: string[] = [];
const ORIGINAL_ENV = {
  EMBEDDING_PROVIDER: process.env.EMBEDDING_PROVIDER,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL,
  EMBEDDING_DIMENSION: process.env.EMBEDDING_DIMENSION,
  RAG_HYBRID_BM25: process.env.RAG_HYBRID_BM25,
};

beforeAll(async () => {
  await seedTestDisciplines();
  process.env.EMBEDDING_PROVIDER = "cloud";
  process.env.OPENAI_API_KEY = "test-key";
  process.env.EMBEDDING_DIMENSION = "1024";
  delete process.env.OLLAMA_BASE_URL;
});

afterAll(async () => {
  await prisma.courseTopic.deleteMany({ where: { courseId: { in: seededCourseIds } } });
  await prisma.courseMaterial.deleteMany({ where: { courseId: { in: seededCourseIds } } });
  await cleanupRbac({ courseIds: seededCourseIds });
  await prisma.$disconnect();
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  delete process.env.RAG_HYBRID_BM25;
});

async function seedCourseWithChunk(title: string) {
  const course = await seedCourse({ isPublished: true, department: "COSC" });
  seededCourseIds.push(course.id);
  const material = await seedMaterial({ courseId: course.id, title });
  await seedMaterialChunkWithEmbedding(material.id, FIXED_EMBEDDING, `chunk of ${title}`);
  return { course, material };
}

describe("findRelevantContent names the material each hit came from (#1963)", () => {
  it.each([
    ["vector", ""],
    ["hybrid BM25", "1"],
  ])("on the %s path", async (_path, hybrid) => {
    process.env.RAG_HYBRID_BM25 = hybrid;
    const { course, material } = await seedCourseWithChunk(`Lecture ${hybrid || "v"}.pdf`);

    const hits = await findRelevantContent(`chunk of Lecture ${hybrid || "v"}.pdf`, course.id, 4);

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ materialId: material.id, materialTitle: material.title });
  });
});
