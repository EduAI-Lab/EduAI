/**
 * Re-embed all course materials for a course (after dimension / provider change).
 * Run from apps/core:
 *   npm run re-embed:course -- --list
 *   npm run re-embed:course -- <courseId-or-code>
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

async function listCourses(): Promise<void> {
  const courses = await prisma.course.findMany({
    orderBy: { code: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      _count: { select: { materials: true } },
    },
  });

  if (courses.length === 0) {
    console.log("No courses in the database.");
    return;
  }

  console.log("Courses (use id or code with re-embed:course):\n");
  for (const c of courses) {
    console.log(`  ${c.code.padEnd(16)}  ${c.name}  (${c._count.materials} materials)`);
    console.log(`    id: ${c.id}`);
  }
}

async function resolveCourse(ref: string) {
  const byId = await prisma.course.findUnique({
    where: { id: ref },
    select: { id: true, code: true, name: true },
  });
  if (byId) return byId;

  // `code` is not unique on its own (see @@unique([code, startDate, section])),
  // so resolve the first course matching the code.
  const byCode = await prisma.course.findFirst({
    where: { code: ref },
    select: { id: true, code: true, name: true },
  });
  if (byCode) return byCode;

  const needle = ref.toLowerCase();
  const suggestions = await prisma.course.findMany({
    where: {
      OR: [
        { code: { contains: ref, mode: "insensitive" } },
        { name: { contains: ref, mode: "insensitive" } },
      ],
    },
    orderBy: { code: "asc" },
    take: 10,
    select: { id: true, code: true, name: true },
  });

  return { notFound: true as const, ref, suggestions };
}

async function main() {
  loadEnvFile();

  const arg = process.argv[2]?.trim();
  if (!arg || arg === "--list" || arg === "-l") {
    if (!arg) {
      console.error("Usage:");
      console.error("  npm run re-embed:course -- --list");
      console.error("  npm run re-embed:course -- <courseId-or-code>");
      process.exit(1);
    }
    await listCourses();
    return;
  }

  const resolved = await resolveCourse(arg);

  if ("notFound" in resolved) {
    console.error(`Course not found: ${resolved.ref}`);
    console.error("(Lookup accepts the internal id or exact course code, e.g. COSC 111 — not a partial nickname.)");
    if (resolved.suggestions.length > 0) {
      console.error("\nDid you mean one of these?");
      for (const c of resolved.suggestions) {
        console.error(`  ${c.code} — ${c.name}`);
        console.error(`    npm run re-embed:course -- ${JSON.stringify(c.code)}`);
      }
    } else {
      console.error("\nRun `npm run re-embed:course -- --list` to see all courses.");
    }
    process.exit(1);
  }

  const course = resolved;

  console.log("[re-embed] starting", {
    courseId: course.id,
    code: course.code,
    title: course.name,
    provider: process.env.EMBEDDING_PROVIDER ?? "cloud",
    dimension: process.env.EMBEDDING_DIMENSION ?? "1024",
  });

  const result = await reEmbedCourseMaterials(course.id);
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
