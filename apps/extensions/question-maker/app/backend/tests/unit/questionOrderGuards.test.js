/**
 * Service-boundary regressions for question-order integrity and approval batch
 * budgets. The database collaborators are mocked here; the matching integration
 * cases in assessmentServiceGaps/crossCourseScoping exercise the same paths on
 * real Postgres when TEST_DATABASE_URL is available.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCourseFindFirst,
  mockTopicFindMany,
  mockAssessmentFindMany,
  mockAssessmentFindFirst,
  mockQuestionCreate,
  mockQuestionFindFirst,
  mockQuestionUpdate,
} = vi.hoisted(() => ({
  mockCourseFindFirst: vi.fn(),
  mockTopicFindMany: vi.fn(),
  mockAssessmentFindMany: vi.fn(),
  mockAssessmentFindFirst: vi.fn(),
  mockQuestionCreate: vi.fn(),
  mockQuestionFindFirst: vi.fn(),
  mockQuestionUpdate: vi.fn(),
}));

vi.mock('../../src/config/settings.js', () => {
  const cfg = { maxQuestions: 2 };
  return { config: cfg, default: cfg };
});

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    course: { findFirst: mockCourseFindFirst },
    topics: { findMany: mockTopicFindMany },
    assessments: {
      findMany: mockAssessmentFindMany,
      findFirst: mockAssessmentFindFirst,
    },
    questionMetadata: {
      create: mockQuestionCreate,
      findFirst: mockQuestionFindFirst,
      update: mockQuestionUpdate,
    },
    variants: { findFirst: vi.fn().mockResolvedValue(null) },
  },
}));

vi.mock('../../src/services/courseListService.js', () => ({
  enrichRowsWithCourse: vi.fn(async (rows) => rows),
  enrichRowWithCourse: vi.fn(async (row) => row),
  formatSemesterDisplay: vi.fn(() => 'Unscheduled'),
}));

const {
  createQuestion,
  updateQuestion,
  createMultipleQuestions,
  updateQuestionOrder,
} = await import('../../src/services/questionService.js');
const { addQuestionToAssessment } = await import('../../src/services/assessmentService.js');

beforeEach(() => {
  vi.clearAllMocks();
  mockCourseFindFirst.mockResolvedValue({ id: 1 });
  mockTopicFindMany.mockResolvedValue([{ id: 'topic-a' }]);
  mockAssessmentFindMany.mockResolvedValue([{ id: 10 }]);
  mockAssessmentFindFirst.mockResolvedValue({ id: 10, courseId: 1 });
  mockQuestionCreate.mockResolvedValue({ id: 101, courseId: 1 });
  mockQuestionFindFirst.mockResolvedValue({
    id: 101,
    courseId: 1,
    primaryTopicId: 'topic-a',
    questionOrder: {},
  });
  mockQuestionUpdate.mockResolvedValue({ id: 101, questionOrder: { '10': 1 } });
});

describe('question order service guards', () => {
  it('rejects an approval batch over config.maxQuestions before creating rows', async () => {
    const questions = Array.from({ length: 3 }, (_, index) => ({
      courseId: 1,
      primaryTopicId: 'topic-a',
      description: `Question ${index + 1}`,
    }));

    await expect(createMultipleQuestions('user-1', questions)).rejects.toMatchObject({
      status: 400,
      code: 'QM_QUESTION_BATCH_TOO_LARGE',
    });
    expect(mockQuestionCreate).not.toHaveBeenCalled();
  });

  it('rejects cross-course assessment IDs on question creation and update', async () => {
    mockAssessmentFindMany.mockResolvedValue([]);

    await expect(createQuestion('user-1', {
      courseId: 1,
      primaryTopicId: 'topic-a',
      questionOrder: { 999: 1 },
    })).rejects.toThrow(/Assessment not found for this course/);

    await expect(updateQuestion(101, 'user-1', {
      questionOrder: { 999: 1 },
    })).rejects.toThrow(/Assessment not found for this course/);
    expect(mockQuestionCreate).not.toHaveBeenCalled();
    expect(mockQuestionUpdate).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN])(
    'rejects invalid question-order values (%s) in direct services',
    async (orderNumber) => {
      await expect(updateQuestionOrder(101, 10, orderNumber, 'user-1'))
        .rejects.toThrow(/positive safe integer/i);
      await expect(addQuestionToAssessment(10, 101, orderNumber, 'user-1'))
        .rejects.toThrow(/positive safe integer/i);
    },
  );

  it('writes a normalized valid order only after same-course assessment checks', async () => {
    const updated = await updateQuestionOrder(101, 10, '3', 'user-1');

    expect(mockAssessmentFindFirst).toHaveBeenCalledWith({
      where: { id: 10, courseId: 1 },
      select: { id: true },
    });
    expect(mockQuestionUpdate).toHaveBeenCalledWith({
      where: { id: 101 },
      data: { questionOrder: { '10': 3 } },
    });
    expect(updated).toEqual({ id: 101, questionOrder: { '10': 1 } });
  });
});
