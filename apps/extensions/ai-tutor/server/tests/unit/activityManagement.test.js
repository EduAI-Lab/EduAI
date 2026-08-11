import { beforeEach, describe, expect, it, vi } from 'vitest';

const lessonFindUnique = vi.fn();
const activityFindUnique = vi.fn();
const activityFindFirst = vi.fn();
const activityCreate = vi.fn();
const activityUpdate = vi.fn();
const topicFindUnique = vi.fn();
const topicFindMany = vi.fn();
const promptFindUnique = vi.fn();
const isUnitAdminForCourse = vi.fn();

vi.mock('../../src/config/database.js', () => ({
  prisma: {
    lesson: { findUnique: lessonFindUnique },
    activity: {
      findUnique: activityFindUnique,
      findFirst: activityFindFirst,
      create: activityCreate,
      update: activityUpdate,
    },
    topic: { findUnique: topicFindUnique, findMany: topicFindMany },
    promptTemplate: { findUnique: promptFindUnique },
  },
}));

vi.mock('../../src/middleware/auth.js', () => ({
  isUnitAdminForCourse: (...args) => isUnitAdminForCourse(...args),
}));

const { ActivityMutationError, createActivityForLesson, updateActivityForEditor } =
  await import('../../src/services/activityManagement.js');

const user = { id: 'instructor-1', role: 'INSTRUCTOR' };

function lessonFixture() {
  return {
    id: 10,
    module: {
      courseOffering: {
        id: 20,
        instructors: [{ userId: user.id }],
      },
    },
  };
}

function activityFixture() {
  return {
    id: 30,
    mainTopicId: 'topic-main',
    enableTeachMode: true,
    enableGuideMode: false,
    enableCustomMode: false,
    config: { question: 'Old question', untouched: 'preserved' },
    lesson: {
      module: {
        courseOfferingId: 20,
        courseOffering: {
          id: 20,
          instructors: [{ userId: user.id }],
        },
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  isUnitAdminForCourse.mockResolvedValue(false);
  topicFindMany.mockResolvedValue([]);
  promptFindUnique.mockResolvedValue({ id: 7 });
  activityFindFirst.mockResolvedValue({ position: 2 });
  activityCreate.mockResolvedValue({ id: 31 });
  activityUpdate.mockResolvedValue({ id: 30 });
});

describe('activity authoring service boundaries', () => {
  it('rejects cross-course secondary topics before writing an activity', async () => {
    lessonFindUnique.mockResolvedValue(lessonFixture());
    topicFindUnique.mockResolvedValue({ id: 'topic-main', courseOfferingId: 20 });
    topicFindMany.mockResolvedValue([{ id: 'topic-other', courseOfferingId: 99 }]);

    await expect(
      createActivityForLesson({
        lessonId: 10,
        user,
        payload: {
          question: 'Question',
          mainTopicId: 'topic-main',
          secondaryTopicIds: ['topic-other'],
          enableTeachMode: true,
          enableGuideMode: false,
          enableCustomMode: false,
        },
      }),
    ).rejects.toMatchObject({
      name: 'ActivityMutationError',
      status: 400,
      message: 'secondaryTopicIds must belong to the lesson course',
    });
    expect(activityCreate).not.toHaveBeenCalled();
  });

  it('moves config/topic/mode decisions into one authorized update operation', async () => {
    activityFindUnique.mockResolvedValue(activityFixture());
    topicFindUnique.mockResolvedValue({ id: 'topic-new', courseOfferingId: 20 });
    topicFindMany.mockResolvedValue([{ id: 'topic-secondary', courseOfferingId: 20 }]);

    await updateActivityForEditor({
      activityId: 30,
      user,
      payload: {
        question: 'New question',
        mainTopicId: 'topic-new',
        secondaryTopicIds: ['topic-secondary'],
        enableGuideMode: true,
      },
    });

    expect(activityUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 30 },
        data: expect.objectContaining({
          config: { question: 'New question', untouched: 'preserved' },
          mainTopicId: 'topic-new',
          enableGuideMode: true,
          secondaryTopics: {
            deleteMany: {},
            create: [{ topic: { connect: { id: 'topic-secondary' } } }],
          },
        }),
      }),
    );
  });

  it('keeps authorization failures as stable mutation errors', async () => {
    activityFindUnique.mockResolvedValue({
      ...activityFixture(),
      lesson: {
        ...activityFixture().lesson,
        module: {
          ...activityFixture().lesson.module,
          courseOffering: { id: 20, instructors: [{ userId: 'other' }] },
        },
      },
    });

    await expect(
      updateActivityForEditor({
        activityId: 30,
        user,
        payload: { title: 'Nope' },
      }),
    ).rejects.toBeInstanceOf(ActivityMutationError);
    await expect(
      updateActivityForEditor({
        activityId: 30,
        user,
        payload: { title: 'Nope' },
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
