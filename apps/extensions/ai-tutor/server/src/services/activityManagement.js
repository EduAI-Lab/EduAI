/**
 * Activity authoring mutations.
 *
 * Routes own HTTP parsing/response mapping; this service owns the authorization,
 * topic-course invariants, JSON config merge, and Prisma writes for create/update.
 * Keeping those decisions here prevents route handlers from becoming a second
 * business-logic layer while preserving the existing endpoint contract.
 */

import { prisma } from '../config/database.js';
import { isUnitAdminForCourse } from '../middleware/auth.js';

export class ActivityMutationError extends Error {
  constructor(message, status = 400, code) {
    super(message);
    this.name = 'ActivityMutationError';
    this.status = status;
    if (code) this.code = code;
  }
}

const ACTIVITY_INCLUDE = {
  promptTemplate: { select: { id: true, name: true } },
  mainTopic: true,
  secondaryTopics: {
    include: { topic: true },
  },
};

function normalizeCustomPrompt(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeCustomPromptTitle(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, 20);
  return trimmed.length > 0 ? trimmed : null;
}

function assertAtLeastOneMode(payload) {
  if (!payload.enableTeachMode && !payload.enableGuideMode && !payload.enableCustomMode) {
    throw new ActivityMutationError('At least one AI mode must be enabled');
  }
}

async function assertLessonEditor(lesson, user) {
  const course = lesson.module.courseOffering;
  const isInstructor = course.instructors.some((assignment) => assignment.userId === user.id);
  const unitAdmin = await isUnitAdminForCourse(user, course);
  if (!isInstructor && !unitAdmin && user.role !== 'ADMIN') {
    throw new ActivityMutationError('Not authorized for this lesson', 403);
  }
  return course;
}

async function assertActivityEditor(activity, user) {
  const course = activity.lesson.module.courseOffering;
  const isInstructor = course.instructors.some((assignment) => assignment.userId === user.id);
  const unitAdmin = await isUnitAdminForCourse(user, course);
  if (!isInstructor && !unitAdmin && user.role !== 'ADMIN') {
    throw new ActivityMutationError('Not authorized for this activity', 403);
  }
  return course;
}

function normalizeSecondaryTopicIds(ids, mainTopicId) {
  return Array.from(
    new Set(
      (Array.isArray(ids) ? ids : []).filter(
        (value) => typeof value === 'string' && value.length > 0 && value !== mainTopicId,
      ),
    ),
  );
}

async function assertTopicsBelongToCourse(courseOfferingId, mainTopicId, secondaryTopicIds) {
  const mainTopic = await prisma.topic.findUnique({ where: { id: mainTopicId } });
  if (!mainTopic || mainTopic.courseOfferingId !== courseOfferingId) {
    throw new ActivityMutationError('mainTopicId must belong to the lesson course');
  }

  const normalizedSecondaryIds = normalizeSecondaryTopicIds(secondaryTopicIds, mainTopicId);
  if (normalizedSecondaryIds.length > 0) {
    const topics = await prisma.topic.findMany({
      where: { id: { in: normalizedSecondaryIds } },
    });
    const invalid = topics.some((topic) => topic.courseOfferingId !== courseOfferingId);
    if (invalid || topics.length !== normalizedSecondaryIds.length) {
      throw new ActivityMutationError('secondaryTopicIds must belong to the lesson course');
    }
  }
  return normalizedSecondaryIds;
}

