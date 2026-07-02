import { prisma } from '../config/database.js';
import { fetchCoreCourseSafe, fetchCoreTopicSafe } from '../services/eduaiClient.js';

/**
 * Daily reconciliation job: iterates all CourseOffering and Topic rows that
 * hold a Core reference and cleans up any that return 404 from Core.
 *
 * Skips individual rows on 5xx or network errors — they will be retried on
 * the next run. Only a strict 404 triggers cleanup.
 */
export async function runReconciliation() {
  console.log('[reconcile] Starting daily reconciliation');

  // Phase 1 — CourseOffering rows linked to Core. A 404 here means the course
  // was deleted in Core, so the whole local CourseOffering is cascade-deleted
  // (modules, lessons, activities, submissions, chat sessions, etc. all carry
  // `onDelete: Cascade` FKs — see schema.prisma) rather than just unlinked.
  // This is the safety net for §802's live push: if Core's cascade call to
  // AI Tutor was missed (server down, network partition), this run catches it.
  const offerings = await prisma.courseOffering.findMany({
    where: { coreOfferingId: { not: null } },
    select: { id: true, coreOfferingId: true },
  });

  for (const offering of offerings) {
    try {
      const result = await fetchCoreCourseSafe(offering.coreOfferingId);
      if (result === null) {
        await prisma.courseOffering.delete({ where: { id: offering.id } });
        console.log(`[reconcile] Deleted CourseOffering ${offering.id} (Core 404, cascades to modules/lessons/activities)`);
      }
    } catch (err) {
      console.warn(`[reconcile] Skipping CourseOffering ${offering.id}: ${err.message}`);
    }
  }

  // Phase 2 — Topic rows linked to Core (needs courseOffering.coreOfferingId for the endpoint)
  const topics = await prisma.topic.findMany({
    where: { coreTopicId: { not: null } },
    include: { courseOffering: { select: { coreOfferingId: true } } },
  });

  for (const topic of topics) {
    const courseCorId = topic.courseOffering.coreOfferingId;
    if (!courseCorId) continue; // Course link already lost; topic will be caught when re-linked

    try {
      const result = await fetchCoreTopicSafe(courseCorId, topic.coreTopicId);
      if (result === null) {
        await prisma.topic.update({
          where: { id: topic.id },
          data: { coreTopicId: null },
        });
        console.log(`[reconcile] Nullified coreTopicId on Topic ${topic.id} (Core 404)`);
      }
    } catch (err) {
      console.warn(`[reconcile] Skipping Topic ${topic.id}: ${err.message}`);
    }
  }

  console.log('[reconcile] Reconciliation complete');
}
