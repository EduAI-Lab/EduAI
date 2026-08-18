/**
 * seed-perf.ts — Issue #961 AI-Tutor perf-baseline mutation POOL.
 *
 * ADDITIVE seed (run AFTER the main `npm run seed`) that creates a disposable,
 * tagged subtree so `scripts/perf-baseline.mjs` (repo root) can exercise EVERY
 * in-scope AI-Tutor mutation endpoint without touching demo data. Writes a
 * manifest (`<repoRoot>/.perf-pool/aitutor.json`) the perf script reads for ids
 * (Module/Lesson/Activity ids are autoincrement → not guessable).
 *
 * Key design points (from the endpoint spec):
 *  - The pool CourseOffering is a pure anchor row (#1072) keyed by the REAL Core
 *    perf course id read from `.perf-pool/core.json.sharedCourseId` — it holds no
 *    title/description/publish state (all resolved live from Core). The Core perf
 *    seed must run first; this seed fails fast if the manifest or `sharedCourseId`
 *    is missing.
 *  - Reseeding is idempotent: the Core seed mints a NEW Core course id on every
 *    run, so the previous anchor can never be found by `coreOfferingId` alone.
 *    Cleanup re-reads the previous `aitutor.json` manifest (validated via
 *    `perf-pool-manifest.js`) and drops the offering it recorded, so repeated
 *    runs never accumulate stale anchors.
 *  - Destructive endpoints (DELETE module/lesson/activity) consume victims → a
 *    perf run may deplete them; re-run this seed between runs.
 *
 * Usage:
 *   cd apps/extensions/ai-tutor/server && npx tsx prisma/seed-perf.ts
 *   PERF_POOL_SIZE=15 npx tsx prisma/seed-perf.ts
 */
import { PrismaClient } from "@eduai/ai-tutor-prisma-client";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { previousCourseId } from "./perf-pool-manifest.js";

const prisma = new PrismaClient();

const CORE_INSTRUCTOR = "seed_user_instructor_cs"; // mirrors apps/core SEED_IDS
const CORE_STUDENT = "seed_user_student_01";
const POOL = Number(process.env.PERF_POOL_SIZE ?? 15);
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

function poolDir(): string {
  if (process.env.PERF_POOL_DIR) return process.env.PERF_POOL_DIR;
  let d = process.cwd();
  for (let i = 0; i < 8; i++) {
    const pkg = path.join(d, "package.json");
    if (existsSync(pkg)) {
      try {
        const j = JSON.parse(readFileSync(pkg, "utf8"));
        if (j.workspaces) return path.join(d, ".perf-pool");
      } catch {
        /* ignore */
      }
    }
    d = path.dirname(d);
  }
  return path.join(process.cwd(), ".perf-pool");
}
function writeManifest(obj: unknown) {
  const dir = poolDir();
  mkdirSync(dir, { recursive: true });
  const f = path.join(dir, "aitutor.json");
  writeFileSync(f, JSON.stringify(obj, null, 2));
  console.log(`  ✓ wrote pool manifest → ${f}`);
}
// Loads the Core perf manifest once and returns the two fields the AI Tutor seed
// depends on. `sharedCourseId` is REQUIRED — the pool CourseOffering is a pure
// Core anchor, so a missing/unparseable manifest or an absent/empty
// `sharedCourseId` fails fast (the developer must run the Core perf seed first).
// `readChatId` stays optional to preserve the existing chat-session fallback.
function loadCoreManifest(): { sharedCourseId: string; readChatId: string | null } {
  const file = path.join(poolDir(), "core.json");
  let core: Record<string, unknown>;
  try {
    core = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    throw new Error(
      `Missing or unreadable Core perf manifest at ${file} — run the Core perf seed first (npm run db:seed:perf).`,
    );
  }
  const sharedCourseId = core.sharedCourseId;
  if (typeof sharedCourseId !== "string" || sharedCourseId.length === 0) {
    throw new Error(
      `Core perf manifest at ${file} has no valid sharedCourseId — run the Core perf seed first (npm run db:seed:perf).`,
    );
  }
  return {
    sharedCourseId,
    readChatId: typeof core.readChatId === "string" ? core.readChatId : null,
  };
}