/** Create an activity and its secondary-topic joins for an authorized editor. */
export async function createActivityForLesson({ lessonId, payload, user }) {
  assertAtLeastOneMode(payload);

  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
    include: {
      module: {
        include: {
          courseOffering: { include: { instructors: { select: { userId: true } } } },
        },
      },
    },
  });

  if (!lesson) throw new ActivityMutationError('Lesson not found', 404);
  const course = await assertLessonEditor(lesson, user);
  const normalizedSecondaryIds = await assertTopicsBelongToCourse(
    course.id,
    payload.mainTopicId,
    payload.secondaryTopicIds,
  );

  // Append to the end of the lesson's activity list. Positions may have gaps
  // after deletes, so the existing max+1 behavior is intentional.
  const lastActivity = await prisma.activity.findFirst({
    where: { lessonId },
    orderBy: { position: 'desc' },
    select: { position: true },
  });
  const resolvedPosition = lastActivity ? lastActivity.position + 1 : 0;

  return prisma.activity.create({
    data: {
      title: payload.title ?? null,
      instructionsMd: payload.instructionsMd ?? 'Answer the question.',
      position: resolvedPosition,
      lessonId,
      promptTemplateId: payload.promptTemplateId ?? null,
      customPrompt: normalizeCustomPrompt(payload.customPrompt),
      customPromptTitle: normalizeCustomPromptTitle(payload.customPromptTitle),
      mainTopicId: payload.mainTopicId,
      enableTeachMode: payload.enableTeachMode,
      enableGuideMode: payload.enableGuideMode,
      enableCustomMode: payload.enableCustomMode ?? false,
      config: {
        question: payload.question,
        questionType: payload.type ?? 'MCQ',
        options: payload.options,
        answer: payload.answer ?? null,
        hints: Array.isArray(payload.hints) ? payload.hints : [],
      },
      secondaryTopics:
        normalizedSecondaryIds.length > 0
          ? {
              create: normalizedSecondaryIds.map((topicId) => ({
                topic: { connect: { id: topicId } },
              })),
            }
          : undefined,
    },
    include: ACTIVITY_INCLUDE,
  });
}

function hasUpdateFields(payload) {
  return [
    'promptTemplateId',
    'customPrompt',
    'customPromptTitle',
    'enableCustomMode',
    'mainTopicId',
    'secondaryTopicIds',
    'title',
    'instructionsMd',
    'question',
    'type',
    'options',
    'answer',
    'hints',
    'enableTeachMode',
    'enableGuideMode',
  ].some((field) => typeof payload[field] !== 'undefined');
}

function setConfigFields(payload, currentConfig) {
  let changed = false;

  if (typeof payload.question !== 'undefined') {
    const questionText = payload.question.trim();
    if (questionText.length === 0) {
      throw new ActivityMutationError('question must not be empty');
    }
    currentConfig.question = questionText;
    changed = true;
  }

  if (typeof payload.type !== 'undefined') {
    currentConfig.questionType = payload.type;
    if (payload.type === 'SHORT_TEXT') currentConfig.options = null;
    changed = true;
  }

  if (typeof payload.options !== 'undefined') {
    currentConfig.options =
      payload.options === null ? null : payload.options.map((choice) => choice);
    changed = true;
  }

  if (typeof payload.answer !== 'undefined') {
    currentConfig.answer = payload.answer;
    changed = true;
  }

  if (typeof payload.hints !== 'undefined') {
    currentConfig.hints = Array.isArray(payload.hints)
      ? payload.hints.map((hint) => hint.trim()).filter((hint) => hint.length > 0)
      : [];
    changed = true;
  }

  return changed;
}

function setTextFields(payload, updateData) {
  if (typeof payload.title !== 'undefined') {
    if (payload.title === null) {
      updateData.title = null;
    } else {
      const trimmedTitle = payload.title.trim();
      updateData.title = trimmedTitle.length > 0 ? trimmedTitle : null;
    }
  }
  if (typeof payload.instructionsMd !== 'undefined')
    updateData.instructionsMd = payload.instructionsMd;
}

async function setPromptFields(payload, updateData) {
  if (typeof payload.promptTemplateId !== 'undefined') {
    if (payload.promptTemplateId === null) {
      updateData.promptTemplateId = null;
    } else if (typeof payload.promptTemplateId === 'number') {
      const prompt = await prisma.promptTemplate.findUnique({
        where: { id: payload.promptTemplateId },
      });
      if (!prompt) throw new ActivityMutationError('Invalid promptTemplateId');
      updateData.promptTemplateId = payload.promptTemplateId;
    } else {
      throw new ActivityMutationError('promptTemplateId must be a number or null');
    }
  }
  if (typeof payload.customPrompt !== 'undefined') {
    if (payload.customPrompt === null) updateData.customPrompt = null;
    else if (typeof payload.customPrompt === 'string') {
      updateData.customPrompt = normalizeCustomPrompt(payload.customPrompt);
    } else throw new ActivityMutationError('customPrompt must be a string or null');
  }
  if (typeof payload.customPromptTitle !== 'undefined') {
    if (payload.customPromptTitle === null) updateData.customPromptTitle = null;
    else if (typeof payload.customPromptTitle === 'string') {
      updateData.customPromptTitle = normalizeCustomPromptTitle(payload.customPromptTitle);
    } else throw new ActivityMutationError('customPromptTitle must be a string or null');
  }
}

