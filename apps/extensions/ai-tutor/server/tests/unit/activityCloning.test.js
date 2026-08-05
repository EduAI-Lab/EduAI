import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const mockAggregate = vi.fn();
const mockTopicFindFirst = vi.fn();
const mockTopicCreate = vi.fn();
const mockActivityCreate = vi.fn();

const tx = {
  activity: {
    aggregate: (...args) => mockAggregate(...args),
    create: (...args) => mockActivityCreate(...args),
  },
  topic: {
    findFirst: (...args) => mockTopicFindFirst(...args),
    create: (...args) => mockTopicCreate(...args),
  },
};

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    $transaction: (callback) => callback(tx),
  },
}));

const { cloneActivityIntoLesson } = await import('../../src/services/activityCloning.js');

beforeEach(() => {
  mockAggregate.mockReset().mockResolvedValue({ _max: { position: null } });
  mockTopicFindFirst.mockReset();
  mockTopicCreate.mockReset();
  mockActivityCreate.mockReset().mockImplementation(({ data }) => Promise.resolve({ id: 'new-activity', ...data }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

function baseActivity(overrides = {}) {
  return {
    title: 'Source Activity',
    instructionsMd: 'Do the thing',
    config: { question: 'q' },
    promptTemplateId: 'pt-1',
    customPrompt: null,
    customPromptTitle: null,
    mainTopic: null,
    secondaryTopics: [],
    enableTeachMode: true,
    enableGuideMode: false,
    enableCustomMode: false,
    ...overrides,
  };
}

describe('cloneActivityIntoLesson — position', () => {
  it('positions the clone at 1 when the target lesson has no existing activities', async () => {
    mockAggregate.mockResolvedValue({ _max: { position: null } });
    const sourceActivity = baseActivity({ mainTopic: { id: 5, name: 'Topic', courseOfferingId: 10 } });

    await cloneActivityIntoLesson({ sourceActivity, targetLessonId: 20, targetCourseOfferingId: 10 });

    expect(mockActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ position: 1 }) }),
    );
  });

  it('positions the clone at max(existing positions) + 1', async () => {
    mockAggregate.mockResolvedValue({ _max: { position: 4 } });
    const sourceActivity = baseActivity({ mainTopic: { id: 5, name: 'Topic', courseOfferingId: 10 } });

    await cloneActivityIntoLesson({ sourceActivity, targetLessonId: 20, targetCourseOfferingId: 10 });

    expect(mockActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ position: 5 }) }),
    );
  });
});

describe('cloneActivityIntoLesson — main topic resolution', () => {
  it('reuses the source topic id directly when it already belongs to the target course', async () => {
    const sourceActivity = baseActivity({ mainTopic: { id: 7, name: 'Physics', courseOfferingId: 10 } });

    await cloneActivityIntoLesson({ sourceActivity, targetLessonId: 20, targetCourseOfferingId: 10 });

    expect(mockTopicFindFirst).not.toHaveBeenCalled();
    expect(mockTopicCreate).not.toHaveBeenCalled();
    expect(mockActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ mainTopicId: 7 }) }),
    );
  });

  it('remaps cross-course by reusing an existing target-course topic with the same name', async () => {
    const sourceActivity = baseActivity({ mainTopic: { id: 7, name: 'Physics', courseOfferingId: 10 } });
    mockTopicFindFirst.mockResolvedValue({ id: 99, name: 'Physics', courseOfferingId: 30 });

    await cloneActivityIntoLesson({ sourceActivity, targetLessonId: 20, targetCourseOfferingId: 30 });

    expect(mockTopicFindFirst).toHaveBeenCalledWith({
      where: { courseOfferingId: 30, name: 'Physics' },
    });
    expect(mockTopicCreate).not.toHaveBeenCalled();
    expect(mockActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ mainTopicId: 99 }) }),
    );
  });

  it('creates a new topic in the target course when no name match exists', async () => {
    const sourceActivity = baseActivity({ mainTopic: { id: 7, name: 'Physics', courseOfferingId: 10 } });
    mockTopicFindFirst.mockResolvedValue(null);
    mockTopicCreate.mockResolvedValue({ id: 123, name: 'Physics', courseOfferingId: 30 });

    await cloneActivityIntoLesson({ sourceActivity, targetLessonId: 20, targetCourseOfferingId: 30 });

    expect(mockTopicCreate).toHaveBeenCalledWith({
      data: { name: 'Physics', courseOfferingId: 30 },
    });
    expect(mockActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ mainTopicId: 123 }) }),
    );
  });

  it('throws when the main topic cannot be resolved (no source topic, cross-course)', async () => {
    const sourceActivity = baseActivity({ mainTopic: null });

    await expect(
      cloneActivityIntoLesson({ sourceActivity, targetLessonId: 20, targetCourseOfferingId: 30 }),
    ).rejects.toThrow('Failed to resolve main topic while cloning activity.');

    expect(mockActivityCreate).not.toHaveBeenCalled();
  });
});

