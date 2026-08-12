/**
 * Unit tests for coreWiringService.pushVariantToCore.
 * All DB (Prisma Topics) and HTTP (coreApiService) dependencies are mocked.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock DB — Topics model
// ---------------------------------------------------------------------------
const mockPrimaryTopic = { id: 'local-t1', name: 'Sorting', coreTopicId: null };
const mockSecondaryTopic = { id: 'local-t2', name: 'Binary Search', coreTopicId: null };

const topicsFindUnique = vi.fn();
const topicsFindMany = vi.fn();
const topicsUpdate = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    topics: {
      findUnique: topicsFindUnique,
      findMany: topicsFindMany,
      update: topicsUpdate,
    },
  },
}));

// ---------------------------------------------------------------------------
// Mock coreApiService
// ---------------------------------------------------------------------------
vi.mock('../../src/services/coreApiService.js', () => ({
  pushTopicToCore: vi.fn(),
  pushQuestionToCore: vi.fn(),
  getCourseTopicsFromCore: vi.fn(),
  patchQuestionTestableOnCore: vi.fn(),
}));

const { pushTopicToCore, pushQuestionToCore } = await import('../../src/services/coreApiService.js');
const { pushVariantToCore } = await import('../../src/services/coreWiringService.js');

const course = { id: 1, coreCourseId: 'cuid-core-course' };
const baseVariant = {
  id: 42,
  questionText: 'What is binary search?',
  difficulty: 'medium',
  reasoningLevel: 'factual',
  choices: null,
  answer: null,
  selectAllThatApply: false,
  correctAnswers: null,
  secondaryTopicsId: [],
  questionMetadata: { type: 'SA', primaryTopicId: 'local-t1' },
};

beforeEach(() => {
  vi.clearAllMocks();
  topicsUpdate.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
describe('pushVariantToCore', () => {
  it('happy path — primary topic already has coreTopicId, no secondary topics', async () => {
    const topic = { ...mockPrimaryTopic, coreTopicId: 'cuid-t1' };
    topicsFindUnique.mockResolvedValueOnce(topic);
    pushQuestionToCore.mockResolvedValueOnce({ id: 'cuid-question-1' });

    const result = await pushVariantToCore(baseVariant, course, 'session=abc');

    expect(result).toEqual({ coreQuestionId: 'cuid-question-1' });
    expect(pushTopicToCore).not.toHaveBeenCalled();
    const [payload, cookie] = pushQuestionToCore.mock.calls[0];
    expect(payload.topicId).toBe('cuid-t1');
    expect(payload.courseId).toBe('cuid-core-course');
    expect(payload.content).toBe('What is binary search?');
    expect(payload.type).toBe('SA');
    expect(payload.difficulty).toBe('MEDIUM');
    expect(payload.reasoningLevel).toBe('FACTUAL');
    expect(payload.idempotencyKey).toMatch(/^qm-variant-42-[0-9a-f]{12}$/);
    expect(payload.secondaryTopicIds).toEqual([]);
    expect(payload.selectAllThatApply).toBe(false);
    expect(payload.correctAnswers).toBeUndefined();
    expect(cookie).toBe('session=abc');
  });

  it('push body includes selectAllThatApply and correctAnswers for multi-correct MCQ', async () => {
    const topic = { ...mockPrimaryTopic, coreTopicId: 'cuid-t1' };
    topicsFindUnique.mockResolvedValueOnce(topic);
    pushQuestionToCore.mockResolvedValueOnce({ id: 'cuid-question-mcq' });

    const mcqVariant = {
      ...baseVariant,
      questionText: 'Which are sorting algorithms?',
      choices: ['A) Quicksort', 'B) Mergesort', 'C) Binary search', 'D) Heapsort'],
      answer: 'A',
      selectAllThatApply: true,
      correctAnswers: ['A', 'B', 'D'],
      questionMetadata: { type: 'MCQ', primaryTopicId: 'local-t1' },
    };

    await pushVariantToCore(mcqVariant, course, 'session=abc');

    const [payload] = pushQuestionToCore.mock.calls[0];
    expect(payload.selectAllThatApply).toBe(true);
    expect(payload.correctAnswers).toEqual(['A', 'B', 'D']);
    expect(payload.choices).toEqual(mcqVariant.choices);
    expect(payload.answer).toBe('A');
    expect(payload.type).toBe('MCQ');
  });

  it('idempotency key is stable across identical calls but changes when content changes (#1080 follow-up)', async () => {
    const topic = { ...mockPrimaryTopic, coreTopicId: 'cuid-t1' };

    // First call.
    topicsFindUnique.mockResolvedValueOnce(topic);
    pushQuestionToCore.mockResolvedValueOnce({ id: 'cuid-question-a' });
    await pushVariantToCore(baseVariant, course, 'session=abc');
    const [firstPayload] = pushQuestionToCore.mock.calls[0];

    // Second call, identical content — same key (retry safety).
    topicsFindUnique.mockResolvedValueOnce(topic);
    pushQuestionToCore.mockResolvedValueOnce({ id: 'cuid-question-a' });
    await pushVariantToCore(baseVariant, course, 'session=abc');
    const [secondPayload] = pushQuestionToCore.mock.calls[1];
    expect(secondPayload.idempotencyKey).toBe(firstPayload.idempotencyKey);

    // Third call, edited content (e.g. post-unreview edit) — different key.
    topicsFindUnique.mockResolvedValueOnce(topic);
    pushQuestionToCore.mockResolvedValueOnce({ id: 'cuid-question-b' });
    const editedVariant = { ...baseVariant, questionText: 'What is a binary search tree?' };
    await pushVariantToCore(editedVariant, course, 'session=abc');
    const [thirdPayload] = pushQuestionToCore.mock.calls[2];
    expect(thirdPayload.idempotencyKey).not.toBe(firstPayload.idempotencyKey);
    expect(thirdPayload.idempotencyKey).toMatch(/^qm-variant-42-[0-9a-f]{12}$/);
  });

  it('pushes primary topic to Core if coreTopicId is missing, then stores it', async () => {
    const topic = { ...mockPrimaryTopic, coreTopicId: null };
    topicsFindUnique.mockResolvedValueOnce(topic);
    pushTopicToCore.mockResolvedValueOnce({ id: 'cuid-t-new' });
    pushQuestionToCore.mockResolvedValueOnce({ id: 'cuid-question-2' });

    const result = await pushVariantToCore(baseVariant, course, 'session=abc');

    expect(pushTopicToCore).toHaveBeenCalledWith('cuid-core-course', 'Sorting');
    expect(topicsUpdate).toHaveBeenCalledWith({ where: { id: 'local-t1' }, data: { coreTopicId: 'cuid-t-new' } });
    const [payload] = pushQuestionToCore.mock.calls[0];
    expect(payload.topicId).toBe('cuid-t-new');
    expect(result).toEqual({ coreQuestionId: 'cuid-question-2' });
  });

  it('translates secondary topic IDs to Core IDs, pushing missing ones', async () => {
    const variantWithSecondary = { ...baseVariant, secondaryTopicsId: ['local-t2'] };
    const primaryTopic = { ...mockPrimaryTopic, coreTopicId: 'cuid-t1' };
    const secondaryTopic = { ...mockSecondaryTopic, coreTopicId: null };

    topicsFindUnique.mockResolvedValueOnce(primaryTopic);
    topicsFindMany.mockResolvedValueOnce([secondaryTopic]);
    pushTopicToCore.mockResolvedValueOnce({ id: 'cuid-sec-new' });
    pushQuestionToCore.mockResolvedValueOnce({ id: 'cuid-question-3' });

    const result = await pushVariantToCore(variantWithSecondary, course, 'session=abc');

    expect(pushTopicToCore).toHaveBeenCalledWith('cuid-core-course', 'Binary Search');
    expect(topicsUpdate).toHaveBeenCalledWith({ where: { id: 'local-t2' }, data: { coreTopicId: 'cuid-sec-new' } });
    const [payload] = pushQuestionToCore.mock.calls[0];
    expect(payload.secondaryTopicIds).toEqual(['cuid-sec-new']);
    expect(result).toEqual({ coreQuestionId: 'cuid-question-3' });
  });

  it('idempotency replay — Core returns 201 with existing id when key is reused', async () => {
    const topic = { ...mockPrimaryTopic, coreTopicId: 'cuid-t1' };
    topicsFindUnique.mockResolvedValueOnce(topic);
    pushQuestionToCore.mockResolvedValueOnce({ id: 'cuid-existing-q' });

    const result = await pushVariantToCore(baseVariant, course, 'session=abc');

    expect(result).toEqual({ coreQuestionId: 'cuid-existing-q' });
  });

  it('handles topic push 409 via pushTopicToCore (existingId used)', async () => {
    const topic = { ...mockPrimaryTopic, coreTopicId: null };
    topicsFindUnique.mockResolvedValueOnce(topic);
    // pushTopicToCore already returns { id: existingId } on 409 — see coreApiService
    pushTopicToCore.mockResolvedValueOnce({ id: 'cuid-t-existing' });
    pushQuestionToCore.mockResolvedValueOnce({ id: 'cuid-question-4' });

    await pushVariantToCore(baseVariant, course, 'session=abc');

    expect(topicsUpdate).toHaveBeenCalledWith({ where: { id: 'local-t1' }, data: { coreTopicId: 'cuid-t-existing' } });
    const [payload] = pushQuestionToCore.mock.calls[0];
    expect(payload.topicId).toBe('cuid-t-existing');
  });

  it('throws INVALID_TOPIC_IDS error from Core without swallowing status/body', async () => {
    const topic = { ...mockPrimaryTopic, coreTopicId: 'cuid-t1' };
    topicsFindUnique.mockResolvedValueOnce(topic);
    const coreErr = Object.assign(new Error('INVALID_TOPIC_IDS'), {
      status: 422,
      body: { error: 'INVALID_TOPIC_IDS', deletedTopicIds: ['cuid-t2'], conflictingWithPrimary: [] },
    });
    pushQuestionToCore.mockRejectedValueOnce(coreErr);

    await expect(pushVariantToCore(baseVariant, course, 'session=abc')).rejects.toMatchObject({
      status: 422,
      body: { error: 'INVALID_TOPIC_IDS' },
    });
  });

  it('throws when primary topic is not found locally', async () => {
    topicsFindUnique.mockResolvedValueOnce(null);

    await expect(pushVariantToCore(baseVariant, course, 'session=abc')).rejects.toThrow(
      'Primary topic not found locally',
    );
    expect(pushQuestionToCore).not.toHaveBeenCalled();
  });
});
