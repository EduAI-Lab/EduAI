/**
 * Give every existing course at least one topic (#1624).
 *
 * New courses get the `Uncategorized` fallback from the paths that create them —
 * course creation, Canvas import, and the topic-analysis job. Courses that
 * already existed when that landed never ran any of those, so a course created
 * before this feature can still sit at zero topics and block Question Maker.
 * This is the one-time sweep for them.
 *
 * Idempotent: a course that already has a live topic is skipped, so re-running
 * is free and creates nothing.
 *
 * Run from apps/core:
 *   npm run db:backfill:topic-fallback -- --dry-run
 *   npm run db:backfill:topic-fallback
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

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

loadEnvFile();

// Imported after the env file is loaded so the Prisma client sees DATABASE_URL.
const prisma = (await import("../app/lib/prisma.server")).default;
const { ensureCourseHasTopic } = await import("../app/lib/topics/fallback.server");

const dryRun = process.argv.includes("--dry-run");

/** Courses read in pages so a large deployment does not load every row at once. */
const PAGE_SIZE = 500;

async function main(): Promise<void> {
  let cursor: string | undefined;
  let scanned = 0;
  let repaired = 0;

  for (;;) {
    // The cursor clause is added only once there is a cursor — the first page
    // has none, and Prisma rejects `cursor: undefined` alongside `skip: 1`.
    const page = {
      where: { deletedAt: null },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
      select: { id: true, code: true, name: true },
    } as const;
    const courses = await (cursor
      ? prisma.course.findMany({ ...page, cursor: { id: cursor }, skip: 1 })
      : prisma.course.findMany(page));
    if (courses.length === 0) break;

    for (const course of courses) {
      scanned += 1;

      const topic = await prisma.courseTopic.findFirst({
        where: { courseId: course.id, deletedAt: null },
        select: { id: true },
      });
      if (topic) continue;

      repaired += 1;
      if (dryRun) {
        console.log(`[topic-fallback] would repair ${course.code} — ${course.name}`);
        continue;
      }

      await ensureCourseHasTopic(course.id);
      console.log(`[topic-fallback] repaired ${course.code} — ${course.name}`);
    }

    cursor = courses[courses.length - 1].id;
  }

  console.log(
    `[topic-fallback] ${scanned} course(s) scanned, ${repaired} ${
      dryRun ? "would be repaired" : "repaired"
    }.`,
  );
}

try {
  await main();
} catch (error) {
  console.error("[topic-fallback] Backfill failed:", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