// Reads the previous AI Tutor pool manifest, if any, and returns the local
// `CourseOffering.id` it recorded — or null when there is no manifest, the file
// is unreadable, or the manifest does not safely identify a prior pool. Shape
// validation lives in `previousCourseId` (perf-pool-manifest.js) so a corrupted
// or unexpected file can never name a real course for deletion.
function loadPreviousCourseId(): number | null {
  const file = path.join(poolDir(), "aitutor.json");
  if (!existsSync(file)) return null;
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    console.warn(`  ⚠ ignoring unreadable previous manifest at ${file}`);
    return null;
  }
  const id = previousCourseId(manifest);
  if (id === null) {
    console.warn(`  ⚠ ignoring malformed previous manifest at ${file} (no valid pool course id)`);
  }
  return id;
}

// Collect the local `CourseOffering` ids to drop before reseeding:
//  1. any offering already anchored to the NEW `sharedCourseId` (a partial re-run);
//  2. the offering recorded by the PREVIOUS manifest — the common case, since the
//     Core seed mints a fresh Core course id every run and the stale anchor still
//     points at the previous one (so matching by `coreOfferingId` alone misses it).
async function collectStalePoolIds(sharedCourseId: string): Promise<number[]> {
  const ids = new Set<number>();
  const current = await prisma.courseOffering.findMany({
    where: { coreOfferingId: sharedCourseId },
    select: { id: true },
  });
  for (const c of current) ids.add(c.id);

  const previousId = loadPreviousCourseId();
  if (previousId !== null) {
    const exists = await prisma.courseOffering.findUnique({
      where: { id: previousId },
      select: { id: true },
    });
    if (exists) ids.add(previousId);
    else console.warn(`  ⚠ previous pool offering ${previousId} no longer exists — skipping`);
  }
  return [...ids];
}

// Drop a set of pool offerings, respecting the delete order the schema demands:
// Activity.mainTopicId → Topic is Restrict (no onDelete) while Topic cascades
// from the course, so activities go first (cascading their chats/metrics), then
// the offering (cascading modules/lessons/topics/enrollments/instructors).
async function cleanupPool(ids: number[]) {
  if (!ids.length) return;
  await prisma.activity.deleteMany({
    where: { lesson: { module: { courseOfferingId: { in: ids } } } },
  });
  await prisma.courseOffering.deleteMany({ where: { id: { in: ids } } });
}

