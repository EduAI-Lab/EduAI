/**
 * Re-embed all course materials for a course (after dimension / provider change).
 * Run from apps/core: npm run re-embed:course -- <courseId>
 *
 * See docs/rag-ai/LOCAL-EMBEDDINGS.md
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { reEmbedCourseMaterials } from "../app/lib/ai/embedding";
import prisma from "../app/lib/prisma.server";

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

async function main() {
  loadEnvFile();

  const courseId = process.argv[2]?.trim();
  if (!courseId) {
    console.error("Usage: npm run re-embed:course -- <courseId>");
    process.exit(1);
  }

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true, code: true, name: true },
  });

  if (!course) {
    console.error(`Course not found: ${courseId}`);
    process.exit(1);
  }

  console.log("[re-embed] starting", {
    courseId: course.id,
    code: course.code,
    title: course.name,
    provider: process.env.EMBEDDING_PROVIDER ?? "cloud",
    dimension: process.env.EMBEDDING_DIMENSION ?? "1024",
  });

  const result = await reEmbedCourseMaterials(courseId);

  console.log("[re-embed] done", result);
  if (result.failed.length > 0) process.exit(1);
}

main()
  .catch((err) => {
    console.error("[re-embed] failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
