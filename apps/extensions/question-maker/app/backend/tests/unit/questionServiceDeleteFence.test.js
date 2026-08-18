/**
 * Deletes must take the per-question mutation fence so they cannot slip into
 * the unfenced window between approval (`isDraft:false`) and `linkVariantToCore`.
 * Prisma/fence are mocked — no DB required.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockFence,
  mockQuestionFindFirst,
  mockQuestionDelete,
  mockVariantFindFirst,
  mockVariantDelete,
  mockTxQuestionFindFirst,
  mockTxQuestionDelete,
  mockTxVariantFindFirst,
  mockTxVariantDelete,
} = vi.hoisted(() => ({
  mockFence: vi.fn(),
  mockQuestionFindFirst: vi.fn(),
  mockQuestionDelete: vi.fn(),
  mockVariantFindFirst: vi.fn(),
  mockVariantDelete: vi.fn(),
  mockTxQuestionFindFirst: vi.fn(),
  mockTxQuestionDelete: vi.fn(),
  mockTxVariantFindFirst: vi.fn(),
  mockTxVariantDelete: vi.fn(),
}));

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    questionMetadata: {
      findFirst: (...args) => mockQuestionFindFirst(...args),
      delete: (...args) => mockQuestionDelete(...args),
    },
    variants: {
      findFirst: (...args) => mockVariantFindFirst(...args),
      delete: (...args) => mockVariantDelete(...args),
    },
  },
}));

vi.mock('../../src/services/questionMutationFence.js', () => ({
  withQuestionMutationFence: (...args) => mockFence(...args),
}));

vi.mock('../../src/services/courseListService.js', () => ({
  enrichRowsWithCourse: vi.fn(async (rows) => rows),
  enrichRowWithCourse: vi.fn(async (row) => row),
  formatSemesterDisplay: vi.fn(() => null),
}));

const { deleteQuestion, deleteVariant } = await import('../../src/services/questionService.js');

const USER_ID = 'cuid-user-1';

beforeEach(() => {
  vi.clearAllMocks();
  mockFence.mockImplementation(async (_questionId, operation) => operation({
    questionMetadata: {
      findFirst: mockTxQuestionFindFirst,
      delete: mockTxQuestionDelete,
    },
    variants: {
      findFirst: mockTxVariantFindFirst,
      delete: mockTxVariantDelete,
    },
  }));
});

describe('deleteQuestion fence', () => {
  it('takes the question fence and deletes with the transaction client', async () => {
    const question = { id: 42 };
    mockQuestionFindFirst.mockResolvedValue(question);
    mockTxQuestionFindFirst.mockResolvedValue(question);
    mockTxQuestionDelete.mockResolvedValue(question);

    await expect(deleteQuestion(42, USER_ID)).resolves.toBe(true);

    expect(mockFence).toHaveBeenCalledTimes(1);
    expect(mockFence).toHaveBeenCalledWith(42, expect.any(Function));
    expect(mockTxQuestionFindFirst).toHaveBeenCalledWith({
      where: { id: 42, course: { userId: USER_ID } },
    });
    expect(mockTxQuestionDelete).toHaveBeenCalledWith({ where: { id: 42 } });
    expect(mockQuestionDelete).not.toHaveBeenCalled();
  });

  it('does not enter the fence when the ownership lookup misses', async () => {
    mockQuestionFindFirst.mockResolvedValue(null);

    await expect(deleteQuestion(42, USER_ID)).rejects.toThrow('Question not found');
    expect(mockFence).not.toHaveBeenCalled();
    expect(mockQuestionDelete).not.toHaveBeenCalled();
  });

  it('throws Question not found when the fenced re-read misses', async () => {
    mockQuestionFindFirst.mockResolvedValue({ id: 42 });
    mockTxQuestionFindFirst.mockResolvedValue(null);

    await expect(deleteQuestion(42, USER_ID)).rejects.toThrow('Question not found');
    expect(mockFence).toHaveBeenCalledWith(42, expect.any(Function));
    expect(mockTxQuestionDelete).not.toHaveBeenCalled();
    expect(mockQuestionDelete).not.toHaveBeenCalled();
  });
});

describe('deleteVariant fence', () => {
  it('takes the parent-question fence and deletes with the transaction client', async () => {
    const variant = { id: 7, questionMetadataId: 42 };
    mockVariantFindFirst.mockResolvedValue(variant);
    mockTxVariantFindFirst.mockResolvedValue(variant);
    mockTxVariantDelete.mockResolvedValue(variant);

    await expect(deleteVariant(7, USER_ID)).resolves.toBe(true);

    expect(mockFence).toHaveBeenCalledTimes(1);
    expect(mockFence).toHaveBeenCalledWith(42, expect.any(Function));
    expect(mockTxVariantFindFirst).toHaveBeenCalledWith({
      where: { id: 7, questionMetadata: { course: { userId: USER_ID } } },
    });
    expect(mockTxVariantDelete).toHaveBeenCalledWith({ where: { id: 7 } });
    expect(mockVariantDelete).not.toHaveBeenCalled();
  });

  it('does not enter the fence when the ownership lookup misses', async () => {
    mockVariantFindFirst.mockResolvedValue(null);

    await expect(deleteVariant(7, USER_ID)).rejects.toThrow('Variant not found');
    expect(mockFence).not.toHaveBeenCalled();
    expect(mockVariantDelete).not.toHaveBeenCalled();
  });

  it('throws Variant not found when the fenced re-read misses', async () => {
    mockVariantFindFirst.mockResolvedValue({ id: 7, questionMetadataId: 42 });
    mockTxVariantFindFirst.mockResolvedValue(null);

    await expect(deleteVariant(7, USER_ID)).rejects.toThrow('Variant not found');
    expect(mockFence).toHaveBeenCalledWith(42, expect.any(Function));
    expect(mockTxVariantDelete).not.toHaveBeenCalled();
    expect(mockVariantDelete).not.toHaveBeenCalled();
  });
});