async function main() {
  console.log(`▶ ai-tutor perf pool: ${POOL} victims/endpoint`);
  // Load the Core manifest up front: the pool offering must anchor to the REAL
  // Core perf course (sharedCourseId) and the chat session reuses its readChatId.
  const { sharedCourseId, readChatId } = loadCoreManifest();
  // Idempotent reseed: drop the previous pool (from its manifest) plus any anchor
  // already pointing at the new Core course, then rebuild below.
  await cleanupPool(await collectStalePoolIds(sharedCourseId));

  // --- anchor course offering + instructor + topic ---
  const course = await prisma.courseOffering.create({
    data: { coreOfferingId: sharedCourseId },
  });
  await prisma.courseInstructor.create({
    data: { userId: CORE_INSTRUCTOR, courseOfferingId: course.id, role: "LEAD" },
  });
  const topic = await prisma.topic.create({
    data: { name: "PERF-POOL Topic", courseOfferingId: course.id },
  });

  // --- modules: reuse[2] (publish/unpublish) + drop[POOL] (DELETE) ---
  const newModule = (title: string, pos: number) =>
    prisma.module.create({ data: { title, position: pos, courseOfferingId: course.id } });
  const poolModulesReuse = [
    (await newModule("PERF-POOL Module Reuse 0", 0)).id,
    (await newModule("PERF-POOL Module Reuse 1", 1)).id,
  ];
  const poolModulesDrop: number[] = [];
  for (const i of range(POOL))
    poolModulesDrop.push((await newModule(`PERF-POOL Module DROP ${i}`, 10 + i)).id);

  // --- lessons under reuse module 0 ---
  const newLesson = (title: string, pos: number) =>
    prisma.lesson.create({ data: { title, position: pos, moduleId: poolModulesReuse[0] } });
  const poolLessonsReuse = [
    (await newLesson("PERF-POOL Lesson Reuse 0", 0)).id,
    (await newLesson("PERF-POOL Lesson Reuse 1", 1)).id,
  ];
  const poolLessonsDrop: number[] = [];
  for (const i of range(POOL))
    poolLessonsDrop.push((await newLesson(`PERF-POOL Lesson DROP ${i}`, 10 + i)).id);

  // --- activities under reuse lesson 0 (need instructionsMd + mainTopicId) ---
  const newActivity = (title: string, pos: number) =>
    prisma.activity.create({
      data: {
        title,
        instructionsMd: "perf",
        position: pos,
        lessonId: poolLessonsReuse[0],
        mainTopicId: topic.id,
      },
    });
  const poolActivitiesReuse = [
    (await newActivity("PERF-POOL Activity Reuse 0", 0)).id,
    (await newActivity("PERF-POOL Activity Reuse 1", 1)).id,
  ];
  const poolActivitiesDrop: number[] = [];
  for (const i of range(POOL))
    poolActivitiesDrop.push((await newActivity(`PERF-POOL Activity DROP ${i}`, 10 + i)).id);

  // --- enrollment: the seed STUDENT (needed for chat-session reads) ---
  // GET chat-sessions requires the reader to be enrolled in the activity's
  // course, else 403. `userId` holds a Core CUID (`seed_user_student_01` maps to
  // student1, the `student` role the harness mints a cookie for). The synthetic
  // enrollment DELETE/role-PATCH pools were dropped with the #1072 anchor
  // refactor: those routes now require a matching Core enrollment and write
  // through to Core, so they are out of the local-mutation benchmark.
  await prisma.courseEnrollment.create({
    data: { courseOfferingId: course.id, userId: CORE_STUDENT, role: "STUDENT" },
  });

  // --- one AiChatSession (owned by the seed student) for chat-session reads ---
  // The messages endpoint proxies Core `GET /api/chats/:chatId/messages`, so the
  // session's chatId must be a REAL Core chat owned by this student — reuse the
  // one the Core perf seed exported (readChatId). A synthetic id → Core 404.
  const chat = await prisma.aiChatSession.create({
    data: {
      userId: CORE_STUDENT,
      activityId: poolActivitiesReuse[0],
      mode: "teach",
      chatId: readChatId ?? `perf-pool-chat-${course.id}`,
    },
  });
  if (!readChatId) {
    console.warn(
      "  ⚠ core.json readChatId missing — messages endpoint will 404 (run core db:seed:perf first)",
    );
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    poolSize: POOL,
    instructorUserId: CORE_INSTRUCTOR,
    studentUserId: CORE_STUDENT,
    courseId: course.id,
    topicId: topic.id,
    poolModulesReuse,
    poolModulesDrop,
    poolLessonsReuse,
    poolLessonsDrop,
    poolActivitiesReuse,
    poolActivitiesDrop,
    // reads reuse the pool entities (all exist under the pool offering):
    seededModuleId: poolModulesReuse[0],
    seededLessonId: poolLessonsReuse[0],
    seededActivityId: poolActivitiesReuse[0],
    seededChatId: chat.chatId,
  };
  writeManifest(manifest);
  console.log(`  ✓ ai-tutor pool ready (course ${course.id})`);
}

main()
  .catch((e) => {
    console.error("✗ ai-tutor perf seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
