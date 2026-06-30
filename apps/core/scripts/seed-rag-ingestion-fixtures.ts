/**
 * Seed RAG ingestion test fixtures into CHUNK433 and run retrieval smoke tests.
 * Usage: npx tsx scripts/seed-rag-ingestion-fixtures.ts
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, basename } from "node:path";
import prisma from "../app/lib/prisma.server";
import {
  enrichExtractedDocumentContent,
  generateChecksum,
  applySemanticChunking,
  applyChunkOverlap,
  enforceMaxChunkLength,
  joinSemanticChunks,
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
const FIXTURE_DIR = resolve(process.cwd(), "../../docs/rag-ai/fixtures");

const RETRIEVAL_TESTS = [
  { query: "What is UBCO-RAG-TEST-EQUATION-ALPHA? State Euler's identity.", expect: "e^{i" },
  { query: "What dose of Fictionalin is listed in the course materials?", expect: "200 mg" },
  { query: "Summarize the plan for TEST-PATIENT-ZEBRA.", expect: "Hydration" },
  { query: "What unique phrase appears on slide 1 of the slide test deck?", expect: "UBCO-RAG-TEST-SLIDE-GAMMA" },
];

async function upsertMaterial(courseId: string, title: string, content: string) {
  const existing = await prisma.courseMaterial.findFirst({
    where: { courseId, title },
  });

  if (existing) {
    await prisma.courseMaterial.update({
      where: { id: existing.id },
      data: {
        rawText: content,
        checksum: generateChecksum(content),
        fileSize: content.length,
        status: "PROCESSING",
        mimeType: "text/markdown",
      },
    });
    await processMaterialEmbeddings(existing.id, content, { replace: true });
    await prisma.courseMaterial.update({
      where: { id: existing.id },
      data: { status: "READY", processedAt: new Date() },
    });
    const chunkCount = await prisma.materialChunk.count({ where: { materialId: existing.id } });
    return { materialId: existing.id, chunkCount, replaced: true };
  }

  const material = await prisma.courseMaterial.create({
    data: {
      courseId,
      title,
      mimeType: "text/markdown",
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
  const chunkCount = await prisma.materialChunk.count({ where: { materialId: material.id } });
  return { materialId: material.id, chunkCount, replaced: false };
}

async function main() {
  loadEnvFile();

  const course = await prisma.course.findFirst({ where: { code: DEMO_CODE } });
  if (!course) throw new Error(`Course ${DEMO_CODE} not found`);

  if (!existsSync(FIXTURE_DIR)) {
    throw new Error(`Fixture dir missing: ${FIXTURE_DIR}`);
  }

  const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".md"));
  console.log(`\n=== Seeding ${files.length} fixtures into ${course.code} (${course.id}) ===\n`);

  for (const file of files) {
    const path = resolve(FIXTURE_DIR, file);
    const raw = readFileSync(path, "utf8");
    const enriched = enrichExtractedDocumentContent(raw);
    const maxChunkSize = 1500;
    const chunks = applySemanticChunking(enriched, maxChunkSize);
    const overlapped = enforceMaxChunkLength(
      applyChunkOverlap(chunks, DEFAULT_SEMANTIC_CHUNK_OVERLAP),
      maxChunkSize,
    );
    const content = joinSemanticChunks(overlapped);

    const title = basename(file, ".md");
    const result = await upsertMaterial(course.id, title, content);
    console.log(`${file}: ${result.chunkCount} chunks (id=${result.materialId})`);

    if (file.includes("tables")) {
      const hasPipeTable = content.includes("| Drug |");
      const hasHtml = content.includes("<table");
      console.log(`  table check: markdown=${hasPipeTable}, raw_html=${hasHtml}`);
    }
    if (file.includes("equations")) {
      const hasInline = content.includes("$e^{i");
      const intactDisplay = content.includes("$$");
      console.log(`  equation check: inline=${hasInline}, display=${intactDisplay}`);
    }
  }

  console.log("\n=== RAG retrieval smoke tests ===\n");
  let passed = 0;
  for (const test of RETRIEVAL_TESTS) {
    const hits = await findRelevantContent(test.query, course.id, 4);
    const combined = hits.map((h) => h.content).join("\n");
    const ok = combined.toLowerCase().includes(test.expect.toLowerCase());
    console.log(`${ok ? "PASS" : "FAIL"} | Q: ${test.query}`);
    console.log(`  expect: ${test.expect}`);
    if (hits.length === 0) {
      console.log("  (no hits)");
    } else {
      for (const hit of hits.slice(0, 2)) {
        console.log(`  sim=${hit.similarity.toFixed(3)} | ${hit.content.replace(/\s+/g, " ").slice(0, 120)}...`);
      }
    }
    console.log();
    if (ok) passed++;
  }

  console.log(`Results: ${passed}/${RETRIEVAL_TESTS.length} retrieval checks passed`);
  console.log(`Chat URL: https://dev.eduai.ok.ubc.ca/chat?courseId=${course.id}`);
  if (passed < RETRIEVAL_TESTS.length) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
