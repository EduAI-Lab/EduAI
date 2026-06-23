/**
 * Dev helper: seed demo course + material for #433 smarter chunking, then run RAG queries.
 * Usage: npx tsx scripts/dev-smart-chunking-demo.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import prisma from "../app/lib/prisma.server";
import {
  applySemanticChunking,
  applyChunkOverlap,
  joinSemanticChunks,
  generateChecksum,
  DEFAULT_SEMANTIC_CHUNK_OVERLAP,
} from "../app/lib/ai/file-processing";
import { findRelevantContent, processMaterialEmbeddings } from "../app/lib/ai/embedding";

function loadEnvFile() {
  const envPath = resolve(process.cwd(), ".env");
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

const DEMO_CODE = "CHUNK433";
const DEMO_NAME = "Smart Chunking Demo (#433)";
const FIXTURE = resolve(process.cwd(), "scripts/fixtures/smart-chunking-demo.txt");

const DEMO_QUERIES = [
  "When is Assignment 1 due?",
  "What is the late policy for Assignment 1?",
  "What topics are on Assignment 2?",
  "What are the rules for the midterm vs final?",
  "What is an AVL tree?",
];

async function ensureCourse(instructorId: string) {
  const existing = await prisma.course.findFirst({
    where: { code: DEMO_CODE },
  });
  if (existing) {
    const enrollment = await prisma.enrollment.findFirst({
      where: { courseId: existing.id, userId: instructorId },
    });
    if (!enrollment) {
      await prisma.enrollment.create({
        data: { userId: instructorId, courseId: existing.id, role: "INSTRUCTOR", isActive: true },
      });
    }
    return existing;
  }

  return prisma.$transaction(async (tx) => {
    const course = await tx.course.create({
      data: {
        name: DEMO_NAME,
        code: DEMO_CODE,
        section: "001",
        term: "Summer",
        year: 2026,
        startDate: new Date("2026-06-01"),
        endDate: new Date("2026-08-31"),
        department: "COSC",
        description: "Demo course for smarter chunking (#433)",
        isPublished: true,
        isActive: true,
        aiInstructions: "Answer from course materials only. Cite specific due dates and policies.",
      },
    });
    await tx.enrollment.create({
      data: { userId: instructorId, courseId: course.id, role: "INSTRUCTOR", isActive: true },
    });
    return course;
  });
}

async function seedMaterial(courseId: string) {
  const raw = readFileSync(FIXTURE, "utf8");
  const chunks = applySemanticChunking(raw, 1500);
  const overlapped = applyChunkOverlap(chunks, DEFAULT_SEMANTIC_CHUNK_OVERLAP);
  const content = joinSemanticChunks(overlapped);

  const existing = await prisma.courseMaterial.findFirst({
    where: { courseId, title: "smart-chunking-demo" },
  });

  if (existing) {
    await prisma.courseMaterial.update({
      where: { id: existing.id },
      data: { rawText: content, status: "PROCESSING", mimeType: "text/plain", fileSize: content.length },
    });
    await processMaterialEmbeddings(existing.id, content, { replace: true });
    await prisma.courseMaterial.update({
      where: { id: existing.id },
      data: { status: "READY", processedAt: new Date() },
    });
    const dbChunkCount = await prisma.materialChunk.count({ where: { materialId: existing.id } });
    if (dbChunkCount === 0) {
      throw new Error(`Embedding completed but material ${existing.id} has 0 chunks in the database`);
    }
    return { materialId: existing.id, chunkCount: dbChunkCount };
  }

  const material = await prisma.courseMaterial.create({
    data: {
      courseId,
      title: "smart-chunking-demo",
      mimeType: "text/plain",
      fileSize: content.length,
      checksum: generateChecksum(content),
      rawText: content,
      status: "PROCESSING",
    },
  });
  await processMaterialEmbeddings(material.id, content);
  await prisma.courseMaterial.update({
    where: { id: material.id },
    data: { status: "READY", processedAt: new Date() },
  });

  const dbChunkCount = await prisma.materialChunk.count({ where: { materialId: material.id } });
  if (dbChunkCount === 0) {
    throw new Error(`Embedding completed but material ${material.id} has 0 chunks in the database`);
  }

  return { materialId: material.id, chunkCount: dbChunkCount };
}

async function main() {
  loadEnvFile();

  const user =
    (await prisma.user.findFirst({ where: { email: { contains: "ssaada08", mode: "insensitive" } } })) ??
    (await prisma.user.findFirst({ where: { role: "INSTRUCTOR" } }));
  if (!user) throw new Error("No user found for enrollment");

  const course = await ensureCourse(user.id);
  const { materialId, chunkCount } = await seedMaterial(course.id);

  console.log("\n=== Smart Chunking Demo Ready ===");
  console.log(`Course:  ${course.code} (${course.name})`);
  console.log(`URL:     https://dev.eduai.ok.ubc.ca/courses/${course.id}`);
  console.log(`Material: smart-chunking-demo (${chunkCount} chunks, id=${materialId})`);
  console.log(`Enrolled: ${user.email} as INSTRUCTOR\n`);

  console.log("=== RAG retrieval smoke test ===\n");
  for (const query of DEMO_QUERIES) {
    const hits = await findRelevantContent(query, course.id, 3);
    console.log(`Q: ${query}`);
    if (hits.length === 0) {
      console.log("  (no hits above threshold)\n");
      continue;
    }
    for (const hit of hits) {
      const snippet = hit.content.replace(/\s+/g, " ").slice(0, 140);
      console.log(`  sim=${hit.similarity.toFixed(3)} | ${snippet}...`);
    }
    console.log();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
