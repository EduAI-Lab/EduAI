import { Op } from 'sequelize';
import { Course, Topics, Variants } from '../schema/index.js';
import { getCourseFromCore, getTopicByIdFromCore, getQuestionByIdFromCore } from '../services/coreApiService.js';
import { logger } from '../utils/logger.js';

/**
 * Daily reconciliation job: iterates all courses, topics, and variants that
 * hold a Core reference and cleans up any that return 404 from Core.
 *
 * Skips individual rows on 5xx or network errors — they will be retried on
 * the next run. Only a strict 404 triggers cleanup.
 */
export async function runReconciliation() {
  logger.info('[reconcile] Starting daily reconciliation');

  // Phase 1 — courses.core_course_id. A 404 here means the course was deleted
  // in Core, so the whole local course (and everything hanging off it — topics,
  // questions, assessments, variants) is cascade-deleted rather than just
  // unlinked. This is the safety net for §802's live push: if Core's cascade
  // call to QM was missed (QM down, network partition), this run catches it.
  const courses = await Course.findAll({
    where: { coreCourseId: { [Op.not]: null } },
    attributes: ['id', 'coreCourseId'],
  });

  for (const course of courses) {
    try {
      const result = await getCourseFromCore(course.coreCourseId);
      if (result === null) {
        await course.destroy();
        logger.info(`[reconcile] Deleted Course ${course.id} (Core 404, cascades to topics/questions/assessments)`);
      }
    } catch (err) {
      logger.warn(`[reconcile] Skipping Course ${course.id}: ${err.message}`);
    }
  }

  // Phase 2 — topics.core_topic_id (needs course.coreCourseId for the endpoint path)
  const topics = await Topics.findAll({
    where: { coreTopicId: { [Op.not]: null } },
    include: [{ model: Course, as: 'course', attributes: ['coreCourseId'] }],
  });

  for (const topic of topics) {
    const coreCourseId = topic.course?.coreCourseId;
    if (!coreCourseId) continue; // Course link already lost; skip until re-linked

    try {
      const result = await getTopicByIdFromCore(coreCourseId, topic.coreTopicId);
      if (result === null) {
        await topic.update({ coreTopicId: null });
        logger.info(`[reconcile] Nullified coreTopicId on Topic ${topic.id} (Core 404)`);
      }
    } catch (err) {
      logger.warn(`[reconcile] Skipping Topic ${topic.id}: ${err.message}`);
    }
  }

  // Phase 3 — variants.core_question_id
  const variants = await Variants.findAll({
    where: { coreQuestionId: { [Op.not]: null } },
    attributes: ['id', 'coreQuestionId'],
  });

  for (const variant of variants) {
    try {
      const result = await getQuestionByIdFromCore(variant.coreQuestionId);
      if (result === null) {
        await variant.update({ coreQuestionId: null });
        logger.info(`[reconcile] Nullified coreQuestionId on Variant ${variant.id} (Core 404)`);
      }
    } catch (err) {
      logger.warn(`[reconcile] Skipping Variant ${variant.id}: ${err.message}`);
    }
  }

  logger.info('[reconcile] Reconciliation complete');
}
