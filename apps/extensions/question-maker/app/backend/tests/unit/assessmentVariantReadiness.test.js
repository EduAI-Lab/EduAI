/**
 * getBaselineVariantReadiness — #1371 batched the per-question `findFirst` + `count` into a
 * single course-scope filter plus one `groupBy`. These cover the two ways that batching can
 * silently go wrong: `groupBy` omitting zero-row groups, and the course-scope check (an
 * authorization boundary) being weakened when it moves out of the per-row query.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const assessmentsFindFirst = vi.fn();
const variantsGroupBy = vi.fn();
const loadOrderedVariantsForAssessment = vi.fn();

vi.mock('../../src/services/eduaiService.js', () => ({
  default: { isConfigured: () => true, chat: vi.fn() },
}));

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    assessments: { findFirst: assessmentsFindFirst },
    assessmentSections: {},
    sectionVariants: {},
    variants: { groupBy: variantsGroupBy },
    questionMetadata: {},
    course: {},
    topics: {},
    variantSelectionCursor: {},
  },
}));

vi.mock('../../src/services/courseListService.js', () => ({
  enrichCourseDetail: vi.fn(),
  formatSemesterDisplay: vi.fn(),
  deriveSemesterDisplayForCourseId: vi.fn(),
}));

vi.mock('../../src/services/assessmentVariantUtils.js', () => ({
  loadOrderedVariantsForAssessment,
  aggregateStructure: vi.fn(),
}));

vi.mock('../../src/services/assessmentVariantMetadataScoring.js', () => ({
  scoreMetadataMatch: vi.fn(),
}));

const { getBaselineVariantReadiness, MIN_NON_DRAFT_VARIANTS_FOR_WORKFLOW } = await import(
  '../../src/services/assessmentVariantService.js'
);

/** A placed variant as `loadOrderedVariantsForAssessment` returns it. */
const placed = (metaId, courseId, extra = {}) => ({
  id: metaId * 100,
  questionMetadata: {
    id: metaId,
    courseId,
    description: `question ${metaId}`,
    type: 'multiple_choice',
    ...extra,
  },
});

describe('getBaselineVariantReadiness (#1371 batched readiness)', () => {
  beforeEach(() => {
    assessmentsFindFirst.mockReset();
    variantsGroupBy.mockReset();
    loadOrderedVariantsForAssessment.mockReset();

    assessmentsFindFirst.mockResolvedValue({ id: 10, courseId: 3 });
    variantsGroupBy.mockResolvedValue([]);
    loadOrderedVariantsForAssessment.mockResolvedValue([]);
  });

  it('requires both assessmentId and courseId', async () => {
    await expect(
      getBaselineVariantReadiness(42, { assessmentId: null, courseId: 3 }),
    ).rejects.toThrow('assessmentId and courseId are required');

    await expect(
      getBaselineVariantReadiness(42, { assessmentId: 10, courseId: null }),
    ).rejects.toThrow('assessmentId and courseId are required');

    expect(assessmentsFindFirst).not.toHaveBeenCalled();
  });

  it('throws when the assessment is missing or in another course', async () => {
    assessmentsFindFirst.mockResolvedValue(null);

    await expect(
      getBaselineVariantReadiness(42, { assessmentId: 10, courseId: 3 }),
    ).rejects.toThrow('Assessment not found or course mismatch');

    expect(assessmentsFindFirst).toHaveBeenCalledWith({
      where: { id: 10, courseId: 3, course: { userId: 42 } },
    });
  });

  it('keeps a slot whose variants are all drafts, reporting a zero count', async () => {
    // groupBy omits zero-row groups entirely, so meta 2 comes back with no row at all.
    loadOrderedVariantsForAssessment.mockResolvedValue([placed(1, 3), placed(2, 3)]);
    variantsGroupBy.mockResolvedValue([{ questionMetadataId: 1, _count: { _all: 2 } }]);

    const result = await getBaselineVariantReadiness(42, { assessmentId: 10, courseId: 3 });

    expect(result.slots).toEqual([
      {
        order: 1,
        questionMetadataId: 1,
        description: 'question 1',
        questionType: 'multiple_choice',
        nonDraftVariantCount: 2,
        ready: true,
      },
      {
        order: 2,
        questionMetadataId: 2,
        description: 'question 2',
        questionType: 'multiple_choice',
        nonDraftVariantCount: 0,
        ready: false,
      },
    ]);
    expect(result.allReady).toBe(false);
    expect(result.minRequiredNonDraft).toBe(MIN_NON_DRAFT_VARIANTS_FOR_WORKFLOW);
    expect(result.assessmentId).toBe(10);
    expect(result.courseId).toBe(3);

    // Only non-draft variants are counted, and only for the authorized question ids.
    expect(variantsGroupBy).toHaveBeenCalledWith({
      by: ['questionMetadataId'],
      where: { questionMetadataId: { in: [1, 2] }, isDraft: false },
      _count: { _all: true },
    });
  });

  it('excludes a placed question belonging to a different course', async () => {
    loadOrderedVariantsForAssessment.mockResolvedValue([
      placed(1, 3),
      placed(2, 99), // leaked in from another course
    ]);
    variantsGroupBy.mockResolvedValue([{ questionMetadataId: 1, _count: { _all: 3 } }]);

    const result = await getBaselineVariantReadiness(42, { assessmentId: 10, courseId: '3' });

    expect(result.slots.map((s) => s.questionMetadataId)).toEqual([1]);
    expect(result.allReady).toBe(true);
    expect(variantsGroupBy.mock.calls[0][0].where.questionMetadataId.in).toEqual([1]);
  });

  it('dedupes repeated question metadata, preserving placement order', async () => {
    loadOrderedVariantsForAssessment.mockResolvedValue([
      placed(7, 3),
      placed(5, 3),
      { id: 999, questionMetadata: { id: 7, courseId: 3, description: 'question 7', type: 'multiple_choice' } },
      { id: 1000, questionMetadata: null }, // unplaced/broken row is skipped
    ]);
    variantsGroupBy.mockResolvedValue([
      { questionMetadataId: 7, _count: { _all: 2 } },
      { questionMetadataId: 5, _count: { _all: 2 } },
    ]);

    const result = await getBaselineVariantReadiness(42, { assessmentId: 10, courseId: 3 });

    expect(result.slots.map((s) => s.questionMetadataId)).toEqual([7, 5]);
    expect(result.slots.map((s) => s.order)).toEqual([1, 2]);
    expect(variantsGroupBy).toHaveBeenCalledTimes(1);
  });

  it('skips the count query and reports not-ready when nothing is in scope', async () => {
    loadOrderedVariantsForAssessment.mockResolvedValue([placed(1, 99)]);

    const result = await getBaselineVariantReadiness(42, { assessmentId: 10, courseId: 3 });

    expect(result.slots).toEqual([]);
    expect(result.allReady).toBe(false);
    expect(variantsGroupBy).not.toHaveBeenCalled();
  });

  it('defaults missing description and type to null', async () => {
    loadOrderedVariantsForAssessment.mockResolvedValue([
      { id: 1, questionMetadata: { id: 4, courseId: 3 } },
    ]);
    variantsGroupBy.mockResolvedValue([]);

    const result = await getBaselineVariantReadiness(42, { assessmentId: 10, courseId: 3 });

    expect(result.slots[0]).toMatchObject({ description: null, questionType: null });
  });
});
