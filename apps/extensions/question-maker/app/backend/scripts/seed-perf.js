/**
 * seed-perf.js — Issue #961 Question-Maker perf-baseline mutation POOL.
 *
 * ADDITIVE seed (run AFTER `npm run seed`; only truncates its own previously
 * tracked courses, never the demo data) that creates a disposable, tagged
 * subtree so the repo-root `scripts/perf-baseline.mjs` can exercise EVERY
 * in-scope QM mutation endpoint. Writes a manifest (`<repoRoot>/.perf-pool/qm.json`)
 * the perf script reads — QM ids are numeric autoincrement (Topics ids are
 * CUID strings), not guessable.
 *
 * Design (from the endpoint spec):
 *  - An UNLINKED perf course (coreCourseId = null) is used for every per-course
 *    endpoint so `requireCourseAccess` takes the owner fast-path (no Core call)
 *    and topics/enrollments/sync-status stay DB-pure.
 *  - Destructive endpoints consume victims → re-run this seed between perf runs.
 *  - Reset (on re-run) deletes the course ids recorded in the PREVIOUS manifest;
 *    every child row (topics/questions/variants/assessments/sections/links)
 *    cascade-deletes with the course (schema.prisma `onDelete: Cascade`), so
 *    there's no manual child-table walk needed like the old Sequelize version.
 *
 * Run from apps/extensions/question-maker/app/backend:
 *   node scripts/seed-perf.js         (PERF_POOL_SIZE=15 to change victim count)
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { createId } from '@paralleldrive/cuid2';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '../../../.env');
if (existsSync(envPath)) dotenv.config({ path: envPath });
else dotenv.config();

const CORE_INSTRUCTOR = 'seed_user_instructor_cs'; // mirrors apps/core SEED_IDS
const POOL = Number(process.env.PERF_POOL_SIZE ?? 15);
const range = (n) => Array.from({ length: n }, (_, i) => i);

function poolDir() {
  if (process.env.PERF_POOL_DIR) return process.env.PERF_POOL_DIR;
  let d = process.cwd();
  for (let i = 0; i < 8; i++) {
    const pkg = join(d, 'package.json');
    if (existsSync(pkg)) {
      try {
        const j = JSON.parse(readFileSync(pkg, 'utf8'));
        if (j.workspaces) return join(d, '.perf-pool');
      } catch { /* ignore */ }
    }
    d = dirname(d);
  }
  return join(process.cwd(), '.perf-pool');
}
function manifestPath() {
  return join(poolDir(), 'qm.json');
}
function writeManifest(obj) {
  const dir = poolDir();
  mkdirSync(dir, { recursive: true });
  const f = manifestPath();
  writeFileSync(f, JSON.stringify(obj, null, 2));
  console.log(`  ✓ wrote pool manifest → ${f}`);
}

const { prisma } = await import('../src/config/database.js');

/** Deletes every course id recorded in the previous run's manifest (cascades children). */
async function resetPool() {
  const f = manifestPath();
  if (!existsSync(f)) return;
  let prev;
  try {
    prev = JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return;
  }
  const courseIds = [prev.courseId, ...(prev.courseDeletePool ?? []), prev.courseUpdateId].filter(
    (id) => Number.isInteger(id),
  );
  if (courseIds.length > 0) {
    await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
  }
}

