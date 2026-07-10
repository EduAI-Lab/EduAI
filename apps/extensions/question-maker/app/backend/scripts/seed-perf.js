/**
 * seed-perf.js — Issue #961 Question-Maker perf-baseline mutation POOL.
 *
 * ADDITIVE seed (run AFTER `npm run seed`; does NOT sync({force}) so it never
 * drops the demo data) that creates a disposable, tagged subtree so the repo-root
 * `scripts/perf-baseline.mjs` can exercise EVERY in-scope QM mutation endpoint.
 * Writes a manifest (`<repoRoot>/.perf-pool/qm.json`) the perf script reads —
 * QM ids are numeric autoincrement (Topics ids are CUID strings), not guessable.
 *
 * Design (from the endpoint spec):
 *  - An UNLINKED perf course (coreCourseId = null) is used for every per-course
 *    endpoint so `requireCourseAccess` takes the owner fast-path (no Core call)
 *    and topics/enrollments/sync-status stay DB-pure.
 *  - Destructive endpoints consume victims → re-run this seed between perf runs.
 *
 * Run from apps/extensions/question-maker/app/backend:
 *   node scripts/seed-perf.js         (PERF_POOL_SIZE=15 to change victim count)
 */
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { Op } from 'sequelize';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = join(__dirname, '../../../.env');
if (existsSync(envPath)) dotenv.config({ path: envPath });
else dotenv.config();

const CORE_INSTRUCTOR = 'seed_user_instructor_cs'; // mirrors apps/core SEED_IDS
const POOL = Number(process.env.PERF_POOL_SIZE ?? 15);
const NAME_MARK = '__PERF__';
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
function writeManifest(obj) {
  const dir = poolDir();
  mkdirSync(dir, { recursive: true });
  const f = join(dir, 'qm.json');
  writeFileSync(f, JSON.stringify(obj, null, 2));
  console.log(`  ✓ wrote pool manifest → ${f}`);
}

const {
  sequelize, User, Course, Topics, Question_Metadata, Assessments,
  Variants, AssessmentSections, SectionVariants,
} = await import('../src/schema/index.js');

async function resetPool() {
  // Delete perf courses (cascades? QM associations may not cascade — delete
  // children first by walking the perf courses).
  const perfCourses = await Course.findAll({ where: { name: { [Op.like]: `${NAME_MARK}%` } } });
  const ids = perfCourses.map((c) => c.id);
  if (ids.length) {
    const metas = await Question_Metadata.findAll({ where: { courseId: { [Op.in]: ids } } });
    const metaIds = metas.map((m) => m.id);
    const variants = metaIds.length ? await Variants.findAll({ where: { questionMetadataId: { [Op.in]: metaIds } } }) : [];
    const variantIds = variants.map((v) => v.id);
    if (variantIds.length) await SectionVariants.destroy({ where: { variantId: { [Op.in]: variantIds } } });
    const assessments = await Assessments.findAll({ where: { courseId: { [Op.in]: ids } } });
    const assessmentIds = assessments.map((a) => a.id);
    if (assessmentIds.length) await AssessmentSections.destroy({ where: { assessmentId: { [Op.in]: assessmentIds } } });
    if (variantIds.length) await Variants.destroy({ where: { id: { [Op.in]: variantIds } } });
    if (metaIds.length) await Question_Metadata.destroy({ where: { id: { [Op.in]: metaIds } } });
    if (assessmentIds.length) await Assessments.destroy({ where: { id: { [Op.in]: assessmentIds } } });
    await Topics.destroy({ where: { courseId: { [Op.in]: ids } } });
    await Course.destroy({ where: { id: { [Op.in]: ids } } });
  }
}

