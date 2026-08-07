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
 *  - A NATIVE course (externalId/coreOfferingId = null) is required: publish/
 *    unpublish stay purely local (a linked course writes through to Core), and
 *    topic-create is allowed (external courses 403).
 *  - Destructive endpoints (DELETE module/lesson/activity, DELETE enrollment)
 *    consume victims → a perf run may deplete them; re-run this seed between runs.
 *
 * Usage:
 *   cd apps/extensions/ai-tutor/server && npx tsx prisma/seed-perf.ts
 *   PERF_POOL_SIZE=15 npx tsx prisma/seed-perf.ts
 */
import { PrismaClient } from '@eduai/ai-tutor-prisma-client';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const prisma = new PrismaClient();

const CORE_INSTRUCTOR = 'seed_user_instructor_cs'; // mirrors apps/core SEED_IDS
const CORE_STUDENT = 'seed_user_student_01';
const POOL = Number(process.env.PERF_POOL_SIZE ?? 15);
const NATIVE_TITLE = 'PERF-POOL Native Course';
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

function poolDir(): string {
  if (process.env.PERF_POOL_DIR) return process.env.PERF_POOL_DIR;
  let d = process.cwd();
  for (let i = 0; i < 8; i++) {
    const pkg = path.join(d, 'package.json');
    if (existsSync(pkg)) {
      try {
        const j = JSON.parse(readFileSync(pkg, 'utf8'));
        if (j.workspaces) return path.join(d, '.perf-pool');
      } catch { /* ignore */ }
    }
    d = path.dirname(d);
  }
  return path.join(process.cwd(), '.perf-pool');
}
function writeManifest(obj: unknown) {
  const dir = poolDir();
  mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'aitutor.json');
  writeFileSync(f, JSON.stringify(obj, null, 2));
  console.log(`  ✓ wrote pool manifest → ${f}`);
}
// Reads the Core perf manifest's readChatId — a real Core chat owned by the seed
// student — so the AiChatSession points at a chat the messages proxy can fetch.
function readCoreChatId(): string | null {
  try {
    const core = JSON.parse(readFileSync(path.join(poolDir(), 'core.json'), 'utf8'));
    return typeof core.readChatId === 'string' ? core.readChatId : null;
  } catch {
    return null;
  }
}

async function resetPool() {
  // Native course cascades to modules/lessons/activities/enrollments/topics/chats,
  // BUT Activity.mainTopicId → Topic is Restrict (no onDelete) while Topic cascades
  // from the course: the DB can't drop a Topic while an Activity still references it.
  // Delete the activities first (cascades their chats/metrics), then the course.
  const ids = (await prisma.courseOffering.findMany({
    where: { title: NATIVE_TITLE }, select: { id: true },
  })).map((c) => c.id);
  if (ids.length) {
    await prisma.activity.deleteMany({
      where: { lesson: { module: { courseOfferingId: { in: ids } } } },
    });
    await prisma.courseOffering.deleteMany({ where: { id: { in: ids } } });
  }
}

