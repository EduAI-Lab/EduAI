/**
 * Orchestration helpers that bridge QM's local data model and Core API calls.
 * Handles topic resolution (push-if-missing) before pushing a variant as a Core Question.
 */
import { Topics } from '../schema/index.js';
import { pushTopicToCore, pushQuestionToCore } from './coreApiService.js';

/**
 * Ensures a local topic has a coreTopicId, pushing it to Core first if needed.
 * Returns the Core topic ID.
 */
async function resolveCoreTopicId(topic, coreCourseId) {
  if (topic.coreTopicId) return topic.coreTopicId;
  const result = await pushTopicToCore(coreCourseId, topic.name);
  await topic.update({ coreTopicId: result.id });
  return result.id;
}

/**
 * Translates a variant's local topic IDs to Core topic IDs, pushing any missing ones,
 * then POSTs the variant to Core as a Question.
 *
 * @param {object} variant  - Sequelize Variants instance (with questionMetadata loaded)
 * @param {object} course   - Sequelize Course instance (must have coreCourseId)
 * @param {string} cookieHeader - req.headers.cookie to forward for Core session auth
 * @returns {{ coreQuestionId: string }}
 * @throws  Error with .status + .body on Core API errors (422, 4xx, 5xx)
 */
export async function pushVariantToCore(variant, course, cookieHeader) {
  const qm = variant.questionMetadata;

  const primaryTopic = await Topics.findOne({ where: { id: qm.primaryTopicId } });
  if (!primaryTopic) throw new Error('Primary topic not found locally');

  const primaryCoreTopicId = await resolveCoreTopicId(primaryTopic, course.coreCourseId);

  const secondaryLocalIds = variant.secondaryTopicsId ?? [];
  const coreSecondaryTopicIds = [];
  if (secondaryLocalIds.length > 0) {
    const secondaryTopics = await Topics.findAll({ where: { id: secondaryLocalIds } });
    for (const st of secondaryTopics) {
      const coreTopicId = await resolveCoreTopicId(st, course.coreCourseId);
      coreSecondaryTopicIds.push(coreTopicId);
    }
  }

  const payload = {
    courseId: course.coreCourseId,
    topicId: primaryCoreTopicId,
    content: variant.questionText,
    type: qm.type,
    difficulty: (variant.difficulty || 'medium').toUpperCase(),
    reasoningLevel: (variant.reasoningLevel || 'factual').toUpperCase(),
    choices: variant.choices ?? undefined,
    answer: variant.answer ?? undefined,
    testable: false,
    secondaryTopicIds: coreSecondaryTopicIds,
    idempotencyKey: `qm-variant-${variant.id}`,
  };

  const result = await pushQuestionToCore(payload, cookieHeader);
  return { coreQuestionId: result.id };
}
