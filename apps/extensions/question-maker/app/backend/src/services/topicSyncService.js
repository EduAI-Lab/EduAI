import { createId } from '@paralleldrive/cuid2';
import { prisma } from '../config/database.js';
import { getCourseTopicsFromCore } from './coreApiService.js';
import { logger } from '../utils/logger.js';

function parseCoreTopics(data) {
  if (Array.isArray(data?.topics)) return data.topics;
  if (Array.isArray(data)) return data;
  return [];
}

/** Upserts Core course topics into the local QM topics table. */
export async function syncTopicsFromCoreForCourse(course, cookie, { failOnCoreError = false } = {}) {
  if (!course?.coreCourseId) return 0;

  let coreTopics;
  try {
    const data = await getCourseTopicsFromCore(course.coreCourseId, { cookie });
    coreTopics = parseCoreTopics(data);
  } catch (err) {
    logger.warn({ err, coreCourseId: course.coreCourseId }, 'Core topic sync skipped');
    if (failOnCoreError) throw err;
    return 0;
  }

  const validCoreTopics = coreTopics.filter((ct) => ct?.id && ct?.name);
  if (validCoreTopics.length === 0) return 0;

  const coreTopicIds = validCoreTopics.map((ct) => ct.id);
  const [localTopics, topicsByCoreId] = await Promise.all([
    prisma.topics.findMany({ where: { courseId: course.id } }),
    prisma.topics.findMany({ where: { coreTopicId: { in: coreTopicIds } } }),
  ]);

  const localByName = new Map(localTopics.map((topic) => [topic.name, topic]));
  const globalByCoreId = new Map(
    topicsByCoreId.filter((topic) => topic.coreTopicId).map((topic) => [topic.coreTopicId, topic]),
  );

  let synced = 0;
  for (const ct of validCoreTopics) {
    const linkedElsewhere = globalByCoreId.get(ct.id);
    if (linkedElsewhere) {
      if (linkedElsewhere.courseId !== course.id) continue;
      await prisma.topics.update({ where: { id: linkedElsewhere.id }, data: { name: ct.name } });
      synced++;
      continue;
    }

    const byName = localByName.get(ct.name);
    if (byName) {
      await prisma.topics.update({ where: { id: byName.id }, data: { coreTopicId: ct.id } });
      globalByCoreId.set(ct.id, { ...byName, coreTopicId: ct.id });
    } else {
      const created = await prisma.topics.create({
        data: {
          id: createId(),
          name: ct.name,
          courseId: course.id,
          coreTopicId: ct.id,
        },
      });
      localByName.set(ct.name, created);
      globalByCoreId.set(ct.id, created);
    }
    synced++;
  }

  return synced;
}
