/**
 * DB-backed integration tests for assessmentVariantService.
 *
 * Covers the contract of:
 *   - setAssessmentStudyRole: merges studyRole into blueprintConfig
 *   - getBlueprintSnapshot: ordered slot view of a reference assessment
 *   - getBaselineVariantReadiness: per-slot non-draft variant counts and readiness
 *   - assembleEquivalentExamVariants: creates N assessments mirroring reference slot order;
 *     ATOMICITY — rolls back all when any slot has no available variant
 *   - assembleExamVariantsByMetadataSimilarity: uses metadata scoring to pick bank questions;
 *     ROLLBACK — rolls back all when no bank question meets the threshold for any slot
 *
 * Concurrency correctness of the cursor (SAVEPOINT race) is not tested here — it requires
 * concurrent sessions and is better verified with pg_advisory_lock or a load test.
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

vi.mock('../../src/services/authService.js', () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

describeDb('assessmentVariantService (integration)', () => {
  let connectTestDatabase, truncateTestDatabase, prisma;
  let seedCoursesForNewUser;
  let setAssessmentStudyRole, getBlueprintSnapshot, getBaselineVariantReadiness,
    assembleEquivalentExamVariants, assembleExamVariantsByMetadataSimilarity;

  const USER = { id: 'cuid-avs-user', email: 'avs@test.com', name: 'AVS User' };

  beforeAll(async () => {
    const testDb = await import('../helpers/testDb.js');
    ({ connectTestDatabase, truncateTestDatabase, prisma } = testDb);
    await connectTestDatabase();

    ({ seedCoursesForNewUser } = await import('../helpers/seedCoursesFixture.js'));
    ({
      setAssessmentStudyRole,
      getBlueprintSnapshot,
      getBaselineVariantReadiness,
      assembleEquivalentExamVariants,
      assembleExamVariantsByMetadataSimilarity
    } = await import('../../src/services/assessmentVariantService.js'));
  });

  let courseId, topicId;

  beforeEach(async () => {
    await truncateTestDatabase();
    await prisma.user.create({ data: { id: USER.id, email: USER.email, name: USER.name } });
    await seedCoursesForNewUser(USER.id);

    const course = await prisma.course.findFirst({ where: { userId: USER.id } });
    courseId = course.id;
    const topic = await prisma.topics.findFirst({ where: { courseId } });
    topicId = topic.id;
  });

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  async function makeAssessment(name = 'Reference Exam', blueprintConfig = null) {
    return prisma.assessments.create({ data: { courseId, type: 'Midterm', name, blueprintConfig } });
  }

  async function makeQuestion(type = 'SA') {
    return prisma.questionMetadata.create({ data: { courseId, primaryTopicId: topicId, type, questionOrder: {} } });
  }

  async function makeVariant(questionMetadataId, { isDraft = false, difficulty = 'medium', reasoningLevel = 'factual' } = {}) {
    return prisma.variants.create({
      data: {
        questionMetadataId,
        questionText: `Question text for ${questionMetadataId}`,
        difficulty,
        reasoningLevel,
        isDraft,
        isAiGenerated: false,
        secondaryTopicsId: [],
        assessmentId: null
      }
    });
  }

  /**
   * Builds a reference assessment with N questions, each with at least 2 non-draft variants.
   * Returns { assessment, slots: [{ meta, variants[] }] }
   */
  async function buildReferenceWithVariants(slotCount = 2, variantsPerSlot = 2) {
    const assessment = await makeAssessment();
    const section = await prisma.assessmentSections.create({
      data: { assessmentId: assessment.id, name: 'Main', position: 0 }
    });

    const slots = [];
    for (let i = 0; i < slotCount; i++) {
      const meta = await makeQuestion();
      const variants = [];
      for (let j = 0; j < variantsPerSlot; j++) {
        const v = await makeVariant(meta.id, { isDraft: false });
        variants.push(v);
      }
      // Place first variant in section
      await prisma.sectionVariants.create({ data: { sectionId: section.id, variantId: variants[0].id, displayOrder: i } });
      slots.push({ meta, variants });
    }

    return { assessment, section, slots };
  }

  // ---------------------------------------------------------------------------
  // setAssessmentStudyRole
  // ---------------------------------------------------------------------------

  describe('setAssessmentStudyRole', () => {
    it('sets studyRole on an assessment that has no prior blueprintConfig', async () => {
      const assessment = await makeAssessment('Clean Exam', null);
      await setAssessmentStudyRole(assessment.id, USER.id, 'reference_baseline');
      const reloaded = await prisma.assessments.findUnique({ where: { id: assessment.id } });
      expect(reloaded.blueprintConfig?.studyRole).toBe('reference_baseline');
    });

    it('merges studyRole with existing blueprintConfig fields without overwriting them', async () => {
      const assessment = await makeAssessment('Existing Config', { existingKey: 'keep-me' });
      await setAssessmentStudyRole(assessment.id, USER.id, 'reference_baseline');
      const reloaded = await prisma.assessments.findUnique({ where: { id: assessment.id } });
      expect(reloaded.blueprintConfig.studyRole).toBe('reference_baseline');
      expect(reloaded.blueprintConfig.existingKey).toBe('keep-me');
    });

    it('removes studyRole from blueprintConfig when null is passed', async () => {
      const assessment = await makeAssessment('Has Role', { studyRole: 'reference_baseline' });
      await setAssessmentStudyRole(assessment.id, USER.id, null);
      const reloaded = await prisma.assessments.findUnique({ where: { id: assessment.id } });
      expect(reloaded.blueprintConfig?.studyRole).toBeUndefined();
    });

    it('throws when an invalid studyRole string is supplied', async () => {
      const assessment = await makeAssessment();
      await expect(
        setAssessmentStudyRole(assessment.id, USER.id, 'admin_override')
      ).rejects.toThrow(/invalid studyRole/i);
    });

    it('throws when the assessment does not belong to the requesting user', async () => {
      const assessment = await makeAssessment();
      await expect(
        setAssessmentStudyRole(assessment.id, 'cuid-wrong-user', 'reference_baseline')
      ).rejects.toThrow(/assessment not found/i);
    });
  });

  // ---------------------------------------------------------------------------
  // getBlueprintSnapshot
  // ---------------------------------------------------------------------------

  describe('getBlueprintSnapshot', () => {
    it('throws when the assessment does not exist', async () => {
      await expect(getBlueprintSnapshot(999999, USER.id)).rejects.toThrow(/assessment not found/i);
    });

    it('returns slotCount = 0 for an assessment with no sections', async () => {
      const assessment = await makeAssessment();
      const snapshot = await getBlueprintSnapshot(assessment.id, USER.id);
      expect(snapshot.slotCount).toBe(0);
      expect(snapshot.slots).toEqual([]);
    });

    it('returns one slot per placed variant in section order', async () => {
      const { assessment, slots } = await buildReferenceWithVariants(3, 2);
      const snapshot = await getBlueprintSnapshot(assessment.id, USER.id);
      expect(snapshot.slotCount).toBe(3);
      expect(snapshot.slots).toHaveLength(3);
      expect(snapshot.slots[0].order).toBe(1);
      expect(snapshot.slots[1].order).toBe(2);
      expect(snapshot.slots[2].order).toBe(3);
    });

    it('includes correct aggregate counts in the response', async () => {
      const { assessment } = await buildReferenceWithVariants(2, 1);
      const snapshot = await getBlueprintSnapshot(assessment.id, USER.id);
      expect(snapshot.aggregates.difficultyCounts.medium).toBe(2);
    });

    it('includes assessmentId, courseId, name, and semester in the response', async () => {
      const assessment = await makeAssessment('Blueprint Exam');
      const snapshot = await getBlueprintSnapshot(assessment.id, USER.id);
      expect(snapshot.assessmentId).toBe(assessment.id);
      expect(snapshot.courseId).toBe(courseId);
      expect(snapshot.name).toBe('Blueprint Exam');
    });
  });

  // ---------------------------------------------------------------------------
  // getBaselineVariantReadiness
  // ---------------------------------------------------------------------------

  describe('getBaselineVariantReadiness', () => {
    it('throws when assessmentId is missing', async () => {
      await expect(
        getBaselineVariantReadiness(USER.id, { courseId })
      ).rejects.toThrow(/assessmentId.*courseId|required/i);
    });

    it('throws when courseId is missing', async () => {
      await expect(
        getBaselineVariantReadiness(USER.id, { assessmentId: 1 })
      ).rejects.toThrow(/assessmentId.*courseId|required/i);
    });

    it('throws when the assessment belongs to a different course', async () => {
      const assessment = await makeAssessment();
      await expect(
        getBaselineVariantReadiness(USER.id, { assessmentId: assessment.id, courseId: 999999 })
      ).rejects.toThrow(/not found|mismatch/i);
    });

    it('returns ready=false for a slot that has fewer than 2 non-draft variants', async () => {
      const { assessment, slots } = await buildReferenceWithVariants(1, 1);
      const result = await getBaselineVariantReadiness(USER.id, {
        assessmentId: assessment.id,
        courseId
      });
      expect(result.slots[0].nonDraftVariantCount).toBe(1);
      expect(result.slots[0].ready).toBe(false);
      expect(result.allReady).toBe(false);
    });

    it('returns ready=true for a slot that has at least 2 non-draft variants', async () => {
      const { assessment } = await buildReferenceWithVariants(1, 2);
      const result = await getBaselineVariantReadiness(USER.id, {
        assessmentId: assessment.id,
        courseId
      });
      expect(result.slots[0].ready).toBe(true);
      expect(result.allReady).toBe(true);
    });

    it('returns allReady=false when even one slot is not ready', async () => {
      const assessment = await makeAssessment();
      const section = await prisma.assessmentSections.create({ data: { assessmentId: assessment.id, name: 'Main', position: 0 } });

      const readyMeta = await makeQuestion();
      const notReadyMeta = await makeQuestion();

      const v1 = await makeVariant(readyMeta.id, { isDraft: false });
      const v2 = await makeVariant(readyMeta.id, { isDraft: false });
      const v3 = await makeVariant(notReadyMeta.id, { isDraft: false });

      await prisma.sectionVariants.create({ data: { sectionId: section.id, variantId: v1.id, displayOrder: 0 } });
      await prisma.sectionVariants.create({ data: { sectionId: section.id, variantId: v3.id, displayOrder: 1 } });

      const result = await getBaselineVariantReadiness(USER.id, { assessmentId: assessment.id, courseId });
      expect(result.allReady).toBe(false);
    });

    it('keeps a slot whose variants are all drafts, reporting a count of 0', async () => {
      const assessment = await makeAssessment();
      const section = await prisma.assessmentSections.create({
        data: { assessmentId: assessment.id, name: 'Main', position: 0 }
      });
      const meta = await makeQuestion();
      const draft = await makeVariant(meta.id, { isDraft: true });
      await prisma.sectionVariants.create({
        data: { sectionId: section.id, variantId: draft.id, displayOrder: 0 }
      });

      const result = await getBaselineVariantReadiness(USER.id, { assessmentId: assessment.id, courseId });

      // The grouped count omits questions with no non-draft variants, so the slot must
      // still be reported with an explicit 0 rather than dropping out of the response.
      expect(result.slots).toHaveLength(1);
      expect(result.slots[0].questionMetadataId).toBe(meta.id);
      expect(result.slots[0].nonDraftVariantCount).toBe(0);
      expect(result.slots[0].ready).toBe(false);
      expect(result.allReady).toBe(false);
    });

    it('excludes a placed question that belongs to a different course', async () => {
      const assessment = await makeAssessment();
      const section = await prisma.assessmentSections.create({
        data: { assessmentId: assessment.id, name: 'Main', position: 0 }
      });

      const mine = await makeQuestion();
      const v1 = await makeVariant(mine.id, { isDraft: false });
      await prisma.sectionVariants.create({
        data: { sectionId: section.id, variantId: v1.id, displayOrder: 0 }
      });

      // Same owner, different course — the course scope is an authorization boundary,
      // so this question must not surface in the readiness response.
      const otherCourse = await prisma.course.create({ data: { userId: USER.id } });
      const otherTopic = await prisma.topics.findFirst({ where: { courseId } });
      const foreignMeta = await prisma.questionMetadata.create({
        data: { courseId: otherCourse.id, primaryTopicId: otherTopic.id, type: 'SA', questionOrder: {} }
      });
      const v2 = await makeVariant(foreignMeta.id, { isDraft: false });
      await prisma.sectionVariants.create({
        data: { sectionId: section.id, variantId: v2.id, displayOrder: 1 }
      });

      const result = await getBaselineVariantReadiness(USER.id, { assessmentId: assessment.id, courseId });

      expect(result.slots.map((s) => s.questionMetadataId)).toEqual([mine.id]);
      expect(result.slots[0].order).toBe(1);
    });

    it('includes minRequiredNonDraft in the response', async () => {
      const { assessment } = await buildReferenceWithVariants(1, 2);
      const result = await getBaselineVariantReadiness(USER.id, { assessmentId: assessment.id, courseId });
      expect(typeof result.minRequiredNonDraft).toBe('number');
      expect(result.minRequiredNonDraft).toBeGreaterThan(0);
    });
  });

  // ---------------------------------------------------------------------------
  // assembleEquivalentExamVariants
  // ---------------------------------------------------------------------------

  describe('assembleEquivalentExamVariants', () => {
    it('throws when referenceAssessmentId is missing', async () => {
      await expect(
        assembleEquivalentExamVariants(USER.id, { courseId, examLabels: ['A'] })
      ).rejects.toThrow(/referenceAssessmentId.*courseId|required/i);
    });

    it('throws when the reference has no questions in any section', async () => {
      const assessment = await makeAssessment('Empty Ref');
      await expect(
        assembleEquivalentExamVariants(USER.id, {
          referenceAssessmentId: assessment.id,
          courseId,
          examLabels: ['A']
        })
      ).rejects.toThrow(/no questions/i);
    });

    it('throws when the reference does not belong to the requesting user', async () => {
      const { assessment } = await buildReferenceWithVariants(1, 2);
      await expect(
        assembleEquivalentExamVariants('cuid-wrong-user', {
          referenceAssessmentId: assessment.id,
          courseId,
          examLabels: ['A']
        })
      ).rejects.toThrow(/not found|mismatch/i);
    });

    it('creates exactly one new assessment per exam label', async () => {
      // Need enough non-draft variants to serve N exams: globalUsedVariantIds prevents
      // reusing the same variant across parallel exams, so we need at least N variants.
      const { assessment, slots } = await buildReferenceWithVariants(1, 2);
      // Add a third non-draft variant so all three exams can pick a distinct one
      await makeVariant(slots[0].meta.id, { isDraft: false });

      const before = await prisma.assessments.count({ where: { courseId } });

      await assembleEquivalentExamVariants(USER.id, {
        referenceAssessmentId: assessment.id,
        courseId,
        examLabels: ['Form A', 'Form B', 'Form C']
      });

      expect(await prisma.assessments.count({ where: { courseId } })).toBe(before + 3);
    });

    it("names each created assessment '<name> — <label>'", async () => {
      const { assessment } = await buildReferenceWithVariants(1, 2);

      const result = await assembleEquivalentExamVariants(USER.id, {
        referenceAssessmentId: assessment.id,
        courseId,
        examLabels: ['Form A'],
        namePrefix: 'Midterm 2026'
      });

      expect(result.createdAssessments[0].name).toBe('Midterm 2026 — Form A');
    });

    it("uses the reference assessment's name when no namePrefix is supplied", async () => {
      const { assessment } = await buildReferenceWithVariants(1, 2);

      const result = await assembleEquivalentExamVariants(USER.id, {
        referenceAssessmentId: assessment.id,
        courseId,
        examLabels: ['Form A']
      });

      expect(result.createdAssessments[0].name).toContain(assessment.name);
    });

    it('sets blueprintConfig.studyRole = generated_variant on every created assessment', async () => {
      const { assessment } = await buildReferenceWithVariants(1, 2);

      const result = await assembleEquivalentExamVariants(USER.id, {
        referenceAssessmentId: assessment.id,
        courseId,
        examLabels: ['A', 'B']
      });

      for (const created of result.createdAssessments) {
        const row = await prisma.assessments.findUnique({ where: { id: created.id } });
        expect(row.blueprintConfig?.studyRole).toBe('generated_variant');
      }
    });

    it('stores referenceAssessmentId in blueprintConfig of each created assessment', async () => {
      const { assessment } = await buildReferenceWithVariants(1, 2);

      const result = await assembleEquivalentExamVariants(USER.id, {
        referenceAssessmentId: assessment.id,
        courseId,
        examLabels: ['A']
      });

      const row = await prisma.assessments.findUnique({ where: { id: result.createdAssessments[0].id } });
      expect(row.blueprintConfig?.referenceAssessmentId).toBe(assessment.id);
    });

    it('places one section-variant per slot in the created assessment section', async () => {
      const { assessment, slots } = await buildReferenceWithVariants(3, 2);

      const result = await assembleEquivalentExamVariants(USER.id, {
        referenceAssessmentId: assessment.id,
        courseId,
        examLabels: ['A']
      });

      const section = await prisma.assessmentSections.findFirst({
        where: { assessmentId: result.createdAssessments[0].id }
      });
      const links = await prisma.sectionVariants.findMany({ where: { sectionId: section.id } });
      expect(links).toHaveLength(slots.length);
    });

    it('emits a warning when it must reuse the reference variant because there is no alternative', async () => {
      const assessment = await makeAssessment('One Variant Ref');
      const section = await prisma.assessmentSections.create({ data: { assessmentId: assessment.id, name: 'Main', position: 0 } });
      const meta = await makeQuestion();
      const singleVariant = await makeVariant(meta.id, { isDraft: false });
      await prisma.sectionVariants.create({ data: { sectionId: section.id, variantId: singleVariant.id, displayOrder: 0 } });

      const result = await assembleEquivalentExamVariants(USER.id, {
        referenceAssessmentId: assessment.id,
        courseId,
        examLabels: ['A'],
        includeDrafts: false
      });

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0].slot).toBe(1);
    });

    it('ATOMICITY: rolls back all created assessments when a slot has no available variant', async () => {
      // Two-slot reference:
      //   slot 1 (metaOk): one non-draft variant — fine
      //   slot 2 (metaDraft): only a draft variant placed in the section
      // With includeDrafts=false, slot 2 has no candidates → throws → must roll back slot 1's work too.
      const assessment = await makeAssessment('Partial Ref');
      const section = await prisma.assessmentSections.create({ data: { assessmentId: assessment.id, name: 'Main', position: 0 } });

      const metaOk = await makeQuestion();
      const metaDraft = await makeQuestion();
      const v1 = await makeVariant(metaOk.id, { isDraft: false });
      const vDraft = await makeVariant(metaDraft.id, { isDraft: true });

      await prisma.sectionVariants.create({ data: { sectionId: section.id, variantId: v1.id, displayOrder: 0 } });
      await prisma.sectionVariants.create({ data: { sectionId: section.id, variantId: vDraft.id, displayOrder: 1 } });

      const before = await prisma.assessments.count({ where: { courseId } });

      await expect(
        assembleEquivalentExamVariants(USER.id, {
          referenceAssessmentId: assessment.id,
          courseId,
          examLabels: ['A'],
          includeDrafts: false
        })
      ).rejects.toThrow(/no variant available/i);

      // The entire transaction must have rolled back — no new assessment persisted
      expect(await prisma.assessments.count({ where: { courseId } })).toBe(before);
    });

    it('reports slotsProcessed and examCount in the return value', async () => {
      const { assessment } = await buildReferenceWithVariants(2, 2);

      const result = await assembleEquivalentExamVariants(USER.id, {
        referenceAssessmentId: assessment.id,
        courseId,
        examLabels: ['A', 'B']
      });

      expect(result.slotsProcessed).toBe(2);
      expect(result.examCount).toBe(2);
    });

    it('round-robin: prefers a different variant per successive exam when the bank allows', async () => {
      const assessment = await makeAssessment('Multi-Variant Ref');
      const section = await prisma.assessmentSections.create({ data: { assessmentId: assessment.id, name: 'Main', position: 0 } });
      const meta = await makeQuestion();

      const vRef = await makeVariant(meta.id, { isDraft: false });
      const vAlt = await makeVariant(meta.id, { isDraft: false });
      await prisma.sectionVariants.create({ data: { sectionId: section.id, variantId: vRef.id, displayOrder: 0 } });

      const result = await assembleEquivalentExamVariants(USER.id, {
        referenceAssessmentId: assessment.id,
        courseId,
        examLabels: ['A']
      });

      const newSection = await prisma.assessmentSections.findFirst({ where: { assessmentId: result.createdAssessments[0].id } });
      const link = await prisma.sectionVariants.findFirst({ where: { sectionId: newSection.id } });

      // The assembler should prefer the alternate variant, not the reference one
      expect(link.variantId).toBe(vAlt.id);
    });

    it('LARGE BATCH: completes a realistic-size multi-exam assembly inside one transaction', async () => {
      // 25 slots x 6 exams = 150 slot iterations, each doing several sequential
      // round-trips (candidate lookup, cursor SELECT ... FOR UPDATE, section-variant
      // insert, variant update). Measured locally, assembling this batch inside the
      // transaction alone comfortably exceeds Prisma's 5s interactive-transaction
      // default — the exact failure mode ASSEMBLY_TRANSACTION_TIMEOUT_MS guards
      // against (without it, Prisma aborts and rolls back all work once the clock
      // runs out, mid-batch). This is correctness/regression coverage for that
      // config, not a timing assertion — the test's own generous timeout just needs
      // to outlast the transaction, not measure it.
      // 6 variants per slot — exactly enough that each of the 6 exams below can
      // draw a not-yet-used variant per slot without exhausting the bank (variant
      // reuse across exams in one batch is never allowed by design).
      const examLabels = ['A', 'B', 'C', 'D', 'E', 'F'];
      const { assessment } = await buildReferenceWithVariants(25, examLabels.length);

      const result = await assembleEquivalentExamVariants(USER.id, {
        referenceAssessmentId: assessment.id,
        courseId,
        examLabels
      });

      expect(result.slotsProcessed).toBe(25);
      expect(result.examCount).toBe(examLabels.length);
      expect(result.createdAssessments).toHaveLength(examLabels.length);

      const sectionVariantCount = await prisma.sectionVariants.count({
        where: { section: { assessment: { id: { in: result.createdAssessments.map((a) => a.id) } } } }
      });
      expect(sectionVariantCount).toBe(25 * examLabels.length);
    }, 90000);
  });

  // ---------------------------------------------------------------------------
  // assembleExamVariantsByMetadataSimilarity
  // ---------------------------------------------------------------------------

  describe('assembleExamVariantsByMetadataSimilarity', () => {
    it('throws when referenceAssessmentId is missing', async () => {
      await expect(
        assembleExamVariantsByMetadataSimilarity(USER.id, { courseId, examLabels: ['A'] })
      ).rejects.toThrow(/referenceAssessmentId.*courseId|required/i);
    });

    it('throws when the reference has no questions in sections', async () => {
      const assessment = await makeAssessment('Empty');
      await expect(
        assembleExamVariantsByMetadataSimilarity(USER.id, {
          referenceAssessmentId: assessment.id,
          courseId,
          examLabels: ['A']
        })
      ).rejects.toThrow(/no questions/i);
    });

    it('sets assemblyMode = metadata_similarity in blueprintConfig', async () => {
      const { assessment, slots } = await buildReferenceWithVariants(1, 2);

      // Add a bank question that matches the reference slot's topic/type
      const bankMeta = await makeQuestion('SA');
      await makeVariant(bankMeta.id, { isDraft: false });

      const result = await assembleExamVariantsByMetadataSimilarity(USER.id, {
        referenceAssessmentId: assessment.id,
        courseId,
        examLabels: ['A'],
        includeDrafts: true
      });

      const row = await prisma.assessments.findUnique({ where: { id: result.createdAssessments[0].id } });
      expect(row.blueprintConfig?.assemblyMode).toBe('metadata_similarity');
    });

    it('ROLLBACK: rolls back all created assessments when variant selection fails for a matched slot', async () => {
      // Reference: 1 slot with only a DRAFT variant placed in the section.
      // findBestBankMetadataForSlot will find this question as a bank candidate (same topic/type → high score),
      // but pickVariantForSlot with includeDrafts=false will return null since the only variant is a draft.
      // This triggers the "No variant available" throw → the entire transaction must roll back.
      const assessment = await makeAssessment('Draft Only Ref');
      const section = await prisma.assessmentSections.create({ data: { assessmentId: assessment.id, name: 'Main', position: 0 } });
      const meta = await makeQuestion();
      const draftVariant = await makeVariant(meta.id, { isDraft: true });
      await prisma.sectionVariants.create({ data: { sectionId: section.id, variantId: draftVariant.id, displayOrder: 0 } });

      const before = await prisma.assessments.count({ where: { courseId } });

      await expect(
        assembleExamVariantsByMetadataSimilarity(USER.id, {
          referenceAssessmentId: assessment.id,
          courseId,
          examLabels: ['A'],
          includeDrafts: false
        })
      ).rejects.toThrow(/no variant available/i);

      expect(await prisma.assessments.count({ where: { courseId } })).toBe(before);
    });

    it('creates exactly one new assessment per exam label when assembly succeeds', async () => {
      const { assessment } = await buildReferenceWithVariants(1, 2);
      // Add bank question matching same topic/type
      const bankMeta = await makeQuestion('SA');
      await makeVariant(bankMeta.id, { isDraft: false });

      const before = await prisma.assessments.count({ where: { courseId } });

      await assembleExamVariantsByMetadataSimilarity(USER.id, {
        referenceAssessmentId: assessment.id,
        courseId,
        examLabels: ['X', 'Y'],
        includeDrafts: true
      });

      expect(await prisma.assessments.count({ where: { courseId } })).toBe(before + 2);
    });
  });
});
