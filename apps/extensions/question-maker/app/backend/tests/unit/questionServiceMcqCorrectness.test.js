/**
 * Unit tests: createVariant / updateVariant persist multi-correct MCQ fields
 * via normalizeMcqCorrectness. Prisma is mocked — no DB required.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockMetaFindFirst,
  mockVariantCreate,
  mockVariantFindFirst,
  mockVariantUpdate,
} = vi.hoisted(() => ({
  mockMetaFindFirst: vi.fn(),
  mockVariantCreate: vi.fn(),
  mockVariantFindFirst: vi.fn(),
  mockVariantUpdate: vi.fn(),
}));

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    questionMetadata: { findFirst: mockMetaFindFirst },
    variants: {
      create: mockVariantCreate,
      findFirst: mockVariantFindFirst,
      update: mockVariantUpdate,
    },
  },
}));

vi.mock('../../src/services/courseListService.js', () => ({
  enrichRowsWithCourse: vi.fn(async (rows) => rows),
  enrichRowWithCourse: vi.fn(async (row) => row),
  formatSemesterDisplay: vi.fn(() => null),
}));

const { createVariant, updateVariant } = await import('../../src/services/questionService.js');

const USER_ID = 'cuid-user-1';
const CHOICES = [
  { letter: 'A', text: 'Alpha' },
  { letter: 'B', text: 'Beta' },
  { letter: 'C', text: 'Gamma' },
];

describe('questionService MCQ multi-correct persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createVariant', () => {
    it('multi-correct: sorts correctAnswers, sets answer to first sorted, flag true', async () => {
      mockMetaFindFirst.mockResolvedValue({ id: 10, type: 'MCQ' });
      mockVariantCreate.mockResolvedValue({ id: 1 });

      await createVariant(10, {
        questionText: 'Pick all that apply',
        difficulty: 'medium',
        answer: null,
        choices: CHOICES,
        selectAllThatApply: true,
        correctAnswers: ['C', 'A'],
      }, USER_ID);

      expect(mockVariantCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          answer: 'A',
          correctAnswers: ['A', 'C'],
          selectAllThatApply: true,
          choices: CHOICES,
        }),
      });
    });

    it('single-correct: flag false and correctAnswers null', async () => {
      mockMetaFindFirst.mockResolvedValue({ id: 10, type: 'MCQ' });
      mockVariantCreate.mockResolvedValue({ id: 2 });

      await createVariant(10, {
        questionText: 'Pick one',
        difficulty: 'easy',
        answer: 'B',
        choices: CHOICES,
        selectAllThatApply: false,
        correctAnswers: ['A', 'B'],
      }, USER_ID);

      expect(mockVariantCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          answer: 'B',
          selectAllThatApply: false,
          correctAnswers: null,
        }),
      });
    });

    it('non-MCQ: leaves selectAllThatApply false and correctAnswers null', async () => {
      mockMetaFindFirst.mockResolvedValue({ id: 11, type: 'SA' });
      mockVariantCreate.mockResolvedValue({ id: 3 });

      await createVariant(11, {
        questionText: 'Explain photosynthesis',
        answer: 'Light to chemical energy',
        selectAllThatApply: true,
        correctAnswers: ['A'],
      }, USER_ID);

      expect(mockVariantCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          answer: 'Light to chemical energy',
          selectAllThatApply: false,
          correctAnswers: null,
          choices: null,
        }),
      });
    });
  });

  describe('updateVariant', () => {
    it('multi-correct update normalizes and persists both fields', async () => {
      mockVariantFindFirst.mockResolvedValue({
        id: 5,
        isDraft: true,
        answer: 'A',
        choices: CHOICES,
        selectAllThatApply: false,
        correctAnswers: null,
        questionMetadata: { id: 10, type: 'MCQ' },
      });
      mockVariantUpdate.mockResolvedValue({ id: 5 });

      await updateVariant(5, {
        selectAllThatApply: true,
        correctAnswers: ['C', 'A'],
      }, USER_ID);

      expect(mockVariantUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            answer: 'A',
            correctAnswers: ['A', 'C'],
            selectAllThatApply: true,
          }),
        }),
      );
    });
  });
});
