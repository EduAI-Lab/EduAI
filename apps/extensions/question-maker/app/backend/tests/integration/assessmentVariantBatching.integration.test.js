/**
 * Batched-assembly guarantees for assessmentVariantService (#1370).
 *
 * Assembly used to run 5-6 queries per slot per exam, so a 3-exam / 50-question assemble cost
 * ~750 sequential round trips inside one transaction. These tests pin the two properties that
 * refactor has to keep:
 *   - query count inside the assembly transaction does not grow with slot count
 *   - the selection cursor still advances exactly once per pick, and still records the last pick
 *
 * Counting is done by wrapping the transaction client rather than by Prisma's query log, so it
 * measures the round trips the service itself issues.
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';

vi.mock('../../src/services/authService.js', () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({})
}));

const hasTestDb = Boolean(process.env.TEST_DATABASE_URL);
const describeDb = hasTestDb ? describe : describe.skip;

describeDb('assessmentVariantService batching (integration)', () => {
  let connectTestDatabase, truncateTestDatabase, prisma;
  let seedCoursesForNewUser;
  let assembleEquivalentExamVariants, assembleExamVariantsByMetadataSimilarity;

  const USER = { id: 'cuid-avs-batch-user', email: 'avs-batch@test.com', name: 'AVS Batch User' };

  beforeAll(async () => {
    const testDb = await import('../helpers/testDb.js');
    ({ connectTestDatabase, truncateTestDatabase, prisma } = testDb);
    await connectTestDatabase();

    ({ seedCoursesForNewUser } = await import('../helpers/seedCoursesFixture.js'));
    ({ assembleEquivalentExamVariants, assembleExamVariantsByMetadataSimilarity } = await import(
      '../../src/services/assessmentVariantService.js'
    ));
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
    vi.restoreAllMocks();
    if (prisma) await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Wraps `prisma.$transaction` so every model call and raw call made on the transaction client
   * is tallied. Returns the tally plus a `restore()`.
   */
  function countTransactionQueries() {
    const counts = { total: 0, byOp: {} };
    const bump = (op) => {
      counts.total += 1;
      counts.byOp[op] = (counts.byOp[op] || 0) + 1;
    };

    const wrapDelegate = (delegate, name) =>
      new Proxy(delegate, {
        get(target, prop) {
          const value = target[prop];
          if (typeof value === 'function' && typeof prop === 'string') {
            return (...args) => {
              bump(`${name}.${prop}`);
              return value.apply(target, args);
            };
          }
          return value;
        }
      });

    const wrapTx = (tx) =>
      new Proxy(tx, {
        get(target, prop) {
          const value = target[prop];
          if (typeof prop !== 'string') return value;
          if (prop.startsWith('$')) {
            if (typeof value !== 'function') return value;
            return (...args) => {
              bump(prop);
              return value.apply(target, args);
            };
          }
          if (value && typeof value === 'object') return wrapDelegate(value, prop);
          return value;
        }
      });

    const original = prisma.$transaction.bind(prisma);
    const spy = vi
      .spyOn(prisma, '$transaction')
      .mockImplementation((callback, options) =>
        typeof callback === 'function'
          ? original((tx) => callback(wrapTx(tx)), options)
          : original(callback, options)
      );

    return { counts, restore: () => spy.mockRestore() };
  }

  /**
   * Runs `run()` with the counting proxy installed and always removes it afterwards. The restore
   * has to be in a `finally`: when one of these assemblies throws — which is exactly what a
   * regression looks like — a leaked spy would break every later test in the file and bury the
   * one real failure.
   */
  async function measureTransactionQueries(run) {
    const { counts, restore } = countTransactionQueries();
    try {
      await run();
    } finally {
      restore();
    }
    return counts;
  }

  async function makeQuestionWithVariants(variantCount, overrides = {}) {
    const meta = await prisma.questionMetadata.create({
      data: {
        courseId,
        primaryTopicId: topicId,
        type: overrides.type || 'SA',
        questionOrder: {}
      }
    });

    const variants = [];
    for (let i = 0; i < variantCount; i++) {
      variants.push(
        await prisma.variants.create({
          data: {
            questionMetadataId: meta.id,
            questionText: `Question text ${meta.id}-${i}`,
            difficulty: overrides.difficulty || 'medium',
            reasoningLevel: overrides.reasoningLevel || 'factual',
            isDraft: false,
            isAiGenerated: false,
            secondaryTopicsId: [],
            assessmentId: null
          }
        })
      );
    }

    return { meta, variants };
  }

  /** Reference assessment with `slotCount` questions, each backed by `variantsPerSlot` variants. */
  async function buildReference(slotCount, variantsPerSlot) {
    const assessment = await prisma.assessments.create({
      data: { courseId, type: 'Midterm', name: `Reference ${slotCount}x${variantsPerSlot}` }
    });
    const section = await prisma.assessmentSections.create({
      data: { assessmentId: assessment.id, name: 'Main', position: 0 }
    });

    const slots = [];
    for (let i = 0; i < slotCount; i++) {
      const slot = await makeQuestionWithVariants(variantsPerSlot);
      await prisma.sectionVariants.create({
        data: { sectionId: section.id, variantId: slot.variants[0].id, displayOrder: i }
      });
      slots.push(slot);
    }

    return { assessment, section, slots };
  }

  // ---------------------------------------------------------------------------
  // Query count
  // ---------------------------------------------------------------------------

  describe('query count', () => {
    /**
     * Asserted as a delta between two slot counts rather than an absolute number, so unrelated
     * changes to the fixed prefetch do not rot the test — only per-slot regressions do.
     */
    it('assembleEquivalentExamVariants: query count is flat in slot count', async () => {
      const examLabels = ['A', 'B'];

      const small = await buildReference(3, 3);
      const smallCounts = await measureTransactionQueries(() =>
        assembleEquivalentExamVariants(USER.id, {
          referenceAssessmentId: small.assessment.id,
          courseId,
          examLabels
        })
      );

      const large = await buildReference(12, 3);
      const largeCounts = await measureTransactionQueries(() =>
        assembleEquivalentExamVariants(USER.id, {
          referenceAssessmentId: large.assessment.id,
          courseId,
          examLabels
        })
      );

      expect(largeCounts.total).toBe(smallCounts.total);
      // 4 writes per exam (assessment, section, section-variants, variant reassignment).
      expect(largeCounts.byOp['sectionVariants.createMany']).toBe(examLabels.length);
      expect(largeCounts.byOp['sectionVariants.create']).toBeUndefined();
      expect(largeCounts.byOp['variants.updateMany']).toBe(examLabels.length);
      expect(largeCounts.byOp['variants.update']).toBeUndefined();
      // One candidate prefetch for the whole batch, not one per slot.
      expect(largeCounts.byOp['variants.findMany']).toBe(1);
    });

    it('assembleExamVariantsByMetadataSimilarity: bank is fetched once for the whole batch', async () => {
      const examLabels = ['A', 'B'];

      const small = await buildReference(3, 3);
      const smallCounts = await measureTransactionQueries(() =>
        assembleExamVariantsByMetadataSimilarity(USER.id, {
          referenceAssessmentId: small.assessment.id,
          courseId,
          examLabels
        })
      );

      const large = await buildReference(8, 3);
      const largeCounts = await measureTransactionQueries(() =>
        assembleExamVariantsByMetadataSimilarity(USER.id, {
          referenceAssessmentId: large.assessment.id,
          courseId,
          examLabels
        })
      );

      expect(largeCounts.total).toBe(smallCounts.total);
      expect(largeCounts.byOp['questionMetadata.findMany']).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // Cursor semantics
  // ---------------------------------------------------------------------------

  describe('selection cursor', () => {
    it('advances once per pick and records the last picked variant', async () => {
      const { assessment, section, slots } = await buildReference(2, 3);

      await assembleEquivalentExamVariants(USER.id, {
        referenceAssessmentId: assessment.id,
        courseId,
        examLabels: ['A', 'B', 'C']
      });

      for (const slot of slots) {
        const cursor = await prisma.variantSelectionCursor.findUnique({
          where: {
            courseId_questionMetadataId: { courseId, questionMetadataId: slot.meta.id }
          }
        });

        // Three exams, one pick per exam for this base question.
        expect(cursor.nextOffset).toBe(3);

        // Excludes the reference section's own placement — only the assembled exams count.
        const placed = await prisma.sectionVariants.findMany({
          where: {
            variantId: { in: slot.variants.map((v) => v.id) },
            sectionId: { not: section.id }
          },
          orderBy: { id: 'asc' }
        });
        expect(placed).toHaveLength(3);
        expect(cursor.lastVariantId).toBe(placed[placed.length - 1].variantId);
      }
    });

    it('keeps advancing across separate assemblies rather than resetting', async () => {
      const { assessment, slots } = await buildReference(1, 3);
      const params = {
        referenceAssessmentId: assessment.id,
        courseId,
        examLabels: ['A']
      };

      await assembleEquivalentExamVariants(USER.id, params);
      await assembleEquivalentExamVariants(USER.id, params);

      const cursor = await prisma.variantSelectionCursor.findUnique({
        where: {
          courseId_questionMetadataId: { courseId, questionMetadataId: slots[0].meta.id }
        }
      });
      expect(cursor.nextOffset).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Selection behaviour that the batching must not change
  // ---------------------------------------------------------------------------

  describe('selection behaviour', () => {
    it('never reuses a variant across exams while the bank has enough of them', async () => {
      const { assessment, slots } = await buildReference(3, 3);

      await assembleEquivalentExamVariants(USER.id, {
        referenceAssessmentId: assessment.id,
        courseId,
        examLabels: ['A', 'B']
      });

      const placed = await prisma.sectionVariants.findMany({
        where: { variantId: { in: slots.flatMap((s) => s.variants.map((v) => v.id)) } }
      });

      // 3 reference placements + 3 slots x 2 exams, all distinct variant ids.
      const assembled = placed.map((p) => p.variantId);
      expect(new Set(assembled).size).toBe(assembled.length);
    });

    it('falls back to the reference variant and warns when it is the only candidate', async () => {
      const { assessment, slots } = await buildReference(1, 1);

      const result = await assembleEquivalentExamVariants(USER.id, {
        referenceAssessmentId: assessment.id,
        courseId,
        examLabels: ['A']
      });

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toMatchObject({ slot: 1, questionMetadataId: slots[0].meta.id });
    });

    it('rolls the whole batch back when a slot runs out of variants', async () => {
      const { assessment } = await buildReference(1, 1);
      const assessmentsBefore = await prisma.assessments.count({ where: { courseId } });

      await expect(
        assembleEquivalentExamVariants(USER.id, {
          referenceAssessmentId: assessment.id,
          courseId,
          examLabels: ['A', 'B']
        })
      ).rejects.toThrow(/No variant available for question metadata .* at slot 1/);

      expect(await prisma.assessments.count({ where: { courseId } })).toBe(assessmentsBefore);
    });
  });
});