async function setTopicFields(payload, activity, courseOfferingId, updateData) {
  let resolvedMainTopicId = activity.mainTopicId;
  if (typeof payload.mainTopicId !== 'undefined') {
    if (typeof payload.mainTopicId !== 'string' || payload.mainTopicId.length === 0) {
      throw new ActivityMutationError('mainTopicId must be a string');
    }
    const mainTopic = await prisma.topic.findUnique({ where: { id: payload.mainTopicId } });
    if (!mainTopic || mainTopic.courseOfferingId !== courseOfferingId) {
      throw new ActivityMutationError('mainTopicId must belong to the activity course');
    }
    updateData.mainTopicId = payload.mainTopicId;
    resolvedMainTopicId = payload.mainTopicId;
  }

  if (typeof payload.secondaryTopicIds === 'undefined') return;
  if (!Array.isArray(payload.secondaryTopicIds)) {
    throw new ActivityMutationError('secondaryTopicIds must be an array of ids');
  }
  const normalizedSecondaryIds = normalizeSecondaryTopicIds(
    payload.secondaryTopicIds,
    resolvedMainTopicId,
  );
  if (normalizedSecondaryIds.length > 0) {
    const topics = await prisma.topic.findMany({
      where: { id: { in: normalizedSecondaryIds } },
    });
    const invalid = topics.some((topic) => topic.courseOfferingId !== courseOfferingId);
    if (invalid || topics.length !== normalizedSecondaryIds.length) {
      throw new ActivityMutationError('secondaryTopicIds must belong to the activity course');
    }
  }
  updateData.secondaryTopics = {
    deleteMany: {},
    create: normalizedSecondaryIds.map((topicId) => ({
      topic: { connect: { id: topicId } },
    })),
  };
}

function setModeFields(payload, activity, updateData) {
  const requestedModeUpdate =
    typeof payload.enableTeachMode !== 'undefined' ||
    typeof payload.enableGuideMode !== 'undefined' ||
    typeof payload.enableCustomMode !== 'undefined';
  if (!requestedModeUpdate) return;

  const newTeachMode =
    typeof payload.enableTeachMode !== 'undefined'
      ? payload.enableTeachMode
      : activity.enableTeachMode;
  const newGuideMode =
    typeof payload.enableGuideMode !== 'undefined'
      ? payload.enableGuideMode
      : activity.enableGuideMode;
  const newCustomMode =
    typeof payload.enableCustomMode !== 'undefined'
      ? payload.enableCustomMode
      : activity.enableCustomMode;

  if (!newTeachMode && !newGuideMode && !newCustomMode) {
    throw new ActivityMutationError('At least one AI mode must be enabled');
  }
  if (typeof payload.enableTeachMode !== 'undefined')
    updateData.enableTeachMode = payload.enableTeachMode;
  if (typeof payload.enableGuideMode !== 'undefined')
    updateData.enableGuideMode = payload.enableGuideMode;
  if (typeof payload.enableCustomMode !== 'undefined')
    updateData.enableCustomMode = payload.enableCustomMode;
}

/** Update an activity while preserving its config and topic invariants. */
export async function updateActivityForEditor({ activityId, payload, user }) {
  if (!hasUpdateFields(payload)) throw new ActivityMutationError('Nothing to update');

  const activity = await prisma.activity.findUnique({
    where: { id: activityId },
    include: {
      lesson: {
        include: {
          module: {
            include: {
              courseOffering: {
                include: { instructors: true },
              },
            },
          },
        },
      },
      mainTopic: true,
    },
  });

  if (!activity) throw new ActivityMutationError('Activity not found', 404);
  const course = await assertActivityEditor(activity, user);
  const updateData = {};

  setTextFields(payload, updateData);
  const currentConfig =
    activity.config && typeof activity.config === 'object' ? { ...activity.config } : {};
  if (setConfigFields(payload, currentConfig)) updateData.config = currentConfig;
  await setPromptFields(payload, updateData);
  await setTopicFields(payload, activity, course.id, updateData);
  setModeFields(payload, activity, updateData);

  return prisma.activity.update({
    where: { id: activityId },
    data: updateData,
    include: ACTIVITY_INCLUDE,
  });
}
