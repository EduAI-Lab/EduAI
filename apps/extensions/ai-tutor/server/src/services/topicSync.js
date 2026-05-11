import { prisma } from '../config/database.js';
import { listEduAiCourseTopics } from './eduaiClient.js';

/**
 * Sync topics from EduAI for an imported course into local DB.
 * - No deletes; ensures presence by name within the course offering.
 * - Returns the up-to-date list of local topics for the course.
 * @param {number} courseOfferingId
 */
export async function syncExternalCourseTopics(courseOfferingId, options = {}) {
  if (!Number.isFinite(courseOfferingId)) return [];

  const course = await prisma.courseOffering.findUnique({ where: { id: courseOfferingId } });
  if (!course) return [];
  if (!course.externalId) {
    // Not an external course; nothing to sync
    const local = await prisma.topic.findMany({
      where: { courseOfferingId },
      orderBy: { name: 'asc' },
    });
    return local;
  }

  // Fetch topics from EduAI
  const externalTopics = await listEduAiCourseTopics(course.externalId, options.accessToken);
  const upstreamNames = Array.from(
    new Set(
      externalTopics
        .map((t) => (t && typeof t.name === 'string' ? t.name.trim() : ''))
        .filter((n) => n.length > 0),
    ),
  );

  if (upstreamNames.length === 0) {
    // Nothing to import; return current local topics
    const local = await prisma.topic.findMany({
      where: { courseOfferingId },
      orderBy: { name: 'asc' },
    });
    return { topics: local, upstreamNames: [] };
  }

  // Ensure existing topics by name; create missing ones
  const existing = await prisma.topic.findMany({
    where: { courseOfferingId, name: { in: upstreamNames } },
    select: { id: true, name: true },
  });
  const have = new Set(existing.map((t) => t.name));
  const toCreate = upstreamNames.filter((n) => !have.has(n));

  if (toCreate.length > 0) {
    // Create missing topics
    await prisma.topic.createMany({
      data: toCreate.map((name) => ({ name, courseOfferingId })),
      skipDuplicates: true,
    });
  }

  const local = await prisma.topic.findMany({
    where: { courseOfferingId },
    orderBy: { name: 'asc' },
  });
  return { topics: local, upstreamNames };
}