describe('cloneActivityIntoLesson — secondary topics', () => {
  it('resolves each secondary topic the same way as the main topic (same-course reuse)', async () => {
    const sourceActivity = baseActivity({
      mainTopic: { id: 1, name: 'Main', courseOfferingId: 10 },
      secondaryTopics: [
        { topic: { id: 2, name: 'Sub A', courseOfferingId: 10 } },
        { topic: { id: 3, name: 'Sub B', courseOfferingId: 10 } },
      ],
    });

    await cloneActivityIntoLesson({ sourceActivity, targetLessonId: 20, targetCourseOfferingId: 10 });

    expect(mockActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          secondaryTopics: {
            create: [{ topic: { connect: { id: 2 } } }, { topic: { connect: { id: 3 } } }],
          },
        }),
      }),
    );
  });

  it('dedupes secondary topics that resolve to the same target id', async () => {
    const sourceActivity = baseActivity({
      mainTopic: { id: 1, name: 'Main', courseOfferingId: 10 },
      secondaryTopics: [
        { topic: { id: 2, name: 'Sub A', courseOfferingId: 10 } },
        { topic: { id: 2, name: 'Sub A', courseOfferingId: 10 } },
      ],
    });

    await cloneActivityIntoLesson({ sourceActivity, targetLessonId: 20, targetCourseOfferingId: 10 });

    expect(mockActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          secondaryTopics: { create: [{ topic: { connect: { id: 2 } } }] },
        }),
      }),
    );
  });

  it('drops secondary topics that resolve to the same id as the main topic', async () => {
    const sourceActivity = baseActivity({
      mainTopic: { id: 1, name: 'Main', courseOfferingId: 10 },
      secondaryTopics: [{ topic: { id: 1, name: 'Main', courseOfferingId: 10 } }],
    });

    await cloneActivityIntoLesson({ sourceActivity, targetLessonId: 20, targetCourseOfferingId: 10 });

    expect(mockActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ secondaryTopics: undefined }) }),
    );
  });

  it('leaves secondaryTopics undefined (no create clause) when there are none', async () => {
    const sourceActivity = baseActivity({
      mainTopic: { id: 1, name: 'Main', courseOfferingId: 10 },
      secondaryTopics: [],
    });

    await cloneActivityIntoLesson({ sourceActivity, targetLessonId: 20, targetCourseOfferingId: 10 });

    expect(mockActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ secondaryTopics: undefined }) }),
    );
  });

  it('remaps cross-course secondary topics independently of the main topic', async () => {
    const sourceActivity = baseActivity({
      mainTopic: { id: 1, name: 'Main', courseOfferingId: 10 },
      secondaryTopics: [{ topic: { id: 2, name: 'Sub', courseOfferingId: 10 } }],
    });
    mockTopicFindFirst.mockImplementation(({ where }) => {
      if (where.name === 'Main') return Promise.resolve({ id: 51 });
      if (where.name === 'Sub') return Promise.resolve({ id: 52 });
      return Promise.resolve(null);
    });

    await cloneActivityIntoLesson({ sourceActivity, targetLessonId: 20, targetCourseOfferingId: 30 });

    expect(mockActivityCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mainTopicId: 51,
          secondaryTopics: { create: [{ topic: { connect: { id: 52 } } }] },
        }),
      }),
    );
  });
});

describe('cloneActivityIntoLesson — created activity shape', () => {
  it('copies scalar fields and requests the standard include shape', async () => {
    const sourceActivity = baseActivity({
      title: 'My Activity',
      instructionsMd: 'Instructions',
      config: { question: 'What?' },
      promptTemplateId: 'pt-9',
      customPrompt: 'Custom',
      customPromptTitle: 'Custom Title',
      mainTopic: { id: 1, name: 'Main', courseOfferingId: 10 },
      enableTeachMode: false,
      enableGuideMode: true,
      enableCustomMode: true,
    });

    await cloneActivityIntoLesson({ sourceActivity, targetLessonId: 20, targetCourseOfferingId: 10 });

    expect(mockActivityCreate).toHaveBeenCalledWith({
      data: {
        title: 'My Activity',
        instructionsMd: 'Instructions',
        config: { question: 'What?' },
        position: 1,
        lessonId: 20,
        promptTemplateId: 'pt-9',
        customPrompt: 'Custom',
        customPromptTitle: 'Custom Title',
        mainTopicId: 1,
        enableTeachMode: false,
        enableGuideMode: true,
        enableCustomMode: true,
        secondaryTopics: undefined,
      },
      include: {
        promptTemplate: { select: { id: true, name: true } },
        mainTopic: true,
        secondaryTopics: { include: { topic: true } },
      },
    });
  });
});
