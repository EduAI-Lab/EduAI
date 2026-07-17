/**
 * Unit tests for pushVariantToCore origin / external-id payload fields.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockTopicUpdate = vi.fn().mockResolvedValue(undefined);
const mockCanvasMapFindOne = vi.fn();

vi.mock('../../src/schema/index.js', () => ({
  Topics: {
    findOne: vi.fn(),
    findAll: vi.fn(),
  },
  CanvasBankQuestionMapping: {
    findOne: (...args) => mockCanvasMapFindOne(...args),
  },
}));

vi.mock('../../src/services/coreApiService.js', () => ({
  pushTopicToCore: vi.fn(),
  pushQuestionToCore: vi.fn(),
  patchQuestionTestableOnCore: vi.fn(),
}));

const { Topics } = await import('../../src/schema/index.js');
const { pushQuestionToCore } = await import('../../src/services/coreApiService.js');
const { pushVariantToCore } = await import('../../src/services/coreWiringService.js');

const course = { id: 1, coreCourseId: 'cuid-core-course' };
const baseVariant = {
  id: 42,
  questionText: 'What is 2+2?',
  difficulty: 'medium',
  reasoningLevel: 'factual',
  choices: null,
  answer: 'B',
  secondaryTopicsId: [],
  questionMetadata: { id: 99, type: 'MCQ', primaryTopicId: 'local-t1' },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCanvasMapFindOne.mockResolvedValue(null);
  Topics.findOne.mockResolvedValue({
    id: 'local-t1',
    name: 'Arithmetic',
    coreTopicId: 'cuid-t1',
    update: mockTopicUpdate,
  });
  pushQuestionToCore.mockResolvedValue({ id: 'cuid-question-1' });
});

describe('pushVariantToCore origin fields', () => {
  it('includes source question-maker and Canvas external fields when mapping exists', async () => {
    mockCanvasMapFindOne.mockResolvedValue({
      canvasAssessmentQuestionId: 10,
      localQuestionMetadataId: 99,
    });

    await pushVariantToCore(baseVariant, course, 'session=abc');

    const [payload] = pushQuestionToCore.mock.calls[0];
    expect(payload).toMatchObject({
      source: 'question-maker',
      externalSource: 'CANVAS',
      externalId: '10',
    });
  });

  it('includes source question-maker without external fields when no Canvas mapping', async () => {
    await pushVariantToCore(baseVariant, course, 'session=abc');

    const [payload] = pushQuestionToCore.mock.calls[0];
    expect(payload.source).toBe('question-maker');
    expect(payload.externalSource).toBeUndefined();
    expect(payload.externalId).toBeUndefined();
  });
});