async function main() {
  console.log(`▶ ai-tutor perf pool: ${POOL} victims/endpoint`);
  await resetPool();

  // --- native course + instructor + topic ---
  // Published: module/lesson publish endpoints reject when the parent course is
  // unpublished ("Cannot publish module: parent course is not published").
  const course = await prisma.courseOffering.create({
    data: { title: NATIVE_TITLE, description: 'perf', isPublished: true },
  });
  await prisma.courseInstructor.create({
    data: { userId: CORE_INSTRUCTOR, courseOfferingId: course.id, role: 'LEAD' },
  });
  const topic = await prisma.topic.create({
    data: { name: 'PERF-POOL Topic', courseOfferingId: course.id },
  });

  // --- modules: reuse[2] (publish/unpublish) + drop[POOL] (DELETE) ---
  const newModule = (title: string, pos: number) =>
    prisma.module.create({ data: { title, position: pos, courseOfferingId: course.id } });
  const poolModulesReuse = [(await newModule('PERF-POOL Module Reuse 0', 0)).id, (await newModule('PERF-POOL Module Reuse 1', 1)).id];
  const poolModulesDrop: number[] = [];
  for (const i of range(POOL)) poolModulesDrop.push((await newModule(`PERF-POOL Module DROP ${i}`, 10 + i)).id);

  // --- lessons under reuse module 0 ---
  const newLesson = (title: string, pos: number) =>
    prisma.lesson.create({ data: { title, position: pos, moduleId: poolModulesReuse[0] } });
  const poolLessonsReuse = [(await newLesson('PERF-POOL Lesson Reuse 0', 0)).id, (await newLesson('PERF-POOL Lesson Reuse 1', 1)).id];
  const poolLessonsDrop: number[] = [];
  for (const i of range(POOL)) poolLessonsDrop.push((await newLesson(`PERF-POOL Lesson DROP ${i}`, 10 + i)).id);

  // --- activities under reuse lesson 0 (need instructionsMd + mainTopicId) ---
  const newActivity = (title: string, pos: number) =>
    prisma.activity.create({
      data: { title, instructionsMd: 'perf', position: pos, lessonId: poolLessonsReuse[0], mainTopicId: topic.id },
    });
  const poolActivitiesReuse = [(await newActivity('PERF-POOL Activity Reuse 0', 0)).id, (await newActivity('PERF-POOL Activity Reuse 1', 1)).id];
  const poolActivitiesDrop: number[] = [];
  for (const i of range(POOL)) poolActivitiesDrop.push((await newActivity(`PERF-POOL Activity DROP ${i}`, 10 + i)).id);

  // --- enrollments: drop[POOL] (DELETE) + role[2] (role flip). userId is a bare
  //     string (no FK), so synthetic ids are fine. ---
  const enrollDropUserIds = range(POOL).map((i) => `perf_user_del_${String(i).padStart(4, '0')}`);
  const enrollRoleUserIds = [0, 1].map((i) => `perf_user_role_${String(i).padStart(4, '0')}`);
  for (const uid of [...enrollDropUserIds, ...enrollRoleUserIds]) {
    await prisma.courseEnrollment.create({ data: { courseOfferingId: course.id, userId: uid, role: 'STUDENT' } });
  }
  // The chat-session reads run as the seed STUDENT — GET chat-sessions requires
  // that student to be enrolled in the activity's course, else 403.
  await prisma.courseEnrollment.create({
    data: { courseOfferingId: course.id, userId: CORE_STUDENT, role: 'STUDENT' },
  });

  // --- one AiChatSession (owned by the seed student) for chat-session reads ---
  // The messages endpoint proxies Core `GET /api/chats/:chatId/messages`, so the
  // session's chatId must be a REAL Core chat owned by this student — reuse the
  // one the Core perf seed exported (readChatId). A synthetic id → Core 404.
  const coreChatId = readCoreChatId();
  const chat = await prisma.aiChatSession.create({
    data: {
      userId: CORE_STUDENT,
      activityId: poolActivitiesReuse[0],
      mode: 'teach',
      chatId: coreChatId ?? `perf-pool-chat-${course.id}`,
    },
  });
  if (!coreChatId) {
    console.warn('  ⚠ core.json readChatId missing — messages endpoint will 404 (run core db:seed:perf first)');
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    poolSize: POOL,
    instructorUserId: CORE_INSTRUCTOR,
    studentUserId: CORE_STUDENT,
    nativeCourseId: course.id,
    nativeTopicId: topic.id,
    poolModulesReuse,
    poolModulesDrop,
    poolLessonsReuse,
    poolLessonsDrop,
    poolActivitiesReuse,
    poolActivitiesDrop,
    enrollDropUserIds,
    enrollRoleUserIds,
    // reads reuse the pool entities (all exist under the native course):
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
    console.error('✗ ai-tutor perf seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
