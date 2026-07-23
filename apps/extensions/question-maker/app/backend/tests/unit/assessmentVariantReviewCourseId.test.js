/**
 * reviewVariantExamWithAi — Course.code was removed by #1072; regression that
 * review loads only id/coreCourseId and resolves live code via enrichCourseDetail.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const chat = vi.fn();
const findOne = vi.fn();
const enrichCourseDetail = vi.fn();
const loadOrderedVariantsForAssessment = vi.fn();

vi.mock('../../src/services/eduaiService.js', () => ({
  default: {
    isConfigured: () => true,
    chat,
  },
}));

vi.mock('../../src/schema/index.js', () => ({
  Assessments: { findOne },
  AssessmentSections: {},
  SectionVariants: {},
  Variants: {},
  Question_Metadata: {},
  Course: {},
  Topics: {},
  VariantSelectionCursor: {},
  sequelize: {},
}));

vi.mock('../../src/config/database.js', () => ({
  sequelize: { query: vi.fn() },
}));

vi.mock('../../src/services/courseListService.js', () => ({
  enrichCourseDetail,
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

const { reviewVariantExamWithAi } = await import(
  '../../src/services/assessmentVariantService.js'
);

describe('reviewVariantExamWithAi (#1072 course code read-through)', () => {
  beforeEach(() => {
    chat.mockReset();
    findOne.mockReset();
    enrichCourseDetail.mockReset();
    loadOrderedVariantsForAssessment.mockReset();

    const course = { id: 3, coreCourseId: 'cuid-core-course' };
    findOne.mockResolvedValue({
      id: 10,
      courseId: 3,
      course,
    });
    enrichCourseDetail.mockResolvedValue({
      id: 3,
      coreCourseId: 'cuid-core-course',
      code: 'COSC 121',
      name: 'Computer Programming I',
    });
    loadOrderedVariantsForAssessment.mockResolvedValue([
      {
        id: 1,
        questionText: 'What is recursion?',
        answer: 'A function calling itself',
        choices: [],
      },
    ]);
    chat.mockResolvedValue({
      content: JSON.stringify({
        conceptual_equivalence: 5,
        difficulty_similarity: 5,
        structural_validity: 5,
        answer_correctness: 5,
        topic_alignment: 5,
        distinctness: 4,
        usability: 'usable_as_is',
        brief_reason: 'Good variant',
      }),
    });
  });

  it('does not select Course.code and forwards enriched code + coreCourseId', async () => {
    await reviewVariantExamWithAi(42, {
      baselineAssessmentId: 10,
      variantAssessmentId: 11,
      courseId: 3,
      model: 'vllm:qwen2.5-32b-instruct',
      apiKeys: { vllm: { isEnabled: true } },
      cookie: 'session=abc',
    });

    expect(findOne).toHaveBeenCalledTimes(2);
    for (const call of findOne.mock.calls) {
      const include = call[0]?.include?.[0];
      expect(include?.attributes).toEqual(['id', 'coreCourseId']);
      expect(include?.attributes).not.toContain('code');
    }

    expect(enrichCourseDetail).toHaveBeenCalledWith(
      expect.objectContaining({ id: 3, coreCourseId: 'cuid-core-course' }),
      { cookie: 'session=abc' },
    );

    expect(chat).toHaveBeenCalled();
    const chatArgs = chat.mock.calls[0][0];
    expect(chatArgs.courseId).toBe('cuid-core-course');
    expect(chatArgs.courseCode).toBe('COSC 121');
    expect(chatArgs.cookie).toBe('session=abc');
  });
});