async function main() {
  await sequelize.authenticate();
  console.log(`▶ QM perf pool: ${POOL} victims/endpoint`);
  await resetPool();

  // Ensure the instructor user row exists (mirror of Core CUID) for FKs.
  await User.findOrCreate({ where: { id: CORE_INSTRUCTOR }, defaults: { id: CORE_INSTRUCTOR, email: 'instructor.cs@eduai.local', name: 'Dr. Ada Lovelace' } });

  // --- unlinked perf course + topics ---
  const course = await Course.create({ name: `${NAME_MARK} QM Perf Course`, code: 'PERF', userId: CORE_INSTRUCTOR, coreCourseId: null });
  const topics = [];
  for (const i of range(3)) topics.push(await Topics.create({ name: `${NAME_MARK} Topic ${i}`, courseId: course.id }));
  const topicId = topics[0].id;

  const newQuestion = (desc) =>
    Question_Metadata.create({ description: desc, type: 'MCQ', courseId: course.id, primaryTopicId: topicId, createdBy: CORE_INSTRUCTOR });
  const newVariant = (metaId, assessmentId = null) =>
    Variants.create({ questionText: `${NAME_MARK} variant`, questionMetadataId: metaId, assessmentId, isDraft: true, coreQuestionId: null, createdBy: CORE_INSTRUCTOR });
  const newAssessment = (name) =>
    Assessments.create({ courseId: course.id, type: 'Quiz', name: `${NAME_MARK} ${name}`, semester: 'Fall 2026' });
  const newSection = (assessmentId, name) =>
    AssessmentSections.create({ assessmentId, name: `${NAME_MARK} ${name}`, position: 0 });

  // --- anchors (stable, never deleted) for reads + POST targets ---
  const anchorQuestion = await newQuestion(`${NAME_MARK} anchor question`);
  const anchorVariant = await newVariant(anchorQuestion.id);
  const anchorAssessment = await newAssessment('Anchor Assessment');
  const anchorSection = await newSection(anchorAssessment.id, 'Anchor Section');

  // --- question pools: delete + update ---
  const questionDeletePool = [];
  for (const i of range(POOL)) questionDeletePool.push((await newQuestion(`${NAME_MARK} del q ${i}`)).id);
  const questionUpdateId = (await newQuestion(`${NAME_MARK} upd q`)).id;

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
    await SectionVariants.create({ sectionId: anchorSection.id, variantId: v.id, displayOrder: i });
    sectionVariantDeletePool.push({ sectionId: anchorSection.id, variantId: v.id });
  }
  const svUpdVariant = await newVariant(anchorQuestion.id);
  await SectionVariants.create({ sectionId: anchorSection.id, variantId: svUpdVariant.id, displayOrder: 999 });
  const sectionVariantUpdate = { sectionId: anchorSection.id, variantId: svUpdVariant.id };

  // --- unlinked course pools (delete cascades children) + update ---
  const courseDeletePool = [];
  for (const i of range(POOL)) courseDeletePool.push((await Course.create({ name: `${NAME_MARK} del course ${i}`, code: 'PERFDEL', userId: CORE_INSTRUCTOR, coreCourseId: null })).id);
  const courseUpdateId = (await Course.create({ name: `${NAME_MARK} upd course`, code: 'PERFUPD', userId: CORE_INSTRUCTOR, coreCourseId: null })).id;

  // --- questions linked to an assessment via questionOrder (for DELETE
  //     /:id/order/:assessmentId and DELETE /assessments/:id/questions/:qid) ---
  const orderAssessment = await newAssessment('order assessment');
  const questionOrderPool = []; // {questionId, assessmentId}
  for (const i of range(POOL)) {
    const q = await Question_Metadata.create({
      description: `${NAME_MARK} ordered q ${i}`, type: 'MCQ', courseId: course.id, primaryTopicId: topicId,
      createdBy: CORE_INSTRUCTOR, questionOrder: { [orderAssessment.id]: i + 1 },
    });
    questionOrderPool.push({ questionId: q.id, assessmentId: orderAssessment.id });
  }

  // --- questions with a section-linked variant (for remove-from-all-sections) ---
  const questionWithSectionLinkPool = [];
  for (const i of range(POOL)) {
    const q = await newQuestion(`${NAME_MARK} sectioned q ${i}`);
    const v = await newVariant(q.id);
    await SectionVariants.create({ sectionId: anchorSection.id, variantId: v.id, displayOrder: 1000 + i });
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
  .finally(async () => { try { await sequelize.close(); } catch { /* */ } });
