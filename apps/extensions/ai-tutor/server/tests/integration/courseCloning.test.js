import { describe, it, expect, beforeEach } from 'vitest';
import { makeProfessor, truncateAll, seedMinimalCourse, prisma } from '../helpers.js';
import { cloneCourseContent, cloneLessonsFromOffering } from '../../src/services/courseCloning.js';

describe('courseCloning service', () => {
  let sourceProf;
  let targetProf;
  let source; // { user, course, module, lesson, topic }
  let target; // { user, course, module, lesson, topic }

  beforeEach(async () => {
    await truncateAll();

    sourceProf = makeProfessor();
    source = await seedMinimalCourse(sourceProf.id);

    targetProf = makeProfessor();
    target = await seedMinimalCourse(targetProf.id);
  });

  // ── Helper to create an activity in a given lesson/topic ───────────

  async function createActivity(lessonId, mainTopicId, overrides = {}) {
    return prisma.activity.create({
      data: {
        lessonId,
        mainTopicId,
        instructionsMd: 'Default instructions',
        config: { question: 'What is 1+1?', questionType: 'MCQ', options: ['1', '2'], answer: 1 },
        position: 0,
        ...overrides,
      },
    });
  }

  // ══════════════════════════════════════════════════════════════════════
  // cloneCourseContent
  // ══════════════════════════════════════════════════════════════════════

  describe('cloneCourseContent', () => {
    it('clones all modules, lessons, and activities from source to target', async () => {
      await createActivity(source.lesson.id, source.topic.id);

      await cloneCourseContent(source.course.id, target.course.id);

      const targetModules = await prisma.module.findMany({
        where: { courseOfferingId: target.course.id },
        include: { lessons: { include: { activities: true } } },
      });

      // target already had 1 module from seed, cloning adds 1 more
      expect(targetModules.length).toBe(2);

      const clonedModule = targetModules.find(
        (m) => m.title === 'Test Module' && m.id !== target.module.id,
      );
      expect(clonedModule).toBeDefined();
      expect(clonedModule.lessons.length).toBe(1);
      expect(clonedModule.lessons[0].activities.length).toBe(1);
    });

    it('assigns cloned modules incrementing positions after existing target modules', async () => {
      // Add a second module to the source
      const sourceModule2 = await prisma.module.create({
        data: {
          title: 'Source Module 2',
          position: 1,
          courseOfferingId: source.course.id,
        },
      });
      await prisma.lesson.create({
        data: { title: 'Lesson in M2', position: 0, moduleId: sourceModule2.id },
      });

      // Target already has module at position 0
      await cloneCourseContent(source.course.id, target.course.id);

      const targetModules = await prisma.module.findMany({
        where: { courseOfferingId: target.course.id },
        orderBy: { position: 'asc' },
      });

      // Seed target module at position 0, cloned modules at 1 and 2
      expect(targetModules.length).toBe(3);
      expect(targetModules[0].id).toBe(target.module.id);
      expect(targetModules[1].position).toBe(1);
      expect(targetModules[2].position).toBe(2);
    });

    it('preserves activity config JSON during cloning', async () => {
      const config = {
        question: 'Complex question?',
        questionType: 'MCQ',
        options: ['A', 'B', 'C'],
        answer: 2,
        hints: ['Think carefully'],
      };
      await createActivity(source.lesson.id, source.topic.id, { config });

      await cloneCourseContent(source.course.id, target.course.id);

      const clonedActivities = await prisma.activity.findMany({
        where: {
          lesson: { module: { courseOfferingId: target.course.id, id: { not: target.module.id } } },
        },
      });

      expect(clonedActivities.length).toBe(1);
      expect(clonedActivities[0].config).toEqual(config);
    });

    it('maps source topics to target course (creates if not exists)', async () => {
      // Create a new topic in the source course
      const sourceTopic2 = await prisma.topic.create({
        data: { name: 'Unique Source Topic', courseOfferingId: source.course.id },
      });
      await createActivity(source.lesson.id, sourceTopic2.id);

      await cloneCourseContent(source.course.id, target.course.id);

      // Target should now have a topic with the same name
      const targetTopics = await prisma.topic.findMany({
        where: { courseOfferingId: target.course.id },
      });
      const mappedTopic = targetTopics.find((t) => t.name === 'Unique Source Topic');
      expect(mappedTopic).toBeDefined();

      // The cloned activity should reference the target topic, not the source one
      const clonedActivity = await prisma.activity.findFirst({
        where: {
          lesson: { module: { courseOfferingId: target.course.id, id: { not: target.module.id } } },
        },
      });
      expect(clonedActivity.mainTopicId).toBe(mappedTopic.id);
    });

    it('clones secondary topics with correct mapping', async () => {
      const sourceTopic2 = await prisma.topic.create({
        data: { name: 'Secondary Topic', courseOfferingId: source.course.id },
      });

      const activity = await createActivity(source.lesson.id, source.topic.id);
      await prisma.activitySecondaryTopic.create({
        data: { activityId: activity.id, topicId: sourceTopic2.id },
      });

      await cloneCourseContent(source.course.id, target.course.id);

      // Find the cloned activity
      const clonedActivity = await prisma.activity.findFirst({
        where: {
          lesson: { module: { courseOfferingId: target.course.id, id: { not: target.module.id } } },
        },
        include: { secondaryTopics: true },
      });

      expect(clonedActivity.secondaryTopics.length).toBe(1);

      // The secondary topic should be in the target course
      const targetSecondaryTopic = await prisma.topic.findUnique({
        where: { id: clonedActivity.secondaryTopics[0].topicId },
      });
      expect(targetSecondaryTopic.courseOfferingId).toBe(target.course.id);
      expect(targetSecondaryTopic.name).toBe('Secondary Topic');
    });

    it('filters by moduleIds when provided', async () => {
      // Add a second module+lesson to the source
      const sourceModule2 = await prisma.module.create({
        data: { title: 'Source Module 2', position: 1, courseOfferingId: source.course.id },
      });
      const lesson2 = await prisma.lesson.create({
        data: { title: 'Lesson in M2', position: 0, moduleId: sourceModule2.id },
      });
      await createActivity(source.lesson.id, source.topic.id);
      await createActivity(lesson2.id, source.topic.id);

      // Only clone the second module
      await cloneCourseContent(source.course.id, target.course.id, {
        moduleIds: [sourceModule2.id],
      });

      const clonedModules = await prisma.module.findMany({
        where: { courseOfferingId: target.course.id, id: { not: target.module.id } },
      });

      expect(clonedModules.length).toBe(1);
      expect(clonedModules[0].title).toBe('Source Module 2');
    });

    it('does nothing when source has no modules', async () => {
      // Create an empty course
      const emptyCourse = await prisma.courseOffering.create({
        data: { title: 'Empty Course', isPublished: true },
      });

      const moduleCountBefore = await prisma.module.count({
        where: { courseOfferingId: target.course.id },
      });

      await cloneCourseContent(emptyCourse.id, target.course.id);

      const moduleCountAfter = await prisma.module.count({
        where: { courseOfferingId: target.course.id },
      });

      expect(moduleCountAfter).toBe(moduleCountBefore);
    });
  });

  // ══════════════════════════════════════════════════════════════════════
  // cloneLessonsFromOffering
  // ══════════════════════════════════════════════════════════════════════

  describe('cloneLessonsFromOffering', () => {
    it('clones specific lessons into a target module', async () => {
      await createActivity(source.lesson.id, source.topic.id);

      await cloneLessonsFromOffering([source.lesson.id], target.module.id);

      const targetLessons = await prisma.lesson.findMany({
        where: { moduleId: target.module.id },
        include: { activities: true },
      });

      // target already had 1 lesson from seed, cloning adds 1 more
      expect(targetLessons.length).toBe(2);

      const clonedLesson = targetLessons.find((l) => l.id !== target.lesson.id);
      expect(clonedLesson).toBeDefined();
      expect(clonedLesson.title).toBe('Test Lesson');
      expect(clonedLesson.activities.length).toBe(1);
    });

    it('assigns cloned lessons incrementing positions after existing lessons', async () => {
      // Create a second lesson in source
      const sourceLesson2 = await prisma.lesson.create({
        data: { title: 'Source Lesson 2', position: 1, moduleId: source.module.id },
      });

      // Target lesson already at position 0
      await cloneLessonsFromOffering([source.lesson.id, sourceLesson2.id], target.module.id);

      const targetLessons = await prisma.lesson.findMany({
        where: { moduleId: target.module.id },
        orderBy: { position: 'asc' },
      });

      expect(targetLessons.length).toBe(3);
      expect(targetLessons[0].id).toBe(target.lesson.id);
      expect(targetLessons[1].position).toBe(1);
      expect(targetLessons[2].position).toBe(2);
    });

    it('maps activity topics to the target course correctly', async () => {
      const uniqueTopic = await prisma.topic.create({
        data: { name: 'Clone Lesson Topic', courseOfferingId: source.course.id },
      });
      await createActivity(source.lesson.id, uniqueTopic.id);

      await cloneLessonsFromOffering([source.lesson.id], target.module.id);

      const clonedLesson = await prisma.lesson.findFirst({
        where: { moduleId: target.module.id, id: { not: target.lesson.id } },
        include: { activities: true },
      });

      expect(clonedLesson.activities.length).toBe(1);

      // The topic should exist in the target course
      const targetTopic = await prisma.topic.findFirst({
        where: { courseOfferingId: target.course.id, name: 'Clone Lesson Topic' },
      });
      expect(targetTopic).toBeDefined();
      expect(clonedLesson.activities[0].mainTopicId).toBe(targetTopic.id);
    });

    it('reuses existing topic in target when name matches (collision)', async () => {
      // Create a topic in the target with the same name as the source topic
      const sharedName = 'Shared Topic Name';
      const sourceTopic = await prisma.topic.create({
        data: { name: sharedName, courseOfferingId: source.course.id },
      });
      const existingTargetTopic = await prisma.topic.create({
        data: { name: sharedName, courseOfferingId: target.course.id },
      });

      await createActivity(source.lesson.id, sourceTopic.id);

      await cloneLessonsFromOffering([source.lesson.id], target.module.id);

      // Should NOT create a new topic; should reuse the existing one
      const targetTopics = await prisma.topic.findMany({
        where: { courseOfferingId: target.course.id, name: sharedName },
      });
      expect(targetTopics.length).toBe(1);
      expect(targetTopics[0].id).toBe(existingTargetTopic.id);

      // Cloned activity should reference the existing target topic
      const clonedLesson = await prisma.lesson.findFirst({
        where: { moduleId: target.module.id, id: { not: target.lesson.id } },
        include: { activities: true },
      });
      expect(clonedLesson.activities[0].mainTopicId).toBe(existingTargetTopic.id);
    });

    it('does nothing when lesson list is empty', async () => {
      const lessonCountBefore = await prisma.lesson.count({
        where: { moduleId: target.module.id },
      });

      await cloneLessonsFromOffering([], target.module.id);

      const lessonCountAfter = await prisma.lesson.count({
        where: { moduleId: target.module.id },
      });

      expect(lessonCountAfter).toBe(lessonCountBefore);
    });
  });
});