async function main() {
  await prisma.$queryRaw`SELECT 1`;
  console.log(`▶ QM perf pool: ${POOL} victims/endpoint`);
  await resetPool();

  // Ensure the instructor user row exists (mirror of Core CUID) for FKs.
  await prisma.user.upsert({
    where: { id: CORE_INSTRUCTOR },
    update: {},
    create: { id: CORE_INSTRUCTOR, email: 'instructor.cs@eduai.local', name: 'Dr. Ada Lovelace' },
  });

  // --- unlinked perf course + topics ---
  // `name`/`code` are Core-owned and no longer stored locally (#1072 §4 step
  // 10) — the anchor row is just userId + coreCourseId.
  const course = await prisma.course.create({ data: { userId: CORE_INSTRUCTOR, coreCourseId: null } });
  const topics = [];
  for (const i of range(3)) {
    topics.push(await prisma.topics.create({ data: { id: createId(), name: `__PERF__ Topic ${i}`, courseId: course.id } }));
  }
  const topicId = topics[0].id;

  const newQuestion = (desc) =>
    prisma.questionMetadata.create({
      data: { description: desc, type: 'MCQ', courseId: course.id, primaryTopicId: topicId, createdBy: CORE_INSTRUCTOR },
    });
  const newVariant = (metaId, assessmentId = null) =>
    prisma.variants.create({
      data: {
        questionText: '__PERF__ variant', questionMetadataId: metaId, assessmentId,
        isDraft: true, coreQuestionId: null, createdBy: CORE_INSTRUCTOR,
      },
    });
  // `semester` no longer exists on Assessments (#1072 §4 step 10/#1077) — derived at read time.
  const newAssessment = (name) =>
    prisma.assessments.create({ data: { courseId: course.id, type: 'Quiz', name: `__PERF__ ${name}` } });
  const newSection = (assessmentId, name) =>
    prisma.assessmentSections.create({ data: { assessmentId, name: `__PERF__ ${name}`, position: 0 } });

  // --- anchors (stable, never deleted) for reads + POST targets ---
  const anchorQuestion = await newQuestion('__PERF__ anchor question');
  const anchorVariant = await newVariant(anchorQuestion.id);
  const anchorAssessment = await newAssessment('Anchor Assessment');
  const anchorSection = await newSection(anchorAssessment.id, 'Anchor Section');

  // --- question pools: delete + update ---
  const questionDeletePool = [];
  for (const i of range(POOL)) questionDeletePool.push((await newQuestion(`__PERF__ del q ${i}`)).id);
  const questionUpdateId = (await newQuestion('__PERF__ upd q')).id;

  // --- variant pools (draft, no core link) ---
  const variantDeletePool = [];
  for (const i of range(POOL)) variantDeletePool.push((await newVariant(anchorQuestion.id)).id);
  const variantUpdateId = (await newVariant(anchorQuestion.id)).id;
  const variantTestableGuardId = (await newVariant(anchorQuestion.id)).id; // no coreQuestionId → 400 guard path

  // --- assessment pools ---
  const assessmentDeletePool = [];
  for (const i of range(POOL)) assessmentDeletePool.push((await newAssessment(`del a ${i}`)).id);
  const assessmentUpdateId = (await newAssessment('upd a')).id;

  // --- section pools (under anchor assessment) ---
  const sectionDeletePool = [];
  for (const i of range(POOL)) sectionDeletePool.push((await newSection(anchorAssessment.id, `del s ${i}`)).id);
  const sectionUpdateId = (await newSection(anchorAssessment.id, 'upd s')).id;

  // --- section-variant link pools (delete link + order update) ---
  const sectionVariantDeletePool = []; // {sectionId, variantId}
  for (const i of range(POOL)) {
    const v = await newVariant(anchorQuestion.id);
    await prisma.sectionVariants.create({ data: { sectionId: anchorSection.id, variantId: v.id, displayOrder: i } });
    sectionVariantDeletePool.push({ sectionId: anchorSection.id, variantId: v.id });
  }
  const svUpdVariant = await newVariant(anchorQuestion.id);
  await prisma.sectionVariants.create({ data: { sectionId: anchorSection.id, variantId: svUpdVariant.id, displayOrder: 999 } });
  const sectionVariantUpdate = { sectionId: anchorSection.id, variantId: svUpdVariant.id };

  // --- section-variant ADD pool: fresh variants NOT yet linked to anchorSection.
  //     POST .../variants consumes one per sample; (section_id, variant_id) is
  //     unique, so reusing one id 409s after the first insert. Re-seed to refill.
  const sectionVariantAddPool = [];
  for (const i of range(POOL)) sectionVariantAddPool.push((await newVariant(anchorQuestion.id)).id);

  // --- unlinked course pools (delete cascades children) + update ---
  const courseDeletePool = [];
  for (const i of range(POOL)) {
    courseDeletePool.push((await prisma.course.create({ data: { userId: CORE_INSTRUCTOR, coreCourseId: null } })).id);
  }
  const courseUpdateId = (await prisma.course.create({ data: { userId: CORE_INSTRUCTOR, coreCourseId: null } })).id;

  // --- questions linked to an assessment via questionOrder (for DELETE
  //     /:id/order/:assessmentId and DELETE /assessments/:id/questions/:qid) ---
  const orderAssessment = await newAssessment('order assessment');
  const questionOrderPool = []; // {questionId, assessmentId}
  for (const i of range(POOL)) {
    const q = await prisma.questionMetadata.create({
      data: {
        description: `__PERF__ ordered q ${i}`, type: 'MCQ', courseId: course.id, primaryTopicId: topicId,
        createdBy: CORE_INSTRUCTOR, questionOrder: { [orderAssessment.id]: i + 1 },
      },
    });
    questionOrderPool.push({ questionId: q.id, assessmentId: orderAssessment.id });
  }

  // --- questions with a section-linked variant (for remove-from-all-sections) ---
  const questionWithSectionLinkPool = [];
  for (const i of range(POOL)) {
    const q = await newQuestion(`__PERF__ sectioned q ${i}`);
    const v = await newVariant(q.id);
    await prisma.sectionVariants.create({ data: { sectionId: anchorSection.id, variantId: v.id, displayOrder: 1000 + i } });
    questionWithSectionLinkPool.push(q.id);
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    poolSize: POOL,
    instructorUserId: CORE_INSTRUCTOR,
    courseId: course.id,
    topicIds: topics.map((t) => t.id),
    primaryTopicId: topicId,
    anchorQuestionId: anchorQuestion.id,
    anchorVariantId: anchorVariant.id,
    anchorAssessmentId: anchorAssessment.id,
    anchorSectionId: anchorSection.id,
    questionDeletePool,
    questionUpdateId,
    variantDeletePool,
    variantUpdateId,
    variantTestableGuardId,
    assessmentDeletePool,
    assessmentUpdateId,
    sectionDeletePool,
    sectionUpdateId,
    sectionVariantDeletePool,
    sectionVariantAddPool,
    sectionVariantUpdate,
    courseDeletePool,
    courseUpdateId,
    questionOrderPool,
    questionWithSectionLinkPool,
  };
  writeManifest(manifest);
  console.log(`  ✓ QM pool ready (course ${course.id})`);
}

main()
  .catch((e) => { console.error('✗ QM perf seed failed:', e); process.exit(1); })
  .finally(async () => { try { await prisma.$disconnect(); } catch { /* */ } });
